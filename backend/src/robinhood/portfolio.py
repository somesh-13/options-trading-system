"""Derive Robinhood holdings + summary from the activity log."""

from __future__ import annotations

import json
import re
import time
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from typing import Dict, List, Optional

from .database import get_conn, latest_live_snapshot, latest_live_snapshots_all
from .parser import parse_option_description


# Robinhood CDIV descriptions look like: "Cash Div: R/D ... - 100 shares at 0.08352"
_CDIV_SHARES_RE = re.compile(r"-\s*([\d.,]+)\s*shares\s*at", re.IGNORECASE)


def _cdiv_share_count(description: Optional[str]) -> Optional[float]:
    if not description:
        return None
    m = _CDIV_SHARES_RE.search(description)
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", ""))
    except ValueError:
        return None


ALL_ACCOUNTS = "all"


# --- equity and option categories keyed off trans_code --------------------

_EQUITY_BUY = {"Buy"}
_EQUITY_SELL = {"Sell"}
_EQUITY_TRANS = _EQUITY_BUY | _EQUITY_SELL

_OPTION_OPEN = {"BTO", "STO"}
_OPTION_CLOSE = {"BTC", "STC", "OEXP", "OASGN", "OEXCS", "OCA"}
_OPTION_TRANS = _OPTION_OPEN | _OPTION_CLOSE

_DIVIDEND_TRANS = {"CDIV", "MDIV"}
_INTEREST_TRANS = {"INT"}
_FEE_TRANS = {"GOLD", "MTCH", "MISC"}
_TRANSFER_TRANS = {"ACH"}


# --- output shapes --------------------------------------------------------

@dataclass
class EquityHolding:
    symbol: str
    quantity: float
    avg_cost: float
    cost_basis: float
    realized_pnl: float
    account: str = "all"
    inferred_opening: bool = False  # True if pre-CSV balance inferred from CDIV share count
    current_price: Optional[float] = None
    market_value: Optional[float] = None
    unrealized_pnl: Optional[float] = None


@dataclass
class OptionHolding:
    underlying: str
    side: str          # 'Call' | 'Put'
    strike: float
    expiry: str        # ISO yyyy-mm-dd
    position: str      # 'long' | 'short'
    quantity: float    # contracts
    avg_cost: float    # per contract, average debit paid (for long) or credit received (for short, positive)
    cost_basis: float  # total; negative for long (debit paid), positive for short (credit received)
    realized_pnl: float
    account: str = "all"
    market_value: Optional[float] = None    # current mark × qty × 100 (positive for both long/short)
    unrealized_pnl: Optional[float] = None  # mark-to-market gain/loss vs cost_basis


@dataclass
class CashSummary:
    cash_net_transfers: float   # ACH in minus ACH out (CSV mode only; 0 in live mode)
    dividends_ytd: float
    interest_ytd: float
    fees_ytd: float
    realized_pnl: float
    unrealized_pnl: float       # equity + option unrealized P&L combined
    total_market_value: float   # equity market value only
    total_invested: float       # absolute cost basis of currently-open equity positions
    unknown_basis_proceeds: float = 0.0  # cash received from sells of pre-CSV holdings (cost basis unknown)
    cash_balance: float = 0.0   # current cash in the account (live mode: from broker; CSV: 0)
    option_market_value: float = 0.0    # sum of option leg market values
    option_cost_basis: float = 0.0      # net option cost basis (separate from equity total_invested)
    nav: float = 0.0            # total_market_value + option_market_value + cash_balance


@dataclass
class ActivityRowDTO:
    activity_date: str
    process_date: Optional[str]
    settle_date: Optional[str]
    instrument: Optional[str]
    description: Optional[str]
    trans_code: str
    quantity: Optional[float]
    price: Optional[float]
    amount: Optional[float]


# --- helpers --------------------------------------------------------------

