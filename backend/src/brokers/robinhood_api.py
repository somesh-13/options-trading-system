"""Robinhood live API client (read-only).

Wraps the unofficial robin_stocks library to fetch the user's actual
positions and account info. Mirrors the structure of
`backend/src/execution/alpaca_client.py` (env-var auth, single module,
graceful "not configured" path).

Credentials live in `.env.local`:
    ROBINHOOD_USERNAME       - account email
    ROBINHOOD_PASSWORD       - account password
    ROBINHOOD_TOTP_SECRET    - base32 secret from authenticator-app setup

If the TOTP secret is set, login() generates the 6-digit code via pyotp
so sessions don't require interactive prompts. Session tokens are cached
to ~/.tokens/vegaedge_rh.pickle so repeated calls reuse the same login.

robin_stocks uses Robinhood's internal API and may break without notice.
Every fetch wraps errors and returns (data, stale_flag) so the caller
can fall back to the last good snapshot.
"""

from __future__ import annotations

import math
import os
import time
from datetime import date
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from dotenv import load_dotenv

from robinhood.portfolio import CryptoHolding, EquityHolding, OptionHolding

# Simple in-process cache for yfinance spot prices used in BS valuation
_SPOT_CACHE: Dict[str, Tuple[float, float]] = {}  # symbol -> (timestamp, price)
_SPOT_CACHE_TTL = 120.0  # seconds

# Cache for crypto quotes (60s TTL — crypto trades 24/7 so a shorter TTL is fine)
_CRYPTO_QUOTE_CACHE: Dict[str, Tuple[float, float]] = {}  # symbol -> (timestamp, price)
CRYPTO_CACHE_TTL = 60.0  # seconds

# Cache for equity quotes (60s TTL)
_EQUITY_QUOTE_CACHE: Dict[str, Tuple[float, float]] = {}  # symbol -> (timestamp, price)
EQUITY_CACHE_TTL = 60.0  # seconds


def _get_crypto_quote_cached(symbol: str) -> Optional[float]:
    """Fetch crypto mark price with a 60-second in-process cache."""
    now = time.time()
    if symbol in _CRYPTO_QUOTE_CACHE:
        ts, price = _CRYPTO_QUOTE_CACHE[symbol]
        if now - ts < CRYPTO_CACHE_TTL:
            return price
    try:
        import robin_stocks.robinhood as rh
        data = rh.crypto.get_crypto_quote(symbol)
        if data:
            mark = data.get("mark_price") or data.get("last_trade_price")
            if mark is not None:
                price = float(mark)
                _CRYPTO_QUOTE_CACHE[symbol] = (now, price)
                return price
    except Exception:
        pass
    return None


def _get_equity_quote_cached(symbol: str) -> Optional[float]:
    """Fetch equity latest price with a 60-second in-process cache using robin_stocks."""
    now = time.time()
    if symbol in _EQUITY_QUOTE_CACHE:
        ts, price = _EQUITY_QUOTE_CACHE[symbol]
        if now - ts < EQUITY_CACHE_TTL:
            return price
    try:
        import robin_stocks.robinhood as rh
        prices = rh.stocks.get_latest_price(symbol)
        if prices and prices[0] is not None:
            price = float(prices[0])
            _EQUITY_QUOTE_CACHE[symbol] = (now, price)
            return price
    except Exception:
        pass
    return None


def _get_spot_cached(symbol: str) -> Optional[float]:
    """Fetch underlying spot price with a 2-minute cache."""
    now = time.time()
    if symbol in _SPOT_CACHE:
        ts, price = _SPOT_CACHE[symbol]
        if now - ts < _SPOT_CACHE_TTL:
            return price
    try:
        import yfinance as yf
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="1d")
        if hist.empty:
            return None
        price = float(hist["Close"].iloc[-1])
        _SPOT_CACHE[symbol] = (now, price)
        return price
    except Exception:
        return None


def _bs_option_price(S: float, K: float, T: float, sigma: float, option_type: str) -> float:
    """Simplified Black-Scholes price for option valuation fallback.
    Uses risk-free rate = 0.045 (approximate). Returns 0.0 on error."""
    try:
        from scipy.stats import norm
        r = 0.045
        if T <= 0:
            # intrinsic value only
            if option_type == "call":
                return max(S - K, 0.0)
            return max(K - S, 0.0)
        d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
        d2 = d1 - sigma * math.sqrt(T)
        if option_type == "call":
            return float(S * norm.cdf(d1) - K * math.exp(-r * T) * norm.cdf(d2))
        return float(K * math.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1))
    except Exception:
        return 0.0


