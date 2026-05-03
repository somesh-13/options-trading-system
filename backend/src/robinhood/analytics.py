"""Adapter layer between Robinhood holdings and the project's analytics modules.

Robinhood option legs are stored as `{underlying, side, strike, expiry, position,
quantity}`; the analytics functions in `strategy/hedging.py` and friends expect
`{S, K, T, r, sigma, option_type, qty}`. This module converts between the two
shapes (looking up live spot + realized HV per underlying) and then delegates to
the existing analytics. Each `*_for_account` function is the per-endpoint entry
point used by `/api/robinhood/analytics/*` routes.
"""

from __future__ import annotations

from datetime import date
from typing import Dict, List, Optional

from .portfolio import (
    OptionHolding,
    _cached_price,
    compute_live_holdings,
    compute_live_options,
    compute_live_summary,
)

from data.cifr_data import get_historical_volatility  # type: ignore
from pricing.pnl_attribution import stress_test_portfolio  # type: ignore
from risk.limits import RiskLimits, check_drawdown, check_position_limits  # type: ignore
from strategy.hedging import (  # type: ignore
    aggregate_portfolio_greeks,
    check_rebalance_triggers,
    compute_hedge_ratio,
)


# Pricing assumptions baked into every Greeks computation done here. They are
# returned in the response payload so the UI can label the result honestly.
_RISK_FREE_RATE = 0.045
_HV_WINDOW_DAYS = 30
_VOL_FALLBACK = 0.50  # used when yfinance lookup fails (e.g. delisted ticker)


def _years_to_expiry(expiry_iso: str, today: Optional[date] = None) -> Optional[float]:
    """Years between today and the expiry date, or None if expired/invalid."""
    try:
        exp = date.fromisoformat(expiry_iso)
    except (TypeError, ValueError):
        return None
    today = today or date.today()
    days = (exp - today).days
    if days <= 0:
        return None
    return days / 365.0


def _signed_qty(leg: OptionHolding) -> float:
    """`aggregate_portfolio_greeks` expects negative qty for short legs."""
    qty = leg.quantity
    return -qty if leg.position == "short" else qty


# Per-call cache so a single endpoint invocation doesn't fetch the same
# ticker's HV more than once. yfinance is the slow path here.
def _build_hv_cache(tickers: List[str]) -> Dict[str, float]:
    cache: Dict[str, float] = {}
    for t in tickers:
        if t in cache:
            continue
        try:
            cache[t] = float(get_historical_volatility(t, window=_HV_WINDOW_DAYS))
        except Exception:
            cache[t] = _VOL_FALLBACK
    return cache


def options_as_position_dicts(account: str = "all") -> Dict[str, list]:
    """Convert Robinhood option holdings to `aggregate_portfolio_greeks` input.

    Returns a dict with:
      - `positions`: list of position dicts (S, K, T, r, sigma, option_type, qty)
      - `skipped`:   list of legs that couldn't be priced, with a reason
      - `assumptions`: {risk_free_rate, hv_window_days, vol_fallback}
    """
    legs = compute_live_options(account)
    underlyings = sorted({leg.underlying for leg in legs})
    hv = _build_hv_cache(underlyings)

    positions: list[dict] = []
    skipped: list[dict] = []

    for leg in legs:
        T = _years_to_expiry(leg.expiry)
        if T is None:
            skipped.append({
                "underlying": leg.underlying,
                "side": leg.side,
                "strike": leg.strike,
                "expiry": leg.expiry,
                "position": leg.position,
                "qty": leg.quantity,
                "reason": "expired_or_invalid_expiry",
            })
            continue

        spot = _cached_price(leg.underlying)
        if spot is None or spot <= 0:
            skipped.append({
                "underlying": leg.underlying,
                "side": leg.side,
                "strike": leg.strike,
                "expiry": leg.expiry,
                "position": leg.position,
                "qty": leg.quantity,
                "reason": "no_spot_price",
            })
            continue

        sigma = hv.get(leg.underlying, _VOL_FALLBACK)
        positions.append({
            "underlying": leg.underlying,  # decorative — `aggregate_portfolio_greeks` ignores extras
            "expiry": leg.expiry,
            "position": leg.position,
            "S": float(spot),
            "K": float(leg.strike),
            "T": float(T),
            "r": _RISK_FREE_RATE,
            "sigma": float(sigma),
            "option_type": leg.side.lower(),
            "qty": float(_signed_qty(leg)),
        })

    return {
        "positions": positions,
        "skipped": skipped,
        "assumptions": {
            "risk_free_rate": _RISK_FREE_RATE,
            "hv_window_days": _HV_WINDOW_DAYS,
            "vol_fallback": _VOL_FALLBACK,
            "vol_source": "realized_hv_yfinance",
        },
    }


def _no_positions_response(skipped: list) -> dict:
    if not skipped:
        return {
            "error": "no_live_snapshot",
            "message": (
                "No live Robinhood snapshot available. Run "
                "POST /api/robinhood/sync to pull positions from the broker."
            ),
            "skipped": [],
        }
    return {
        "error": "no_priceable_options",
        "message": (
            "No option legs could be priced. They may all be expired, or the "
            "underlying spot price could not be fetched."
        ),
        "skipped": skipped,
    }