def _all_rows_ascending(account: Optional[str] = None):
    """Iterate activity rows oldest-first so we can fold into running lots.

    CSV dates have no clock component; ties are broken by row_hash to keep
    fold order deterministic. Pass `account='brokerage'` or `'roth_ira'` to
    scope to one account; `None` or `'all'` returns everything.
    """
    conn = get_conn()
    if account and account != ALL_ACCOUNTS:
        cur = conn.execute(
            """
            SELECT activity_date, process_date, settle_date, instrument,
                   description, trans_code, quantity, price, amount, row_hash,
                   account
            FROM robinhood_activity
            WHERE account = ?
            ORDER BY activity_date ASC, row_hash ASC
            """,
            (account,),
        )
    else:
        cur = conn.execute(
            """
            SELECT activity_date, process_date, settle_date, instrument,
                   description, trans_code, quantity, price, amount, row_hash,
                   account
            FROM robinhood_activity
            ORDER BY activity_date ASC, row_hash ASC
            """
        )
    return cur.fetchall()


def list_accounts() -> List[str]:
    """Distinct non-null account tags present in the DB."""
    conn = get_conn()
    rows = conn.execute(
        "SELECT DISTINCT account FROM robinhood_activity WHERE account IS NOT NULL AND account <> '' ORDER BY account"
    ).fetchall()
    return [r[0] for r in rows]


# --- equity replay (FIFO lots) -------------------------------------------

class _FifoLedger:
    """Tracks open lots per symbol, computes realized P&L on sells."""

    def __init__(self) -> None:
        # symbol -> list of [qty_remaining, unit_cost]
        self.lots: Dict[str, List[List[float]]] = defaultdict(list)
        self.realized_pnl: Dict[str, float] = defaultdict(float)
        self.inferred_opening: Dict[str, bool] = defaultdict(bool)
        # Cash received from selling pre-CSV shares with unknown cost basis.
        # Tracked separately from realized_pnl because we can't honestly
        # attribute profit/loss to it.
        self.unknown_basis_proceeds: Dict[str, float] = defaultdict(float)

    def buy(self, symbol: str, qty: float, unit_cost: float) -> None:
        if qty <= 0:
            return
        self.lots[symbol].append([qty, unit_cost])

    def inject_opening(self, symbol: str, qty: float) -> None:
        """Inject a pre-CSV opening lot with unknown cost basis.

        Used when a CDIV row implies the user held N shares before the
        earliest Buy in the data (e.g. AMKR bought before the CSV start).
        Cost is recorded as 0 so `unrealized_pnl` stays informative in the
        direction (any live price > 0 reads as profit), and the holding is
        flagged so the UI can label it clearly.
        """
        if qty <= 0:
            return
        self.lots[symbol].insert(0, [qty, 0.0])
        self.inferred_opening[symbol] = True

    def total_qty(self, symbol: str) -> float:
        return sum(l[0] for l in self.lots.get(symbol, []))

    def sell(self, symbol: str, qty: float, unit_proceeds: float) -> None:
        if qty <= 0:
            return
        remaining = qty
        lots = self.lots.get(symbol, [])
        while remaining > 1e-9 and lots:
            lot = lots[0]
            take = min(lot[0], remaining)
            self.realized_pnl[symbol] += take * (unit_proceeds - lot[1])
            lot[0] -= take
            remaining -= take
            if lot[0] <= 1e-9:
                lots.pop(0)
        # Remaining qty with no matching long lot → this is an option-
        # assignment or cost-basis-unknown sale of shares bought before the
        # CSV window. Track the proceeds separately (can't compute real P&L
        # without the original cost basis) and mark the symbol so the UI
        # surfaces the gap. This captures e.g. the 100 HOOD assigned on
        # 2026-01-16 in the Roth IRA with no visible earlier Buy.
        if remaining > 1e-9:
            self.inferred_opening[symbol] = True
            self.unknown_basis_proceeds[symbol] += remaining * unit_proceeds

    def open_holdings(self, account: str = "all") -> List[EquityHolding]:
        out: List[EquityHolding] = []
        for symbol, lots in self.lots.items():
            total_qty = sum(l[0] for l in lots)
            if total_qty < 1e-9:
                continue
            cost_basis = sum(l[0] * l[1] for l in lots)
            avg_cost = cost_basis / total_qty if total_qty else 0.0
            out.append(EquityHolding(
                symbol=symbol,
                quantity=round(total_qty, 4),
                avg_cost=round(avg_cost, 4),
                cost_basis=round(cost_basis, 2),
                realized_pnl=round(self.realized_pnl.get(symbol, 0.0), 2),
                account=account,
                inferred_opening=self.inferred_opening.get(symbol, False),
            ))
        out.sort(key=lambda h: -h.cost_basis)
        return out