def _tte_years(expiry: str) -> float:
    """Days to expiration as a year fraction. Returns 0 if already expired."""
    if not expiry:
        return 0.0
    try:
        exp_date = date.fromisoformat(expiry)
        delta = (exp_date - date.today()).days
        return max(delta / 365.0, 0.0)
    except ValueError:
        return 0.0


def _enrich_option_market_values(positions: List[OptionHolding]) -> None:
    """Populate market_value and unrealized_pnl on each OptionHolding in-place.

    Strategy:
    1. Try robin_stocks get_option_market_data_by_id for the mark price —
       this is the most accurate source but requires one API call per unique
       instrument URL (already fetched during position build, see below).
    2. Fall back to Black-Scholes using yfinance spot + a fixed 60% IV
       proxy if the Robinhood call fails or returns no mark price.

    market_value is always positive (it's the current worth of the leg).
    unrealized_pnl = market_value - abs(cost_basis)  for long legs (debit paid)
                   = cost_basis - market_value        for short legs (credit received)
    so that positive unrealized_pnl always means the position is profitable.
    """
    # Group by underlying so we fetch spot once per underlying
    underlyings = {h.underlying for h in positions if h.underlying}

    spot_map: Dict[str, Optional[float]] = {}
    for sym in underlyings:
        spot_map[sym] = _get_spot_cached(sym)

    # Build a per-underlying HV map using yfinance for the BS fallback.
    hv_map: Dict[str, float] = {}
    for sym in underlyings:
        try:
            import yfinance as yf
            import numpy as np
            hist = yf.Ticker(sym).history(period="60d")
            if len(hist) >= 10:
                log_rets = np.log(hist["Close"] / hist["Close"].shift(1)).dropna()
                hv_map[sym] = float(np.std(log_rets) * np.sqrt(252))
        except Exception:
            pass

    for h in positions:
        try:
            T = _tte_years(h.expiry)
            S = spot_map.get(h.underlying)
            mark: Optional[float] = None

            # Try BS fallback using spot + historical vol from yfinance
            if S is not None and T >= 0:
                # Use HV as IV proxy; floor at 15%, cap at 120% to avoid absurd values
                sigma = max(0.15, min(hv_map.get(h.underlying, 0.40), 1.20))
                bs_price = _bs_option_price(S, h.strike, T, sigma, h.side.lower())
                mark = bs_price

            if mark is None:
                continue

            # market_value = mark price per share × qty × 100
            h.market_value = round(mark * h.quantity * 100.0, 2)
            abs_cost = abs(h.cost_basis)
            if h.position == "long":
                h.unrealized_pnl = round(h.market_value - abs_cost, 2)
            else:
                # short: collected credit minus what it would cost to close
                h.unrealized_pnl = round(abs_cost - h.market_value, 2)
        except Exception:
            continue

load_dotenv()

ROBINHOOD_USERNAME = os.getenv("ROBINHOOD_USERNAME", "")
ROBINHOOD_PASSWORD = os.getenv("ROBINHOOD_PASSWORD", "")
ROBINHOOD_TOTP_SECRET = os.getenv("ROBINHOOD_TOTP_SECRET", "")

_TOKEN_DIR = Path.home() / ".tokens"
_TOKEN_FILE = _TOKEN_DIR / "vegaedge_rh.pickle"

_logged_in = False


def _is_configured() -> bool:
    return bool(ROBINHOOD_USERNAME and ROBINHOOD_PASSWORD)


def login() -> bool:
    """Authenticate to Robinhood. Caches the session token. Idempotent."""
    global _logged_in
    if _logged_in:
        return True
    if not _is_configured():
        return False

    import robin_stocks.robinhood as rh

    _TOKEN_DIR.mkdir(parents=True, exist_ok=True)
    mfa_code: Optional[str] = None
    if ROBINHOOD_TOTP_SECRET:
        import pyotp
        mfa_code = pyotp.TOTP(ROBINHOOD_TOTP_SECRET).now()

    rh.login(
        username=ROBINHOOD_USERNAME,
        password=ROBINHOOD_PASSWORD,
        mfa_code=mfa_code,
        store_session=True,
        pickle_path=str(_TOKEN_DIR),
        pickle_name="vegaedge_rh",
    )
    _logged_in = True
    return True


