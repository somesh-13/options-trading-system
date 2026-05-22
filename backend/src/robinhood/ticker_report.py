"""Per-ticker positions report.

Aggregates equity + option legs for a single ticker across all accounts and
attaches per-leg Greeks (computed via the same pipeline used by the
portfolio-greeks endpoint). Used by:
  - GET  /api/robinhood/analytics/ticker-report/{ticker}
  - POST /api/robinhood/analytics/ticker-chat (as Gemini context)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, List, Optional

from . import portfolio as rh_portfolio
from .portfolio import EquityHolding, OptionHolding, _cached_price

from data.cifr_data import get_historical_volatility  # type: ignore
from pricing.greeks import calculate_greeks  # type: ignore


_RISK_FREE_RATE = 0.045
_HV_WINDOW_DAYS = 30
_VOL_FALLBACK = 0.50


def _years_to_expiry(expiry_iso: str) -> Optional[float]:
    try:
        from datetime import date
        exp = date.fromisoformat(expiry_iso)
        days = (exp - date.today()).days
    except (TypeError, ValueError):
        return None
    if days <= 0:
        return None
    return days / 365.0


def _hv(ticker: str) -> float:
    try:
        return float(get_historical_volatility(ticker, window=_HV_WINDOW_DAYS))
    except Exception:
        return _VOL_FALLBACK


def _option_greeks(leg: OptionHolding, spot: Optional[float], sigma: float) -> Optional[Dict[str, float]]:
    T = _years_to_expiry(leg.expiry)
    if T is None or spot is None or spot <= 0:
        return None
    try:
        g = calculate_greeks(
            S=float(spot),
            K=float(leg.strike),
            T=float(T),
            r=_RISK_FREE_RATE,
            sigma=float(sigma),
            option_type=leg.side.lower(),
        )
    except Exception:
        return None
    sign = -1.0 if leg.position == "short" else 1.0
    qty = float(leg.quantity)
    # Option Greeks are per contract (100 shares of underlying). Scale by qty
    # and 100 so they are directly comparable to share Δ (each share = +1 Δ).
    return {
        "delta": round(sign * qty * 100.0 * float(g.get("delta", 0.0)), 4),
        "gamma": round(sign * qty * 100.0 * float(g.get("gamma", 0.0)), 4),
        "vega":  round(sign * qty * 100.0 * float(g.get("vega", 0.0)), 4),
        "theta": round(sign * qty * 100.0 * float(g.get("theta", 0.0)), 4),
        "rho":   round(sign * qty * 100.0 * float(g.get("rho", 0.0)), 4),
    }


def _activity_for_ticker(ticker: str, account: Optional[str], limit: int = 200) -> List[dict]:
    """Recent activity rows touching the ticker (instrument or description match)."""
    rows = rh_portfolio.recent_activity(limit=limit, account=account)
    upper = ticker.upper()
    out: List[dict] = []
    for r in rows:
        instr = (r.instrument or "").upper()
        desc = (r.description or "").upper()
        if instr == upper or upper in desc.split():
            out.append({
                "activity_date": r.activity_date,
                "process_date": r.process_date,
                "instrument": r.instrument,
                "description": r.description,
                "trans_code": r.trans_code,
                "quantity": r.quantity,
                "price": r.price,
                "amount": r.amount,
            })
    return out


def build_ticker_report(ticker: str, account: Optional[str] = None) -> dict:
    """Top-level report builder. Always returns a usable dict."""
    upper = ticker.upper()
    account = account or "all"

    equities = [e for e in rh_portfolio.compute_live_holdings(account) if e.symbol == upper]
    options = [o for o in rh_portfolio.compute_live_options(account) if o.underlying == upper]

    accounts_seen = sorted({e.account for e in equities} | {o.account for o in options})

    # Equity aggregate (across accounts)
    eq_qty = sum(float(e.quantity or 0.0) for e in equities)
    eq_cost_basis = sum(float(e.cost_basis or 0.0) for e in equities)
    eq_avg_cost = (eq_cost_basis / eq_qty) if eq_qty > 1e-9 else 0.0
    eq_market_value = sum(float(e.market_value or 0.0) for e in equities)
    eq_unrealized = sum(float(e.unrealized_pnl or 0.0) for e in equities)
    eq_mark = None
    for e in equities:
        if e.current_price:
            eq_mark = float(e.current_price)
            break

    # Spot for option Greeks
    spot = _cached_price(upper)
    sigma = _hv(upper)

    # Per-leg payload + Greeks
    options_payload: List[dict] = []
    agg_delta = agg_gamma = agg_vega = agg_theta = agg_rho = 0.0
    for o in options:
        greeks = _option_greeks(o, spot, sigma)
        options_payload.append({
            "underlying": o.underlying,
            "side": o.side,
            "strike": o.strike,
            "expiry": o.expiry,
            "position": o.position,
            "quantity": o.quantity,
            "avg_cost": o.avg_cost,
            "cost_basis": o.cost_basis,
            "market_value": o.market_value,
            "unrealized_pnl": o.unrealized_pnl,
            "realized_pnl": o.realized_pnl,
            "account": o.account,
            "greeks": greeks,
        })
        if greeks:
            agg_delta += greeks["delta"]
            agg_gamma += greeks["gamma"]
            agg_vega  += greeks["vega"]
            agg_theta += greeks["theta"]
            agg_rho   += greeks["rho"]

    # Equity Δ contribution: each share = +1 Δ
    agg_delta += eq_qty

    activity = _activity_for_ticker(upper, account, limit=200)

    return {
        "ticker": upper,
        "as_of": datetime.now(timezone.utc).isoformat(),
        "account_filter": account,
        "accounts_seen": accounts_seen,
        "spot": round(spot, 4) if spot else None,
        "iv_assumption": {"hv_window_days": _HV_WINDOW_DAYS, "sigma": round(sigma, 4), "risk_free_rate": _RISK_FREE_RATE},
        "equity": {
            "quantity": round(eq_qty, 4),
            "avg_cost": round(eq_avg_cost, 4),
            "cost_basis": round(eq_cost_basis, 2),
            "mark": eq_mark,
            "market_value": round(eq_market_value, 2),
            "unrealized_pnl": round(eq_unrealized, 2),
            "by_account": [
                {
                    "account": e.account,
                    "quantity": e.quantity,
                    "avg_cost": e.avg_cost,
                    "cost_basis": e.cost_basis,
                    "mark": e.current_price,
                    "market_value": e.market_value,
                    "unrealized_pnl": e.unrealized_pnl,
                }
                for e in equities
            ],
        },
        "options": options_payload,
        "aggregate_greeks": {
            "delta": round(agg_delta, 4),
            "gamma": round(agg_gamma, 4),
            "vega": round(agg_vega, 4),
            "theta": round(agg_theta, 4),
            "rho": round(agg_rho, 4),
        },
        "activity": activity,
    }


def _fmt_money(v) -> str:
    if v is None:
        return "—"
    try:
        return f"${float(v):,.2f}"
    except (TypeError, ValueError):
        return str(v)


def report_to_markdown(report: dict) -> str:
    """Compact markdown rendering of the report — used as Gemini context."""
    lines: List[str] = []
    t = report["ticker"]
    spot = report.get("spot")
    lines.append(f"# {t} positions report")
    lines.append(f"As of: {report['as_of']}  ·  Spot: {_fmt_money(spot)}  ·  σ assumption: {report['iv_assumption']['sigma']}")
    lines.append("")

    eq = report["equity"]
    lines.append("## Equity")
    if eq["quantity"]:
        lines.append(
            f"- {eq['quantity']} sh  ·  avg ${eq['avg_cost']}  ·  mark {_fmt_money(eq['mark'])}  "
            f"·  cost basis {_fmt_money(eq['cost_basis'])}  ·  MV {_fmt_money(eq['market_value'])}  "
            f"·  unrealized {_fmt_money(eq['unrealized_pnl'])}"
        )
        for row in eq["by_account"]:
            lines.append(
                f"  - {row['account']}: {row['quantity']} sh @ {row['avg_cost']}  ·  MV {_fmt_money(row['market_value'])}"
            )
    else:
        lines.append("- (no equity position)")
    lines.append("")

    lines.append("## Options")
    if report["options"]:
        lines.append("| side | strike | expiry | qty | pos | avg | MV | unrealized | account | Δ | Γ | V | Θ |")
        lines.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for o in report["options"]:
            g = o.get("greeks") or {}
            lines.append(
                f"| {o['side']} | {o['strike']} | {o['expiry']} | {o['quantity']} | {o['position']} | "
                f"{o['avg_cost']} | {_fmt_money(o['market_value'])} | {_fmt_money(o['unrealized_pnl'])} | "
                f"{o['account']} | {g.get('delta', '—')} | {g.get('gamma', '—')} | {g.get('vega', '—')} | {g.get('theta', '—')} |"
            )
    else:
        lines.append("- (no option legs)")
    lines.append("")

    g = report["aggregate_greeks"]
    lines.append(
        f"## Aggregate Greeks (TTD-equivalent shares basis)\n"
        f"- Δ {g['delta']}  ·  Γ {g['gamma']}  ·  V {g['vega']}  ·  Θ {g['theta']}  ·  ρ {g['rho']}"
    )
    lines.append("")

    if report["activity"]:
        lines.append("## Recent activity (most recent first)")
        for r in report["activity"][:25]:
            lines.append(
                f"- {r['activity_date']}  {r['trans_code']}  qty={r['quantity']}  "
                f"price={r['price']}  amount={r['amount']}  ·  {r['description'] or r['instrument']}"
            )
    return "\n".join(lines)