# --- option replay --------------------------------------------------------

class _OptionLedger:
    """Track option legs by (underlying, side, strike, expiry, position_direction).

    Robinhood reports BTO/STO as opens and BTC/STC/OEXP/OASGN/OEXCS/OCA as
    closes. For long (BTO) positions, qty is positive and amount is negative
    (debit). For short (STO) positions, qty is positive in the row but the
    leg is "short" — close with BTC.
    """

    def __init__(self) -> None:
        # key -> {qty, cost_basis} where cost_basis sign == row amount sign (debit<0, credit>0)
        self.long_lots: Dict[tuple, List[List[float]]] = defaultdict(list)
        self.short_lots: Dict[tuple, List[List[float]]] = defaultdict(list)
        self.realized: Dict[tuple, float] = defaultdict(float)
        # Closing rows (STC/BTC) with no matching open are pre-CSV positions;
        # we record their cash proceeds / debit so the UI can disclose the gap.
        self.unknown_basis_proceeds: float = 0.0

    @staticmethod
    def _key(leg):
        return (leg.underlying, leg.side, leg.strike, leg.expiry)

    def open_long(self, leg, qty: float, amount: float) -> None:
        if qty <= 0:
            return
        self.long_lots[self._key(leg)].append([qty, amount / qty])  # per-contract cost (negative)

    def open_short(self, leg, qty: float, amount: float) -> None:
        if qty <= 0:
            return
        self.short_lots[self._key(leg)].append([qty, amount / qty])  # per-contract credit (positive)

    def close_long(self, leg, qty: float, amount: float) -> None:
        key = self._key(leg)
        lots = self.long_lots.get(key, [])
        remaining = qty
        unit_proceeds = (amount / qty) if qty else 0.0
        while remaining > 1e-9 and lots:
            lot = lots[0]
            take = min(lot[0], remaining)
            # long: P&L = proceeds - original cost (per contract)
            self.realized[key] += take * (unit_proceeds - lot[1])
            lot[0] -= take
            remaining -= take
            if lot[0] <= 1e-9:
                lots.pop(0)
        if remaining > 1e-9 and amount != 0:
            # Pre-CSV long position being closed — record proceeds but can't
            # attribute P&L without the original BTO row.
            self.unknown_basis_proceeds += remaining * unit_proceeds

    def close_short(self, leg, qty: float, amount: float) -> None:
        key = self._key(leg)
        lots = self.short_lots.get(key, [])
        remaining = qty
        # short close: amount is typically negative (debit to buy back) or 0 (expired)
        unit_cost = (amount / qty) if qty else 0.0
        while remaining > 1e-9 and lots:
            lot = lots[0]
            take = min(lot[0], remaining)
            # short: P&L = original credit + close-debit (debit is negative, so credit > |debit| is profit)
            self.realized[key] += take * (lot[1] + unit_cost)
            lot[0] -= take
            remaining -= take
            if lot[0] <= 1e-9:
                lots.pop(0)
        if remaining > 1e-9 and amount != 0:
            # Pre-CSV short position being closed — debit without a matching
            # original credit. Record as unknown-basis cash flow.
            self.unknown_basis_proceeds += remaining * unit_cost

    def open_holdings(self, account: str = "all") -> List[OptionHolding]:
        out: List[OptionHolding] = []
        for key, lots in self.long_lots.items():
            qty = sum(l[0] for l in lots)
            if qty < 1e-9:
                continue
            cost_basis = sum(l[0] * l[1] for l in lots)  # negative (paid)
            avg_cost = abs(cost_basis) / qty if qty else 0.0
            out.append(OptionHolding(
                underlying=key[0], side=key[1], strike=key[2], expiry=key[3],
                position="long",
                quantity=round(qty, 4),
                avg_cost=round(avg_cost, 4),
                cost_basis=round(cost_basis, 2),
                realized_pnl=round(self.realized.get(key, 0.0), 2),
                account=account,
            ))
        for key, lots in self.short_lots.items():
            qty = sum(l[0] for l in lots)
            if qty < 1e-9:
                continue
            cost_basis = sum(l[0] * l[1] for l in lots)  # positive (credit)
            avg_cost = cost_basis / qty if qty else 0.0
            out.append(OptionHolding(
                underlying=key[0], side=key[1], strike=key[2], expiry=key[3],
                position="short",
                quantity=round(qty, 4),
                avg_cost=round(avg_cost, 4),
                cost_basis=round(cost_basis, 2),
                realized_pnl=round(self.realized.get(key, 0.0), 2),
                account=account,
            ))
        # Group by underlying, then by expiry.
        out.sort(key=lambda h: (h.underlying, h.expiry, h.side, h.strike))
        return out

    def total_realized(self) -> float:
        return sum(self.realized.values())