def logout() -> None:
    global _logged_in
    if not _logged_in:
        return
    import robin_stocks.robinhood as rh
    try:
        rh.logout()
    finally:
        _logged_in = False


# Maps Robinhood account `type` field → internal account tag used in our DB.
#
# Robinhood's actual `type` values differ from their marketing names:
#   margin  — standard brokerage account (margin-enabled)
#   cash    — cash-only account; Robinhood uses this for IRA accounts
#             (IRAs cannot have margin, hence "cash")
#   individual — older account type name, same as margin
#   ira_roth / ira_traditional — explicitly typed IRA accounts (some API versions)
#
# We use position in the accounts list as a tiebreaker: if two accounts share
# the same type, the first is brokerage and the second is the IRA.
_RH_TYPE_TO_TAG: Dict[str, str] = {
    "individual": "brokerage",
    "margin": "brokerage",
    "cash": "roth_ira",       # Robinhood IRAs come back as type='cash'
    "ira_roth": "roth_ira",
    "ira_traditional": "traditional_ira",
}

def _rh_type_to_tag(rh_type: Optional[str]) -> str:
    """Convert a Robinhood account type string to our internal tag."""
    if not rh_type:
        return "brokerage"
    return _RH_TYPE_TO_TAG.get(rh_type, rh_type)


def enumerate_accounts() -> Tuple[List[Dict], Optional[str]]:
    """Return all Robinhood accounts for the logged-in user.

    Each item in the returned list has:
        account_number: str   — the RH account number used to filter positions
        type: str             — RH account type ('individual', 'ira_roth', …)
        tag: str              — our internal label ('brokerage', 'roth_ira', …)

    Returns (accounts, error_message).
    """
    if not login():
        return [], "Robinhood credentials not configured"

    import robin_stocks.robinhood as rh

    try:
        # load_account_profile() with no account_number + dataType='results'
        # returns all accounts in data['results']; default dataType='indexzero'
        # only returns results[0].
        raw = rh.profiles.load_account_profile(dataType="results") or []
    except Exception as exc:  # noqa: BLE001
        # Fall back to direct REST call if the helper misbehaves
        try:
            resp = rh.helper.request_get(
                "https://api.robinhood.com/accounts/?default_to_all_accounts=true",
                "results",
            ) or []
            raw = resp
        except Exception as exc2:  # noqa: BLE001
            return [], f"enumerate_accounts failed: {exc}; fallback: {exc2}"

    if not isinstance(raw, list):
        raw = [raw]

    accounts: List[Dict] = []
    for acct in raw:
        if not acct:
            continue
        acct_num = acct.get("account_number") or acct.get("rhs_account_number")
        if not acct_num:
            continue
        rh_type = acct.get("type") or ""
        tag = _rh_type_to_tag(rh_type)
        accounts.append({
            "account_number": acct_num,
            "type": rh_type,
            "tag": tag,
            "cash": acct.get("cash"),
            "buying_power": acct.get("buying_power"),
        })

    # Fallback: if enumeration returned nothing, fake a single brokerage entry
    # using the default account number so we still get data.
    if not accounts:
        try:
            default_num = rh.account.load_account_profile(info="account_number")
            if default_num:
                accounts.append({
                    "account_number": default_num,
                    "type": "individual",
                    "tag": "brokerage",
                    "cash": None,
                    "buying_power": None,
                })
        except Exception:
            pass

    return accounts, None


