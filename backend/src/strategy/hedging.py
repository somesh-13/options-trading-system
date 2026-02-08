"""Dynamic Hedging Engine - Delta-Gamma neutrality management.

Implements automated hedging with:
- Delta hedging (shares to buy/sell to neutralize)
- Gamma-aware rebalancing triggers
- Portfolio-level Greeks aggregation
- Rebalancing schedule optimization
"""

import numpy as np
from typing import Optional

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))

from pricing.black_scholes import black_scholes
from pricing.greeks import calculate_greeks


def compute_hedge_ratio(
    positions: list[dict],
    target_delta: float = 0.0,
) -> dict:
    """Compute shares needed to hedge portfolio to target delta.

    Args:
        positions: List of position dicts, each with:
            S, K, T, r, sigma, option_type, qty (negative = short)
        target_delta: Target portfolio delta (default 0 = market-neutral)

    Returns:
        Hedge recommendation with shares to trade.
    """
    portfolio_greeks = aggregate_portfolio_greeks(positions)
    current_delta = portfolio_greeks["total_delta"]

    hedge_shares = round(target_delta - current_delta)

    return {
        "current_delta": round(current_delta, 4),
        "target_delta": target_delta,
        "hedge_shares": hedge_shares,
        "hedge_direction": "BUY" if hedge_shares > 0 else "SELL" if hedge_shares < 0 else "NONE",
        "hedge_notional": round(abs(hedge_shares) * positions[0]["S"], 2) if positions else 0,
        "portfolio_greeks": portfolio_greeks,
    }


def aggregate_portfolio_greeks(positions: list[dict]) -> dict:
    """Aggregate Greeks across all positions in a portfolio.

    Each position's Greeks are scaled by qty * 100 (options multiplier).
    """
    total = {
        "total_delta": 0.0,
        "total_gamma": 0.0,
        "total_vega": 0.0,
        "total_theta": 0.0,
        "total_rho": 0.0,
    }

    per_position = []

    for pos in positions:
        greeks = calculate_greeks(
            S=pos["S"], K=pos["K"], T=pos["T"],
            r=pos["r"], sigma=pos["sigma"],
            option_type=pos["option_type"],
        )
        price = black_scholes(
            S=pos["S"], K=pos["K"], T=pos["T"],
            r=pos["r"], sigma=pos["sigma"],
            option_type=pos["option_type"],
        )

        qty = pos.get("qty", 1)
        multiplier = qty * 100

        scaled = {k: round(v * multiplier, 4) for k, v in greeks.items()}
        total["total_delta"] += scaled["delta"]
        total["total_gamma"] += scaled["gamma"]
        total["total_vega"] += scaled["vega"]
        total["total_theta"] += scaled["theta"]
        total["total_rho"] += scaled["rho"]

        per_position.append({
            "strike": pos["K"],
            "type": pos["option_type"],
            "qty": qty,
            "price": round(float(price), 4),
            "greeks": scaled,
        })

    total = {k: round(v, 4) for k, v in total.items()}
    total["position_count"] = len(positions)
    total["per_position"] = per_position

    return total


def check_rebalance_triggers(
    positions: list[dict],
    delta_limit: float = 100.0,
    gamma_limit: float = 50.0,
    vega_limit: float = 500.0,
) -> dict:
    """Check if portfolio Greeks exceed rebalancing thresholds.

    Args:
        positions: Current positions
        delta_limit: Max absolute portfolio delta before rebalance
        gamma_limit: Max absolute gamma
        vega_limit: Max absolute vega

    Returns:
        Dict with breach status and recommendations
    """
    greeks = aggregate_portfolio_greeks(positions)
    breaches = []

    if abs(greeks["total_delta"]) > delta_limit:
        breaches.append({
            "greek": "delta",
            "current": greeks["total_delta"],
            "limit": delta_limit,
            "severity": "HIGH" if abs(greeks["total_delta"]) > delta_limit * 1.5 else "MEDIUM",
        })

    if abs(greeks["total_gamma"]) > gamma_limit:
        breaches.append({
            "greek": "gamma",
            "current": greeks["total_gamma"],
            "limit": gamma_limit,
            "severity": "HIGH" if abs(greeks["total_gamma"]) > gamma_limit * 1.5 else "MEDIUM",
        })

    if abs(greeks["total_vega"]) > vega_limit:
        breaches.append({
            "greek": "vega",
            "current": greeks["total_vega"],
            "limit": vega_limit,
            "severity": "HIGH" if abs(greeks["total_vega"]) > vega_limit * 1.5 else "MEDIUM",
        })

    needs_rebalance = len(breaches) > 0
    hedge = compute_hedge_ratio(positions) if needs_rebalance else None

    return {
        "needs_rebalance": needs_rebalance,
        "breaches": breaches,
        "breach_count": len(breaches),
        "max_severity": max((b["severity"] for b in breaches), default="NONE"),
        "hedge_recommendation": hedge,
        "portfolio_greeks": greeks,
    }


def optimal_rebalance_schedule(
    positions: list[dict],
    forecast_days: int = 5,
) -> list[dict]:
    """Forecast when rebalancing will be needed over the next N days.

    Simulates time decay and estimates when delta drift will exceed thresholds.
    """
    schedule = []

    for day in range(1, forecast_days + 1):
        # Adjust T for time decay
        adjusted_positions = []
        for pos in positions:
            new_pos = pos.copy()
            new_pos["T"] = max(0.001, pos["T"] - day / 365.0)
            adjusted_positions.append(new_pos)

        triggers = check_rebalance_triggers(adjusted_positions)
        greeks = triggers["portfolio_greeks"]

        schedule.append({
            "day": day,
            "delta": greeks["total_delta"],
            "gamma": greeks["total_gamma"],
            "theta": greeks["total_theta"],
            "needs_rebalance": triggers["needs_rebalance"],
            "breaches": len(triggers["breaches"]),
        })

    return schedule