def portfolio_greeks_for_account(account: str = "all") -> dict:
    bundle = options_as_position_dicts(account)
    positions = bundle["positions"]
    if not positions:
        return _no_positions_response(bundle["skipped"])
    result = aggregate_portfolio_greeks(positions)
    result["skipped"] = bundle["skipped"]
    result["assumptions"] = bundle["assumptions"]
    return result


def hedge_ratio_for_account(account: str = "all", target_delta: float = 0.0) -> dict:
    bundle = options_as_position_dicts(account)
    positions = bundle["positions"]
    if not positions:
        return _no_positions_response(bundle["skipped"])
    result = compute_hedge_ratio(positions, target_delta=target_delta)
    result["skipped"] = bundle["skipped"]
    result["assumptions"] = bundle["assumptions"]
    return result


def rebalance_check_for_account(
    account: str = "all",
    delta_limit: float = 1000.0,
    gamma_limit: float = 100.0,
    vega_limit: float = 1000.0,
) -> dict:
    # Defaults sized for a multi-ticker portfolio (~$50k+ NAV, dozens of legs).
    # Tighter values like 100/50/500 fired constantly and were originally
    # meant for single-name option books.
    bundle = options_as_position_dicts(account)
    positions = bundle["positions"]
    if not positions:
        return _no_positions_response(bundle["skipped"])
    result = check_rebalance_triggers(
        positions,
        delta_limit=delta_limit,
        gamma_limit=gamma_limit,
        vega_limit=vega_limit,
    )
    result["skipped"] = bundle["skipped"]
    result["assumptions"] = bundle["assumptions"]
    return result


def stress_test_for_account(
    account: str = "all",
    spot_shock_pct: float = 0.0,
    vol_shock_pct: float = 0.0,
) -> dict:
    bundle = options_as_position_dicts(account)
    positions = bundle["positions"]
    if not positions:
        return _no_positions_response(bundle["skipped"])
    result = stress_test_portfolio(
        positions=positions,
        spot_shock_pct=spot_shock_pct,
        vol_shock_pct=vol_shock_pct,
    )
    # `stress_test_portfolio` may return a dataclass-like object or a dict;
    # normalise to dict.
    if hasattr(result, "__dict__") and not isinstance(result, dict):
        result = dict(result.__dict__)
    if isinstance(result, dict):
        result["skipped"] = bundle["skipped"]
        result["assumptions"] = bundle["assumptions"]
    return result


def limits_check_for_account(
    account: str = "all",
    max_portfolio_delta: float = 10000.0,
    max_portfolio_gamma: float = 500.0,
    max_portfolio_vega: float = 10000.0,
) -> dict:
    greeks = portfolio_greeks_for_account(account)
    if greeks.get("error"):
        return greeks
    limits = RiskLimits(
        max_portfolio_delta=max_portfolio_delta,
        max_portfolio_gamma=max_portfolio_gamma,
        max_portfolio_vega=max_portfolio_vega,
    )
    result = check_position_limits(greeks, limits)
    result["portfolio_greeks"] = {
        k: greeks.get(k)
        for k in ("total_delta", "total_gamma", "total_vega", "total_theta", "total_rho")
    }
    return result


def drawdown_for_account(account: str = "all", limit: float = 0.10) -> dict:
    """Snapshot drawdown estimate.

    There is no per-day equity history for the Robinhood ledger today, so this
    is a conservative point-in-time estimate rather than a true rolling
    drawdown:
      - current_equity = market value of holdings + net cash transferred in
        + dividends + interest + fees (fees are negative)
      - peak_equity = max(current_equity, gross invested capital)

    The response includes both inputs so the UI can label this clearly.
    """
    equities = compute_live_holdings(account)
    options = compute_live_options(account)
    if not equities and not options:
        return {
            "error": "no_live_snapshot",
            "message": (
                "No live Robinhood snapshot available. Run "
                "POST /api/robinhood/sync to pull positions from the broker."
            ),
        }
    summary = compute_live_summary(equities, options, account)

    market_value = summary.total_market_value
    # Live snapshot doesn't surface dividends/interest/fees, so cash_flows is
    # just net ACH transfers.
    cash_flows = summary.cash_net_transfers
    current_equity = market_value + cash_flows
    peak_equity = max(current_equity, summary.total_invested + cash_flows)

    if peak_equity <= 0:
        return {
            "error": "no_equity_data",
            "message": "Could not derive a positive peak equity value from the ledger.",
            "current_equity": round(current_equity, 2),
            "peak_equity": round(peak_equity, 2),
        }

    result = check_drawdown(current_equity, peak_equity, limit)
    result["inputs"] = {
        "market_value": round(market_value, 2),
        "cash_flows": round(cash_flows, 2),
        "total_invested": round(summary.total_invested, 2),
    }
    result["caveat"] = (
        "Snapshot estimate: peak_equity is approximated from gross invested "
        "capital, not a daily equity history."
    )
    return result