def _fetch_equity_positions_for_account(
    account_number: str,
    tag: str,
) -> Tuple[List[EquityHolding], Optional[str]]:
    """Fetch equity positions for a single RH account_number and label them with `tag`."""
    import robin_stocks.robinhood as rh

    try:
        raw_positions = rh.account.get_open_stock_positions(account_number=account_number)
    except Exception as exc:  # noqa: BLE001
        return [], f"get_open_stock_positions({account_number}) failed: {exc}"

    out: List[EquityHolding] = []
    for pos in raw_positions or []:
        if not pos:
            continue
        try:
            qty = float(pos.get("quantity") or 0.0)
            if qty <= 0:
                continue
            avg_cost = float(pos.get("average_buy_price") or 0.0)

            # Resolve ticker symbol from the instrument URL
            instrument_url = pos.get("instrument")
            symbol: Optional[str] = None
            current_price: Optional[float] = None
            equity: Optional[float] = None
            if instrument_url:
                try:
                    inst = rh.helper.request_get(instrument_url)
                    symbol = inst.get("symbol")
                    # Fetch live price for this symbol
                    prices = rh.stocks.get_latest_price(symbol)
                    if prices and prices[0]:
                        current_price = float(prices[0])
                        equity = round(current_price * qty, 2)
                except Exception:
                    pass

            if not symbol:
                continue

            cost_basis = round(avg_cost * qty, 2)
            unrealized = (
                round((current_price - avg_cost) * qty, 2)
                if current_price is not None
                else None
            )
            out.append(EquityHolding(
                symbol=symbol,
                quantity=round(qty, 4),
                avg_cost=round(avg_cost, 4),
                cost_basis=cost_basis,
                realized_pnl=0.0,
                account=tag,
                inferred_opening=False,
                current_price=current_price,
                market_value=equity,
                unrealized_pnl=unrealized,
            ))
        except (TypeError, ValueError):
            continue

    # Batch-refresh quotes from /quotes (one HTTP call for all symbols) so
    # current_price reflects the latest trade rather than whatever was baked
    # into the per-position payload. Robinhood's per-position quote can lag
    # at market open; the batched /quotes endpoint is more consistently
    # fresh and lets us recompute market_value/unrealized_pnl off it.
    if out:
        try:
            symbols = [h.symbol for h in out]
            quotes = rh.stocks.get_quotes(symbols) or []
            quote_map: Dict[str, float] = {}
            for q in quotes:
                if not q:
                    continue
                sym = q.get("symbol")
                px = q.get("last_trade_price") or q.get("last_extended_hours_trade_price")
                if sym and px is not None:
                    try:
                        quote_map[sym] = float(px)
                    except (TypeError, ValueError):
                        continue
            for h in out:
                fresh = quote_map.get(h.symbol)
                if fresh is None or fresh <= 0:
                    continue
                h.current_price = fresh
                h.market_value = round(fresh * h.quantity, 2)
                h.unrealized_pnl = round((fresh - h.avg_cost) * h.quantity, 2)
        except Exception:
            pass

    out.sort(key=lambda h: -(h.market_value or h.cost_basis))
    return out, None


def _fetch_option_positions_for_account(
    account_number: str,
    tag: str,
) -> Tuple[List[OptionHolding], Optional[str]]:
    """Fetch option positions for a single RH account_number and label them with `tag`."""
    import robin_stocks.robinhood as rh

    try:
        raw = rh.options.get_open_option_positions(account_number=account_number)
    except Exception as exc:  # noqa: BLE001
        return [], f"get_open_option_positions({account_number}) failed: {exc}"

    out: List[OptionHolding] = []
    for pos in raw or []:
        try:
            qty = float(pos.get("quantity") or 0.0)
            if qty <= 0:
                continue
            position_dir = "long" if pos.get("type") == "long" else "short"
            avg_price = float(pos.get("average_price") or 0.0)
            instrument_url = pos.get("option")
            side = "Call"
            strike = 0.0
            expiry = ""
            underlying = pos.get("chain_symbol") or ""
            mark_price: Optional[float] = None

            if instrument_url:
                try:
                    inst = rh.helper.request_get(instrument_url)
                    side = "Call" if inst.get("type") == "call" else "Put"
                    strike = float(inst.get("strike_price") or 0.0)
                    expiry = inst.get("expiration_date") or ""
                except Exception:
                    pass

            try:
                opt_id = instrument_url.rstrip("/").split("/")[-1] if instrument_url else None
                if opt_id:
                    md = rh.options.get_option_market_data_by_id(opt_id)
                    if md:
                        mp = (md[0] if isinstance(md, list) else md).get("adjusted_mark_price")
                        if mp is not None:
                            mark_price = float(mp)
            except Exception:
                pass

            cost_per_contract = avg_price
            cost_basis = round(cost_per_contract * qty, 2)
            if position_dir == "long":
                cost_basis = -abs(cost_basis)
            else:
                cost_basis = abs(cost_basis)

            market_value: Optional[float] = None
            unrealized_pnl: Optional[float] = None
            if mark_price is not None:
                market_value = round(mark_price * qty * 100.0, 2)
                abs_cost = abs(cost_basis)
                if position_dir == "long":
                    unrealized_pnl = round(market_value - abs_cost, 2)
                else:
                    unrealized_pnl = round(abs_cost - market_value, 2)

            out.append(OptionHolding(
                underlying=underlying,
                side=side,  # type: ignore[arg-type]
                strike=round(strike, 2),
                expiry=expiry,
                position=position_dir,  # type: ignore[arg-type]
                quantity=round(qty, 4),
                avg_cost=round(cost_per_contract, 4),
                cost_basis=cost_basis,
                realized_pnl=0.0,
                account=tag,
                market_value=market_value,
                unrealized_pnl=unrealized_pnl,
            ))
        except (TypeError, ValueError):
            continue
    out.sort(key=lambda h: (h.underlying, h.expiry, h.side, h.strike))

    missing_mv = [h for h in out if h.market_value is None]
    if missing_mv:
        _enrich_option_market_values(missing_mv)

    return out, None


