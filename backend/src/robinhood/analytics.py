"""Adapter layer between Robinhood holdings and the project's analytics modules.

Robinhood option legs are stored as `{underlying, side, strike, expiry, position,
quantity}`; the analytics functions in `strategy/hedging.py` and friends expect
`{S, K, T, r, sigma, option_type, qty}`. This module converts between the two
shapes (looking up live spot + realized HV per underlying) and then delegates to
the existing analytics. Each `*_for_account` function is the per-endpoint entry
point used by `/api/robinhood/analytics/*` routes.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Dict, List, Optional

from .portfolio import (
    EquityHolding,
    OptionHolding,
    _cached_price,
    compute_live_holdings,
    compute_live_options,
    compute_live_summary,
)

from data.cifr_data import get_historical_volatility  # type: ignore
from pricing.greeks import calculate_greeks  # type: ignore
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


def _equity_overlay(account: str = "all") -> dict:
    """Aggregate long-share contribution to portfolio Greeks.

    Returns
    -------
    dict with:
      - ``total_share_qty`` (float): sum of long shares across all underlyings.
      - ``equity_delta`` (float): same number — each share is +1 Δ. Shorts in
        equity holdings aren't tracked by Robinhood's holdings export, so we
        treat all equity as long.
      - ``by_underlying`` (Dict[str, dict]): per-symbol ``{share_qty, spot}``
        used by stress testing and per-name hedge views.

    The shape mirrors what ``hedge_ratio_by_underlying_for_account`` already
    layers in for its per-underlying view; this helper centralises it so the
    aggregate analytics (portfolio_greeks, rebalance, stress, hedge_ratio) can
    reuse it instead of silently ignoring stocks.
    """
    by_und: Dict[str, dict] = {}
    total = 0.0
    for h in compute_live_holdings(account):
        qty = float(h.quantity or 0.0)
        if qty == 0:
            continue
        spot = float(h.current_price) if h.current_price else 0.0
        row = by_und.setdefault(h.symbol, {"share_qty": 0.0, "spot": spot})
        row["share_qty"] += qty
        if not row["spot"] and spot:
            row["spot"] = spot
        total += qty
    return {
        "total_share_qty": total,
        "equity_delta": total,
        "by_underlying": by_und,
    }


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
    """Aggregate Greeks across options AND long equity holdings.

    Each share contributes +1 Δ (and 0 to Γ/V/Θ/ρ), so a covered call's
    short-call delta is correctly offset by the underlying shares. The
    response surfaces the option-only and equity-only deltas separately so
    the UI can show the breakdown.
    """
    bundle = options_as_position_dicts(account)
    positions = bundle["positions"]
    overlay = _equity_overlay(account)
    equity_delta = overlay["equity_delta"]

    if not positions and equity_delta == 0:
        return _no_positions_response(bundle["skipped"])

    if positions:
        result = aggregate_portfolio_greeks(positions)
        option_total_delta = result["total_delta"]
    else:
        # Equity-only account — no option Greeks, but still report share Δ.
        result = {
            "total_delta": 0.0,
            "total_gamma": 0.0,
            "total_vega": 0.0,
            "total_theta": 0.0,
            "total_rho": 0.0,
            "position_count": 0,
            "per_position": [],
        }
        option_total_delta = 0.0

    # Layer equity Δ onto the aggregate. Other Greeks unaffected — shares are
    # linear in S, so Γ=V=Θ=ρ=0.
    result["total_delta"] = round(option_total_delta + equity_delta, 4)
    result["option_total_delta"] = round(option_total_delta, 4)
    result["equity_delta"] = round(equity_delta, 4)
    result["equity_share_qty"] = round(overlay["total_share_qty"], 4)
    result["equity_by_underlying"] = {
        sym: {"share_qty": round(info["share_qty"], 4), "spot": round(info["spot"], 4) if info["spot"] else None}
        for sym, info in overlay["by_underlying"].items()
    }
    result["skipped"] = bundle["skipped"]
    result["assumptions"] = bundle["assumptions"]
    return result


def hedge_ratio_for_account(account: str = "all", target_delta: float = 0.0) -> dict:
    """Aggregate hedge recommendation including equity Δ.

    ``compute_hedge_ratio`` only sees option positions, so a covered call
    asks for shares to flatten the short-call leg even though the underlying
    shares already do that. Re-derive ``hedge_shares`` against the combined
    option + equity Δ so a covered call shows ``NONE`` (or close to it).
    """
    bundle = options_as_position_dicts(account)
    positions = bundle["positions"]
    overlay = _equity_overlay(account)
    equity_delta = overlay["equity_delta"]

    if not positions and equity_delta == 0:
        return _no_positions_response(bundle["skipped"])

    if positions:
        result = compute_hedge_ratio(positions, target_delta=target_delta)
        option_delta = result["portfolio_greeks"]["total_delta"]
        spot_for_notional = positions[0]["S"]
    else:
        # Equity-only fallback — synthesise a stub portfolio so the response
        # shape stays consistent with the options path.
        option_delta = 0.0
        first_und = next(iter(overlay["by_underlying"].values()), None)
        spot_for_notional = (first_und or {}).get("spot") or 0.0
        result = {
            "current_delta": 0.0,
            "target_delta": target_delta,
            "hedge_shares": 0,
            "hedge_direction": "NONE",
            "hedge_notional": 0,
            "portfolio_greeks": {
                "total_delta": 0.0,
                "total_gamma": 0.0,
                "total_vega": 0.0,
                "total_theta": 0.0,
                "total_rho": 0.0,
                "position_count": 0,
                "per_position": [],
            },
        }

    combined_delta = option_delta + equity_delta
    hedge_shares = round(target_delta - combined_delta)
    result["current_delta"] = round(combined_delta, 4)
    result["option_delta"] = round(option_delta, 4)
    result["equity_delta"] = round(equity_delta, 4)
    result["hedge_shares"] = hedge_shares
    result["hedge_direction"] = (
        "BUY" if hedge_shares > 0 else "SELL" if hedge_shares < 0 else "NONE"
    )
    result["hedge_notional"] = (
        round(abs(hedge_shares) * spot_for_notional, 2) if spot_for_notional else 0
    )
    # Mirror the equity-adjusted Δ inside the embedded portfolio_greeks block
    # so any UI reading it sees the corrected number.
    result["portfolio_greeks"]["total_delta"] = round(combined_delta, 4)
    result["portfolio_greeks"]["option_total_delta"] = round(option_delta, 4)
    result["portfolio_greeks"]["equity_delta"] = round(equity_delta, 4)
    result["skipped"] = bundle["skipped"]
    result["assumptions"] = bundle["assumptions"]
    return result


def hedge_ratio_by_underlying_for_account(
    account: str = "all",
    target_delta: float = 0.0,
) -> dict:
    """Per-underlying Δ-neutral share hedge.

    Aggregates Δ (and the other Greeks) per underlying across both option legs
    and equity holdings, then sizes a share trade against each underlying's
    own spot price. This replaces the single aggregate hedge — which collapses
    a multi-name book into one synthetic ticker and uses the first leg's spot
    for notional — with one row per underlying that can actually be executed.

    Equity contribution: each share = +1 Δ (longs only; we don't track shorts
    in equity holdings). Options contribute the per-leg signed Δ already
    scaled by qty × 100 from `aggregate_portfolio_greeks`.
    """
    bundle = options_as_position_dicts(account)
    skipped = bundle["skipped"]
    positions = bundle["positions"]

    by_und: Dict[str, dict] = {}

    if positions:
        portfolio = aggregate_portfolio_greeks(positions)
        for pos, leg in zip(positions, portfolio["per_position"]):
            u = pos["underlying"]
            row = by_und.setdefault(u, {
                "underlying": u,
                "spot": pos["S"],
                "option_delta": 0.0,
                "option_gamma": 0.0,
                "option_vega": 0.0,
                "option_theta": 0.0,
                "share_qty": 0.0,
                "option_legs": 0,
            })
            row["option_delta"] += leg["greeks"]["delta"]
            row["option_gamma"] += leg["greeks"]["gamma"]
            row["option_vega"] += leg["greeks"]["vega"]
            row["option_theta"] += leg["greeks"]["theta"]
            row["option_legs"] += 1

    for h in compute_live_holdings(account):
        u = h.symbol
        spot = float(h.current_price) if h.current_price else 0.0
        row = by_und.setdefault(u, {
            "underlying": u,
            "spot": spot,
            "option_delta": 0.0,
            "option_gamma": 0.0,
            "option_vega": 0.0,
            "option_theta": 0.0,
            "share_qty": 0.0,
            "option_legs": 0,
        })
        row["share_qty"] += float(h.quantity)
        if not row["spot"] and spot:
            row["spot"] = spot

    rows: list[dict] = []
    for info in by_und.values():
        spot = info["spot"]
        total_delta = info["option_delta"] + info["share_qty"]
        hedge_shares = round(target_delta - total_delta)
        notional = round(abs(hedge_shares) * spot, 2) if spot else None
        rows.append({
            "underlying": info["underlying"],
            "spot": round(spot, 4) if spot else None,
            "share_qty": round(info["share_qty"], 4),
            "option_legs": info["option_legs"],
            "option_delta": round(info["option_delta"], 4),
            "option_gamma": round(info["option_gamma"], 4),
            "option_vega": round(info["option_vega"], 4),
            "option_theta": round(info["option_theta"], 4),
            "total_delta": round(total_delta, 4),
            "hedge_shares": hedge_shares,
            "hedge_direction": (
                "BUY" if hedge_shares > 0
                else "SELL" if hedge_shares < 0
                else "NONE"
            ),
            "hedge_notional": notional,
        })

    rows.sort(key=lambda r: -abs(r["total_delta"]))

    return {
        "rows": rows,
        "totals": {
            "underlyings": len(rows),
            "total_delta": round(sum(r["total_delta"] for r in rows), 4),
            "total_gamma": round(sum(r["option_gamma"] for r in rows), 4),
            "total_hedge_notional": round(
                sum(r["hedge_notional"] or 0 for r in rows), 2
            ),
            "total_hedge_shares_abs": sum(abs(r["hedge_shares"]) for r in rows),
        },
        "target_delta": target_delta,
        "skipped": skipped,
        "assumptions": bundle["assumptions"],
    }


def delta_gamma_hedge_for_account(
    account: str = "all",
    underlying: Optional[str] = None,
    hedge_dte: int = 30,
    hedge_type: str = "call",
    top_n: int = 10,
) -> dict:
    """Solve simultaneous Δ=0 AND Γ=0 per underlying.

    Shares carry Γ=0, so a Γ-neutral hedge must use another option. For each
    underlying with non-trivial Γ, picks a synthetic ATM option (DTE=hedge_dte,
    K=spot, type=hedge_type) priced via Black-Scholes with realized HV, then
    solves the triangular system:

        n_contracts × Γ_o×100 = -Γ_book      (kill gamma with options)
        n_contracts × Δ_o×100 + n_shares = -Δ_book   (then re-flatten delta)

    Contracts are rounded to whole units; shares are computed against the
    rounded contract count so the final integer-trade result is honest about
    residual exposure (residual_delta / residual_gamma in the response).

    The hedge option is synthetic — the response includes its specs so the
    user can pick the closest live instrument from the option chain.
    """
    by_und = hedge_ratio_by_underlying_for_account(account, target_delta=0.0)
    if "error" in by_und:
        return by_und

    rows_in = by_und["rows"]
    if underlying:
        rows_in = [r for r in rows_in if r["underlying"] == underlying.upper()]
        if not rows_in:
            return {
                "error": "underlying_not_found",
                "message": f"No positions found for underlying {underlying!r}",
                "available_underlyings": [r["underlying"] for r in by_und["rows"]],
            }

    hv_cache = _build_hv_cache([r["underlying"] for r in rows_in])
    T = hedge_dte / 365.0
    expiry_iso = (date.today() + timedelta(days=hedge_dte)).isoformat()

    out_rows: list[dict] = []
    for r in rows_in:
        u = r["underlying"]
        spot = r["spot"]
        if not spot or spot <= 0:
            continue
        gamma_book = r["option_gamma"]  # shares contribute 0 gamma
        delta_book = r["total_delta"]

        if abs(gamma_book) < 1.0:
            out_rows.append({
                "underlying": u,
                "spot": spot,
                "delta_book": delta_book,
                "gamma_book": gamma_book,
                "hedge_contracts": 0,
                "hedge_contracts_action": "NONE",
                "hedge_shares": -round(delta_book),
                "hedge_shares_action": (
                    "SELL" if delta_book > 0 else "BUY" if delta_book < 0 else "NONE"
                ),
                "hedge_option": None,
                "residual_gamma": round(gamma_book, 4),
                "residual_delta": round(delta_book - round(delta_book), 4),
                "note": "Gamma negligible — share-only hedge sufficient",
            })
            continue

        sigma = hv_cache.get(u, _VOL_FALLBACK)
        g = calculate_greeks(
            S=spot, K=spot, T=T,
            r=_RISK_FREE_RATE, sigma=sigma,
            option_type=hedge_type,
        )
        delta_per_contract = g["delta"] * 100
        gamma_per_contract = g["gamma"] * 100

        if abs(gamma_per_contract) < 1e-9:
            continue

        n_contracts = round(-gamma_book / gamma_per_contract)
        delta_after_options = delta_book + n_contracts * delta_per_contract
        n_shares = -round(delta_after_options)
        residual_gamma = gamma_book + n_contracts * gamma_per_contract
        residual_delta = delta_after_options + n_shares

        out_rows.append({
            "underlying": u,
            "spot": round(spot, 4),
            "delta_book": round(delta_book, 4),
            "gamma_book": round(gamma_book, 4),
            "hedge_option": {
                "type": hedge_type,
                "strike": round(spot, 2),
                "dte_days": hedge_dte,
                "expiry_approx": expiry_iso,
                "iv_used": round(sigma, 4),
                "delta_per_contract": round(delta_per_contract, 4),
                "gamma_per_contract": round(gamma_per_contract, 4),
            },
            "hedge_contracts": n_contracts,
            "hedge_contracts_action": (
                "BUY" if n_contracts > 0
                else "SELL" if n_contracts < 0
                else "NONE"
            ),
            "hedge_shares": n_shares,
            "hedge_shares_action": (
                "BUY" if n_shares > 0
                else "SELL" if n_shares < 0
                else "NONE"
            ),
            "residual_gamma": round(residual_gamma, 4),
            "residual_delta": round(residual_delta, 4),
        })

    out_rows.sort(key=lambda r: -abs(r["gamma_book"]))
    if not underlying:
        out_rows = out_rows[:top_n]

    return {
        "rows": out_rows,
        "method": "synthetic_atm_option",
        "params": {
            "hedge_dte": hedge_dte,
            "hedge_option_type": hedge_type,
            "atm_strike": "spot",
            "iv_source": "realized_hv_yfinance",
            "risk_free_rate": _RISK_FREE_RATE,
        },
        "note": (
            "Hedge option is synthetic (Black-Scholes). Pick the closest live "
            "option from the chain to execute; contract multiplier = 100. "
            "Selling options will collect premium and gain theta, but increase "
            "your short-vega exposure."
        ),
    }


def rebalance_check_for_account(
    account: str = "all",
    delta_limit: float = 1000.0,
    gamma_limit: float = 100.0,
    vega_limit: float = 1000.0,
) -> dict:
    """Rebalance breach check against the option + equity combined Δ.

    ``check_rebalance_triggers`` only sees options, so a covered call's short
    call would breach the Δ limit even though the underlying shares neutralise
    it. We re-evaluate the Δ breach using the equity-adjusted total. Γ and V
    are unaffected (shares are linear in S and have no vol exposure) so we
    keep the original breach decisions for those.

    Defaults sized for a multi-ticker portfolio (~$50k+ NAV, dozens of legs).
    Tighter values like 100/50/500 fired constantly and were originally meant
    for single-name option books.
    """
    bundle = options_as_position_dicts(account)
    positions = bundle["positions"]
    overlay = _equity_overlay(account)
    equity_delta = overlay["equity_delta"]

    if not positions and equity_delta == 0:
        return _no_positions_response(bundle["skipped"])

    if positions:
        result = check_rebalance_triggers(
            positions,
            delta_limit=delta_limit,
            gamma_limit=gamma_limit,
            vega_limit=vega_limit,
        )
        option_delta = result["portfolio_greeks"]["total_delta"]
    else:
        result = {
            "needs_rebalance": False,
            "breaches": [],
            "breach_count": 0,
            "max_severity": "NONE",
            "hedge_recommendation": None,
            "portfolio_greeks": {
                "total_delta": 0.0,
                "total_gamma": 0.0,
                "total_vega": 0.0,
                "total_theta": 0.0,
                "total_rho": 0.0,
                "position_count": 0,
                "per_position": [],
            },
        }
        option_delta = 0.0

    combined_delta = option_delta + equity_delta

    # Drop the options-only Δ breach (if any), then re-evaluate against the
    # combined Δ. Γ/V breaches keep their original verdict.
    breaches = [b for b in result.get("breaches", []) if b["greek"] != "delta"]
    if abs(combined_delta) > delta_limit:
        breaches.append({
            "greek": "delta",
            "current": round(combined_delta, 4),
            "limit": delta_limit,
            "severity": "HIGH" if abs(combined_delta) > delta_limit * 1.5 else "MEDIUM",
        })

    result["breaches"] = breaches
    result["breach_count"] = len(breaches)
    result["needs_rebalance"] = len(breaches) > 0
    result["max_severity"] = max((b["severity"] for b in breaches), default="NONE")
    # Patch Δ on the embedded greeks too.
    result["portfolio_greeks"]["total_delta"] = round(combined_delta, 4)
    result["portfolio_greeks"]["option_total_delta"] = round(option_delta, 4)
    result["portfolio_greeks"]["equity_delta"] = round(equity_delta, 4)
    if result.get("hedge_recommendation"):
        # If the embedded hedge_recommendation was computed from option-only Δ,
        # null it — let the user fetch /api/robinhood/analytics/hedge-ratio for
        # the equity-adjusted recommendation.
        result["hedge_recommendation"] = None
    result["skipped"] = bundle["skipped"]
    result["assumptions"] = bundle["assumptions"]
    return result


def stress_test_for_account(
    account: str = "all",
    spot_shock_pct: float = 0.0,
    vol_shock_pct: float = 0.0,
) -> dict:
    """Portfolio stress test including stock P&L under the spot shock.

    Long shares contribute ``N × spot × spot_shock_pct`` of P&L per
    underlying — the same hedge that offsets a covered call's option leg
    under a rally also needs to be reflected in the aggregate P&L number.
    """
    bundle = options_as_position_dicts(account)
    positions = bundle["positions"]
    overlay = _equity_overlay(account)

    if not positions and overlay["total_share_qty"] == 0:
        return _no_positions_response(bundle["skipped"])

    if positions:
        result = stress_test_portfolio(
            positions=positions,
            spot_shock_pct=spot_shock_pct,
            vol_shock_pct=vol_shock_pct,
        )
        # `stress_test_portfolio` may return a dataclass-like object or a dict;
        # normalise to dict.
        if hasattr(result, "__dict__") and not isinstance(result, dict):
            result = dict(result.__dict__)
        if not isinstance(result, dict):
            result = {"total_pnl": 0.0}
    else:
        result = {"total_pnl": 0.0, "total_attribution": {}}

    # Stock P&L: long shares are linear in spot, no vol exposure.
    equity_pnl = 0.0
    equity_pnl_by_underlying: Dict[str, float] = {}
    for sym, info in overlay["by_underlying"].items():
        spot = info["spot"]
        if not spot:
            continue
        leg_pnl = float(info["share_qty"]) * float(spot) * float(spot_shock_pct)
        equity_pnl_by_underlying[sym] = round(leg_pnl, 4)
        equity_pnl += leg_pnl

    options_pnl = float(result.get("total_pnl") or 0.0)
    total_pnl = options_pnl + equity_pnl

    if isinstance(result, dict):
        result["total_pnl"] = round(total_pnl, 4)
        result["options_pnl"] = round(options_pnl, 4)
        result["equity_pnl"] = round(equity_pnl, 4)
        result["equity_pnl_by_underlying"] = equity_pnl_by_underlying
        result["equity_share_qty"] = round(overlay["total_share_qty"], 4)
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
