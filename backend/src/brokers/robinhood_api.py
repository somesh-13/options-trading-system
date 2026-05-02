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

from robinhood.portfolio import EquityHolding, OptionHolding

# Simple in-process cache for yfinance spot prices used in BS valuation
_SPOT_CACHE: Dict[str, Tuple[float, float]] = {}  # symbol -> (timestamp, price)
_SPOT_CACHE_TTL = 120.0  # seconds


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


def _account_tag(account: Optional[str]) -> str:
    return account or "brokerage"


def fetch_equity_positions(account: Optional[str] = None) -> Tuple[List[EquityHolding], Optional[str]]:
    """Return current equity positions. (holdings, error_message)."""
    if not login():
        return [], "Robinhood credentials not configured"

    import robin_stocks.robinhood as rh

    try:
        raw = rh.account.build_holdings()
    except Exception as exc:  # noqa: BLE001
        return [], f"build_holdings failed: {exc}"

    out: List[EquityHolding] = []
    tag = _account_tag(account)
    for symbol, info in (raw or {}).items():
        try:
            qty = float(info.get("quantity") or 0.0)
            if qty <= 0:
                continue
            avg_cost = float(info.get("average_buy_price") or 0.0)
            current_price = float(info.get("price") or 0.0) or None
            equity = float(info.get("equity") or 0.0)
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
                realized_pnl=0.0,  # not exposed by build_holdings
                account=tag,
                inferred_opening=False,
                current_price=current_price,
                market_value=round(equity, 2) if equity else None,
                unrealized_pnl=unrealized,
            ))
        except (TypeError, ValueError):
            continue
    out.sort(key=lambda h: -(h.market_value or h.cost_basis))
    return out, None


def fetch_option_positions(account: Optional[str] = None) -> Tuple[List[OptionHolding], Optional[str]]:
    """Return current option positions with market values. (holdings, error_message)."""
    if not login():
        return [], "Robinhood credentials not configured"

    import robin_stocks.robinhood as rh

    try:
        raw = rh.options.get_open_option_positions()
    except Exception as exc:  # noqa: BLE001
        return [], f"get_open_option_positions failed: {exc}"

    out: List[OptionHolding] = []
    tag = _account_tag(account)
    for pos in raw or []:
        try:
            qty = float(pos.get("quantity") or 0.0)
            if qty <= 0:
                continue
            position_dir = "long" if pos.get("type") == "long" else "short"
            avg_price = float(pos.get("average_price") or 0.0)
            # Robinhood returns option metadata via a separate endpoint URL.
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

            # Try to get the mark price directly from RH market data.
            # adjusted_mark_price is per share (multiply by 100 × qty for total MV).
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

            # robin_stocks returns avg_price per share (×100 for cost per contract).
            cost_per_contract = avg_price
            cost_basis = round(cost_per_contract * qty, 2)
            if position_dir == "long":
                cost_basis = -abs(cost_basis)  # debit paid
            else:
                cost_basis = abs(cost_basis)   # credit received

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

    # For any legs still missing market_value, use the BS fallback.
    missing_mv = [h for h in out if h.market_value is None]
    if missing_mv:
        _enrich_option_market_values(missing_mv)

    return out, None


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