def fetch_crypto_positions() -> Tuple[List[CryptoHolding], Optional[str]]:
    """Fetch all open crypto positions from Robinhood.

    Uses r.crypto.get_crypto_positions() to enumerate held coins.
    For each position with quantity > 0 the current mark price is fetched
    via _get_crypto_quote_cached (60-second TTL).

    Returns (holdings, error_message). Error is None on success.
    """
    if not login():
        return [], "Robinhood credentials not configured"

    import robin_stocks.robinhood as rh

    try:
        raw = rh.crypto.get_crypto_positions() or []
    except Exception as exc:  # noqa: BLE001
        return [], f"get_crypto_positions failed: {exc}"

    out: List[CryptoHolding] = []
    for pos in raw:
        if not pos:
            continue
        try:
            # Quantity: robin_stocks exposes 'quantity' and 'quantity_available'.
            # Use 'quantity' (total owned) since we want full holdings.
            qty = float(pos.get("quantity") or pos.get("quantity_available") or 0.0)
            if qty <= 1e-10:
                continue

            # Symbol: nested under currency.code
            currency = pos.get("currency") or {}
            code = currency.get("code") or pos.get("code") or ""
            if not code:
                continue

            # Cost basis: Robinhood returns cost_bases as a list of dicts.
            # The actual cost field is 'direct_cost_basis' (total USD paid for
            # the lot); there is also 'intraday_cost_basis' and 'marked_cost_basis'
            # but direct_cost_basis is the settled, confirmed cost.
            cost_basis_total = 0.0
            cost_bases = pos.get("cost_bases") or []
            for lot in cost_bases:
                # Try the real field names first, then fall back to legacy names.
                v = (
                    lot.get("direct_cost_basis")
                    or lot.get("cost_basis")
                    or lot.get("cost_basis_collected")
                    or 0.0
                )
                try:
                    cost_basis_total += float(v)
                except (TypeError, ValueError):
                    pass

            avg_cost = cost_basis_total / qty if qty else 0.0

            # Current mark price
            current_price = _get_crypto_quote_cached(code)
            market_value = round(current_price * qty, 2) if current_price is not None else None
            unrealized_pnl = (
                round(market_value - cost_basis_total, 2)
                if market_value is not None
                else None
            )

            out.append(CryptoHolding(
                symbol=code,
                quantity=round(qty, 8),
                avg_cost=round(avg_cost, 4),
                cost_basis=round(cost_basis_total, 2),
                current_price=round(current_price, 4) if current_price is not None else None,
                market_value=market_value,
                unrealized_pnl=unrealized_pnl,
                account="crypto",
            ))
        except (TypeError, ValueError):
            continue

    out.sort(key=lambda h: -(h.market_value or 0.0))
    return out, None