# --- public entry points --------------------------------------------------

_last_ledger: Optional["_FifoLedger"] = None  # scratch for compute_summary to peek at
_last_option_ledger: Optional["_OptionLedger"] = None


def compute_equity_holdings(account: Optional[str] = None) -> List[EquityHolding]:
    """Replay activity into current equity holdings. Scope by `account`
    (`'brokerage'` / `'roth_ira'` / `'all'` / None → all). Pre-CSV opening
    balances are inferred from CDIV 'N shares' hints so positions purchased
    before the earliest activity date still appear; sells of shares we
    never saw bought are recorded as `unknown_basis_proceeds` on the summary.
    """
    global _last_ledger
    account = account or ALL_ACCOUNTS
    ledger = _FifoLedger()
    for row in _all_rows_ascending(account):
        code = row["trans_code"]
        symbol = row["instrument"]
        if not symbol:
            continue
        # CDIV: use it as a hint for pre-CSV opening balance.
        if code in _DIVIDEND_TRANS:
            reported = _cdiv_share_count(row["description"])
            if reported is not None:
                held = ledger.total_qty(symbol)
                gap = reported - held
                if gap > 1e-6:
                    ledger.inject_opening(symbol, gap)
            continue
        if code not in _EQUITY_TRANS:
            continue
        qty = row["quantity"]
        price = row["price"]
        if not qty:
            continue
        unit = price if price is not None else 0.0
        if code in _EQUITY_BUY:
            ledger.buy(symbol, qty, unit)
        else:
            ledger.sell(symbol, qty, unit)
    _last_ledger = ledger
    return ledger.open_holdings(account=account)


