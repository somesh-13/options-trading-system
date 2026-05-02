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

import os
from pathlib import Path
from typing import List, Optional, Tuple

from dotenv import load_dotenv

from robinhood.portfolio import EquityHolding, OptionHolding

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
    """Return current option positions. (holdings, error_message)."""
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
            if instrument_url:
                try:
                    inst = rh.helper.request_get(instrument_url)
                    side = "Call" if inst.get("type") == "call" else "Put"
                    strike = float(inst.get("strike_price") or 0.0)
                    expiry = inst.get("expiration_date") or ""
                except Exception:
                    pass

            # robin_stocks returns avg_price per share (×100 for cost per contract).
            cost_per_contract = avg_price
            cost_basis = round(cost_per_contract * qty, 2)
            if position_dir == "long":
                cost_basis = -abs(cost_basis)  # debit paid
            else:
                cost_basis = abs(cost_basis)   # credit received

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
            ))
        except (TypeError, ValueError):
            continue
    out.sort(key=lambda h: (h.underlying, h.expiry, h.side, h.strike))
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
