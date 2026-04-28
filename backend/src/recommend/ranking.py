"""Strike ranker — picks the "juiciest premium" candidates per strategy.

Ranks contracts by annualized return (premium / capital scaled to a year),
filtered to a delta band around the strategy's target. Reuses the textbook
risk-metric math already in vegaedge.trade_rec.
"""

from __future__ import annotations

import math
from datetime import date, datetime
from typing import Iterable, List, Optional

from vegaedge.trade_rec import StrategySpec, compute_risk_metrics

from recommend.models import RankedCandidate


def rank_candidates(
    contracts: Iterable[dict],
    spec: StrategySpec,
    spot: float,
    *,
    delta_band: float = 0.10,
    top_n: int = 3,
    today: Optional[date] = None,
) -> List[RankedCandidate]:
    """Within the strategy's DTE window, filter by |delta - target| <= band,
    compute risk metrics, sort by annualized_return desc, return top_n.

    `delta_band=0.10` means a -0.30 CSP target accepts -0.20..-0.40, which is
    wide enough to surface a true "juiciest" without drifting into deep ITM.
    """
    today = today or datetime.utcnow().date()
    ranked: List[RankedCandidate] = []

    for c in contracts:
        if c["option_type"] != spec.option_type:
            continue
        dte = (c["expiry"] - today).days
        if dte < spec.dte_min or dte > spec.dte_max:
            continue
        if abs(c["delta"] - spec.delta_target) > delta_band:
            continue
        if c["mid"] <= 0:
            # No live quote — skip rather than emit a phantom candidate
            continue

        metrics = compute_risk_metrics(spec.strategy, c, spot, today=today)

        ranked.append(
            RankedCandidate(
                occ_symbol=c["symbol"],
                expiry=c["expiry"],
                dte=metrics["dte"],
                strike=float(c["strike"]),
                bid=float(c["bid"]),
                ask=float(c["ask"]),
                mid=float(c["mid"]),
                delta=float(c["delta"]),
                theta=float(c["theta"]),
                iv=float(c["iv"]),
                max_profit=_finite_or_sentinel(metrics["max_profit"]),
                max_loss=_finite_or_sentinel(metrics["max_loss"]),
                breakeven=float(metrics["breakeven"]),
                pop=float(metrics["pop"]),
                annualized_return=float(metrics["annualized_return"]),
                capital=float(metrics["capital"]),
                rank_reason=(
                    f"{metrics['annualized_return'] * 100:.1f}% annualized "
                    f"at {c['delta']:.2f} delta, {metrics['dte']} DTE, "
                    f"${c['mid']:.2f} mid"
                ),
            )
        )

    ranked.sort(key=lambda r: r.annualized_return, reverse=True)
    return ranked[:top_n]


def _finite_or_sentinel(v: float) -> float:
    return float(v) if math.isfinite(v) else -1.0


def rank_covered_call_with_fallback(
    contracts: Iterable[dict],
    spec: StrategySpec,
    spot: float,
    *,
    today: Optional[date] = None,
) -> tuple[List[RankedCandidate], Optional[str]]:
    """Tiered picker for SELL_COVERED_CALL — guarantees a strike when the
    regime fires, even if the strict DTE/delta window is empty.

    Tier 1: strict (current rank_candidates: 21-35 DTE, |Δ-0.30| ≤ 0.10).
    Tier 2: widen DTE to 14-50, same delta band.
    Tier 3: nearest-delta among OTM calls (strike ≥ spot, mid > 0, 7-60 DTE).

    Returns (candidates, fallback_reason). fallback_reason is None when Tier 1
    fired; otherwise a short string explaining which tier produced the result.
    """
    today = today or datetime.utcnow().date()
    contract_list = list(contracts)

    ranked = rank_candidates(contract_list, spec, spot, today=today)
    if ranked:
        return ranked, None

    widened = StrategySpec(
        strategy=spec.strategy,
        option_type=spec.option_type,
        delta_target=spec.delta_target,
        dte_min=14,
        dte_max=50,
    )
    ranked = rank_candidates(contract_list, widened, spot, today=today)
    if ranked:
        return ranked, "DTE widened to 14-50; strict 21-35 was empty"

    pool: List[tuple] = []
    for c in contract_list:
        if c["option_type"] != spec.option_type:
            continue
        if c["mid"] <= 0:
            continue
        if float(c["strike"]) < spot:
            # Cover call writer should not get called away below cost basis
            continue
        dte = (c["expiry"] - today).days
        if dte < 7 or dte > 60:
            continue
        pool.append((c, dte))

    if not pool:
        return [], "no OTM calls with live mid in 7-60 DTE"

    best_c, best_dte = min(pool, key=lambda x: abs(x[0]["delta"] - spec.delta_target))
    metrics = compute_risk_metrics(spec.strategy, best_c, spot, today=today)
    cand = RankedCandidate(
        occ_symbol=best_c["symbol"],
        expiry=best_c["expiry"],
        dte=metrics["dte"],
        strike=float(best_c["strike"]),
        bid=float(best_c["bid"]),
        ask=float(best_c["ask"]),
        mid=float(best_c["mid"]),
        delta=float(best_c["delta"]),
        theta=float(best_c["theta"]),
        iv=float(best_c["iv"]),
        max_profit=_finite_or_sentinel(metrics["max_profit"]),
        max_loss=_finite_or_sentinel(metrics["max_loss"]),
        breakeven=float(metrics["breakeven"]),
        pop=float(metrics["pop"]),
        annualized_return=float(metrics["annualized_return"]),
        capital=float(metrics["capital"]),
        rank_reason=(
            f"{metrics['annualized_return'] * 100:.1f}% annualized "
            f"at {best_c['delta']:.2f} delta, {metrics['dte']} DTE, "
            f"${best_c['mid']:.2f} mid"
        ),
    )
    return [cand], f"nearest-delta fallback: Δ={best_c['delta']:.2f}, {best_dte} DTE"