def compute_option_holdings(account: Optional[str] = None) -> List[OptionHolding]:
    global _last_option_ledger
    account = account or ALL_ACCOUNTS
    ledger = _OptionLedger()
    for row in _all_rows_ascending(account):
        code = row["trans_code"]
        if code not in _OPTION_TRANS:
            continue
        leg = parse_option_description(row["description"])
        qty = row["quantity"] or 0.0
        amount = row["amount"] or 0.0
        if leg is None or qty <= 0:
            continue
        if code == "BTO":
            ledger.open_long(leg, qty, amount)
        elif code == "STO":
            ledger.open_short(leg, qty, amount)
        elif code == "STC":
            ledger.close_long(leg, qty, amount)
        elif code == "BTC":
            ledger.close_short(leg, qty, amount)
        elif code in ("OEXP", "OCA"):
            # Expired / cancelled — close at zero. Try long first; if nothing
            # open long for this leg, close short.
            key = (leg.underlying, leg.side, leg.strike, leg.expiry)
            if sum(l[0] for l in ledger.long_lots.get(key, [])) > 1e-9:
                ledger.close_long(leg, qty, 0.0)
            else:
                ledger.close_short(leg, qty, 0.0)
        elif code in ("OASGN", "OEXCS"):
            # Assignment / exercise — treat as close at zero option P&L (stock
            # leg is recorded separately as Buy/Sell).
            key = (leg.underlying, leg.side, leg.strike, leg.expiry)
            if sum(l[0] for l in ledger.long_lots.get(key, [])) > 1e-9:
                ledger.close_long(leg, qty, 0.0)
            else:
                ledger.close_short(leg, qty, 0.0)
    _last_option_ledger = ledger
    return ledger.open_holdings(account=account)


def _sum_amount(trans_codes: set, account: Optional[str] = None) -> float:
    conn = get_conn()
    placeholders = ",".join("?" * len(trans_codes))
    params: tuple = tuple(trans_codes)
    where = f"trans_code IN ({placeholders})"
    if account and account != ALL_ACCOUNTS:
        where += " AND account = ?"
        params = params + (account,)
    cur = conn.execute(
        f"SELECT COALESCE(SUM(amount), 0) FROM robinhood_activity WHERE {where}",
        params,
    )
    return float(cur.fetchone()[0] or 0.0)


# --- live-price enrichment (60s in-process TTL) ---------------------------

_PRICE_CACHE: Dict[str, tuple] = {}
_PRICE_TTL_SEC = 60.0


def _cached_price(symbol: str) -> Optional[float]:
    now = time.time()
    entry = _PRICE_CACHE.get(symbol)
    if entry and now - entry[0] < _PRICE_TTL_SEC:
        return entry[1]
    try:
        # Late import — yfinance is optional at module-load time.
        from data.market_data import get_ticker_price  # type: ignore
        price = float(get_ticker_price(symbol))
    except Exception:
        price = None
    _PRICE_CACHE[symbol] = (now, price)
    return price


def enrich_equity_with_prices(holdings: List[EquityHolding]) -> List[EquityHolding]:
    for h in holdings:
        price = _cached_price(h.symbol)
        if price is None:
            continue
        h.current_price = round(price, 4)
        h.market_value = round(price * h.quantity, 2)
        h.unrealized_pnl = round((price - h.avg_cost) * h.quantity, 2)
    return holdings


# --- summary --------------------------------------------------------------