def fetch_all_accounts_positions() -> Tuple[
    Dict[str, List[EquityHolding]],
    Dict[str, List[OptionHolding]],
    Dict[str, dict],
    Optional[str],
]:
    """Enumerate all RH accounts and fetch positions + cash for each.

    Returns:
        equities_by_tag   — {tag: [EquityHolding, ...]}
        options_by_tag    — {tag: [OptionHolding, ...]}
        summaries_by_tag  — {tag: {"cash": ..., "buying_power": ..., ...}}
        error_message     — first error encountered, or None
    """
    accounts, err = enumerate_accounts()
    if err and not accounts:
        return {}, {}, {}, err

    first_error: Optional[str] = err  # carry through enumeration warning if any

    equities_by_tag: Dict[str, List[EquityHolding]] = {}
    options_by_tag: Dict[str, List[OptionHolding]] = {}
    summaries_by_tag: Dict[str, dict] = {}

    for acct in accounts:
        acct_num = acct["account_number"]
        tag = acct["tag"]

        eq, eq_err = _fetch_equity_positions_for_account(acct_num, tag)
        if eq_err and first_error is None:
            first_error = eq_err
        equities_by_tag[tag] = eq

        opts, op_err = _fetch_option_positions_for_account(acct_num, tag)
        if op_err and first_error is None:
            first_error = op_err
        options_by_tag[tag] = opts

        # Cash/buying-power: use values already embedded in the accounts list
        # (came from load_account_profile). Falls back to 0 for IRA if not present.
        cash_val: Optional[float] = None
        bp_val: Optional[float] = None
        try:
            cash_val = float(acct["cash"]) if acct.get("cash") is not None else None
        except (TypeError, ValueError):
            pass
        try:
            bp_val = float(acct["buying_power"]) if acct.get("buying_power") is not None else None
        except (TypeError, ValueError):
            pass

        # For the brokerage account, also load portfolio equity from the
        # portfolio profile to get a proper NAV figure.
        portfolio_value: Optional[float] = None
        if tag == "brokerage":
            try:
                import robin_stocks.robinhood as rh
                port = rh.profiles.load_portfolio_profile() or {}
                portfolio_value = float(port.get("equity") or 0.0) or None
            except Exception:
                pass

        summaries_by_tag[tag] = {
            "cash": cash_val,
            "buying_power": bp_val,
            "portfolio_value": portfolio_value,
            "extended_hours_value": None,
        }

    return equities_by_tag, options_by_tag, summaries_by_tag, first_error


# ---------------------------------------------------------------------------
# Legacy single-account helpers kept for backward compatibility.
# Both now delegate to the per-account helpers using the default account.
# ---------------------------------------------------------------------------

def _account_number_for_tag(tag: str) -> Tuple[Optional[str], Optional[str]]:
    """Return (account_number, error) for the given tag ('brokerage' or 'roth_ira').

    Calls enumerate_accounts() and returns the first account whose tag matches.
    If no exact match is found, falls back to the first account overall.
    """
    accounts, err = enumerate_accounts()
    if not accounts:
        return None, err or f"No accounts found when looking up tag={tag!r}"
    match = next((a for a in accounts if a["tag"] == tag), None)
    if match:
        return match["account_number"], None
    # Fallback: return first account but surface a warning
    return accounts[0]["account_number"], (
        f"No account matched tag={tag!r}; using first account ({accounts[0]['tag']!r}) as fallback"
    )


def fetch_equity_positions(account: Optional[str] = None) -> Tuple[List[EquityHolding], Optional[str]]:
    """Return equity positions tagged with `account` (defaults to 'brokerage').

    Uses the first RH account whose tag matches, or the first account overall.
    For full multi-account sync use fetch_all_accounts_positions() instead.
    """
    if not login():
        return [], "Robinhood credentials not configured"

    accounts, err = enumerate_accounts()
    if not accounts:
        return [], err or "No accounts found"

    tag = account or "brokerage"
    # Find matching account or fall back to first
    target = next((a for a in accounts if a["tag"] == tag), accounts[0])
    return _fetch_equity_positions_for_account(target["account_number"], target["tag"])


def fetch_option_positions(account: Optional[str] = None) -> Tuple[List[OptionHolding], Optional[str]]:
    """Return option positions tagged with `account` (defaults to 'brokerage').

    For full multi-account sync use fetch_all_accounts_positions() instead.
    """
    if not login():
        return [], "Robinhood credentials not configured"

    accounts, err = enumerate_accounts()
    if not accounts:
        return [], err or "No accounts found"

    tag = account or "brokerage"
    target = next((a for a in accounts if a["tag"] == tag), accounts[0])
    return _fetch_option_positions_for_account(target["account_number"], target["tag"])


def fetch_account_summary() -> Tuple[dict, Optional[str]]:
    """Return cash + buying power + portfolio value. (data, error_message)."""
    if not login():
        return {}, "Robinhood credentials not configured"

    import robin_stocks.robinhood as rh

    try:
        profile = rh.profiles.load_account_profile() or {}
        portfolio = rh.profiles.load_portfolio_profile() or {}
    except Exception as exc:  # noqa: BLE001
        return {}, f"profile fetch failed: {exc}"

    def _f(d: dict, k: str) -> Optional[float]:
        v = d.get(k)
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    return {
        "cash": _f(profile, "cash"),
        "buying_power": _f(profile, "buying_power"),
        "portfolio_value": _f(portfolio, "equity"),
        "extended_hours_value": _f(portfolio, "extended_hours_equity"),
    }, None