def compute_summary(
    equities: List[EquityHolding],
    options: List[OptionHolding],
    account: Optional[str] = None,
) -> CashSummary:
    account = account or ALL_ACCOUNTS
    dividends = _sum_amount(_DIVIDEND_TRANS, account)
    interest = _sum_amount(_INTEREST_TRANS, account)
    fees = _sum_amount(_FEE_TRANS, account)           # negative numbers
    transfers = _sum_amount(_TRANSFER_TRANS, account) # ACH in is positive, ACH out negative

    equity_realized = 0.0
    equity_unrealized = 0.0
    equity_market_value = 0.0
    total_invested = 0.0
    for h in equities:
        equity_realized += h.realized_pnl
        total_invested += h.cost_basis
        if h.market_value is not None:
            equity_market_value += h.market_value
        if h.unrealized_pnl is not None:
            equity_unrealized += h.unrealized_pnl

    option_realized = sum(o.realized_pnl for o in options)
    # Per-leg market_value is gross (always positive); for NAV we need the
    # signed contribution: long legs are assets (+mv), short legs are
    # liabilities to close (-mv).
    option_market_value = sum(
        ((o.market_value or 0.0) if o.position == "long" else -(o.market_value or 0.0))
        for o in options
    )
    option_unrealized = sum((o.unrealized_pnl or 0.0) for o in options)
    # Gross premium flowed across all legs (informational; not used in NAV).
    option_cost_basis = sum(abs(o.cost_basis) for o in options)
    unknown_basis = 0.0
    if _last_ledger is not None:
        unknown_basis += sum(_last_ledger.unknown_basis_proceeds.values())
    if _last_option_ledger is not None:
        unknown_basis += abs(_last_option_ledger.unknown_basis_proceeds)

    nav = round(equity_market_value + option_market_value, 2)  # CSV mode: cash_balance is 0

    return CashSummary(
        cash_net_transfers=round(transfers, 2),
        dividends_ytd=round(dividends, 2),
        interest_ytd=round(interest, 2),
        fees_ytd=round(fees, 2),
        realized_pnl=round(equity_realized + option_realized, 2),
        unrealized_pnl=round(equity_unrealized + option_unrealized, 2),
        total_market_value=round(equity_market_value, 2),
        total_invested=round(total_invested, 2),
        unknown_basis_proceeds=round(unknown_basis, 2),
        cash_balance=0.0,
        option_market_value=round(option_market_value, 2),
        option_cost_basis=round(option_cost_basis, 2),
        nav=nav,
    )


# --- live snapshot views (Robinhood API source) ---------------------------

def _equities_from_snapshot_row(row) -> List[EquityHolding]:
    """Deserialise EquityHolding objects from one snapshot DB row."""
    payload = json.loads(row["payload_json"])
    out: List[EquityHolding] = []
    for h in payload.get("equities", []):
        try:
            out.append(EquityHolding(**h))
        except TypeError:
            continue
    return out


def _options_from_snapshot_row(row) -> List[OptionHolding]:
    """Deserialise OptionHolding objects from one snapshot DB row."""
    import dataclasses as _dc
    known = {f.name for f in _dc.fields(OptionHolding)}
    payload = json.loads(row["payload_json"])
    out: List[OptionHolding] = []
    for o in payload.get("options", []):
        try:
            filtered = {k: v for k, v in o.items() if k in known}
            out.append(OptionHolding(**filtered))
        except TypeError:
            continue
    return out


def compute_live_holdings(account: Optional[str] = None) -> List[EquityHolding]:
    """Return equity holdings from the latest robinhood_live_snapshot row(s).

    When account is None or 'all', merges the most recent snapshot for every
    distinct account tag so Roth IRA + brokerage positions are both returned.
    Returns an empty list if no snapshots exist yet.
    """
    if not account or account == "all":
        rows = latest_live_snapshots_all()
        if not rows:
            # Fall back to legacy single-row query in case only an 'all'
            # tagged row exists (pre-migration snapshots).
            row = latest_live_snapshot(None)
            if row is None:
                return []
            return _equities_from_snapshot_row(row)
        out: List[EquityHolding] = []
        for row in rows:
            out.extend(_equities_from_snapshot_row(row))
        return out

    row = latest_live_snapshot(account)
    if row is None:
        return []
    return _equities_from_snapshot_row(row)


def compute_live_options(account: Optional[str] = None) -> List[OptionHolding]:
    """Return option holdings from the latest live snapshot(s).

    When account is None or 'all', merges across all known account tags.
    Applies a Black-Scholes fallback for any legs still missing market_value.
    """
    if not account or account == "all":
        rows = latest_live_snapshots_all()
        if not rows:
            row = latest_live_snapshot(None)
            if row is None:
                return []
            out_rows = [row]
        else:
            out_rows = list(rows)
        out: List[OptionHolding] = []
        for row in out_rows:
            out.extend(_options_from_snapshot_row(row))
    else:
        row = latest_live_snapshot(account)
        if row is None:
            return []
        out = _options_from_snapshot_row(row)

    # Enrich any legs still missing market_value with the BS fallback.
    missing = [h for h in out if h.market_value is None]
    if missing:
        try:
            from brokers.robinhood_api import _enrich_option_market_values
            _enrich_option_market_values(missing)
        except Exception:
            pass

    return out


def compute_live_summary(
    equities: List[EquityHolding],
    options: List[OptionHolding],
    account: Optional[str] = None,
) -> CashSummary:
    """Build a CashSummary from a live snapshot. The Robinhood live API
    doesn't expose YTD dividends/interest/fees the same way the activity
    CSV does, so those fields are zero in live mode — callers that need
    them should fall back to the CSV-derived summary."""
    cash_balance = 0.0
    if account is None or account == ALL_ACCOUNTS:
        # Sum cash across all accounts so /summary?account=all reflects every
        # account's cash position (brokerage debit + IRA cash, etc.)
        for r in latest_live_snapshots_all():
            payload = json.loads(r["payload_json"])
            acct = payload.get("account_summary") or {}
            cash_balance += float(acct.get("cash") or 0.0)
    else:
        row = latest_live_snapshot(account)
        if row is not None:
            payload = json.loads(row["payload_json"])
            acct = payload.get("account_summary") or {}
            cash_balance = float(acct.get("cash") or 0.0)

    equity_market_value = sum((h.market_value or 0.0) for h in equities)
    equity_unrealized = sum((h.unrealized_pnl or 0.0) for h in equities)
    invested = sum(h.cost_basis for h in equities)

    # Per-leg market_value is gross (always positive); sign-correct for NAV:
    # long legs are assets (+mv), short legs are liabilities to close (-mv).
    option_market_value = sum(
        ((o.market_value or 0.0) if o.position == "long" else -(o.market_value or 0.0))
        for o in options
    )
    option_unrealized = sum((o.unrealized_pnl or 0.0) for o in options)
    option_cost_basis = sum(abs(o.cost_basis) for o in options)

    nav = round(equity_market_value + option_market_value + cash_balance, 2)

    return CashSummary(
        cash_net_transfers=0.0,  # not meaningful from live API; use cash_balance instead
        dividends_ytd=0.0,
        interest_ytd=0.0,
        fees_ytd=0.0,
        realized_pnl=0.0,  # not surfaced by live API
        unrealized_pnl=round(equity_unrealized + option_unrealized, 2),
        total_market_value=round(equity_market_value, 2),
        total_invested=round(invested, 2),
        unknown_basis_proceeds=0.0,
        cash_balance=round(cash_balance, 2),
        option_market_value=round(option_market_value, 2),
        option_cost_basis=round(option_cost_basis, 2),
        nav=nav,
    )


def serialize_live_snapshot(
    equities: List[EquityHolding],
    options: List[OptionHolding],
    account_summary: Optional[dict] = None,
) -> str:
    """Serialize live data to JSON for storage in robinhood_live_snapshot.payload_json."""
    return json.dumps({
        "equities": [asdict(h) for h in equities],
        "options": [asdict(h) for h in options],
        "account_summary": account_summary or {},
    })


# --- activity timeline ----------------------------------------------------

def recent_activity(
    limit: int = 50,
    trans_code: Optional[str] = None,
    account: Optional[str] = None,
) -> List[ActivityRowDTO]:
    conn = get_conn()
    where = []
    params: list = []
    if trans_code:
        where.append("trans_code = ?")
        params.append(trans_code)
    if account and account != ALL_ACCOUNTS:
        where.append("account = ?")
        params.append(account)
    sql = """
        SELECT activity_date, process_date, settle_date, instrument,
               description, trans_code, quantity, price, amount
        FROM robinhood_activity
    """
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY activity_date DESC, row_hash DESC LIMIT ?"
    params.append(limit)
    cur = conn.execute(sql, tuple(params))
    return [ActivityRowDTO(**dict(r)) for r in cur.fetchall()]
