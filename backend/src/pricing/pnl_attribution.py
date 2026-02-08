"""
Greeks P&L Attribution

Decomposes option P&L into contributions from each Greek.
Used for risk reporting and understanding P&L drivers.
"""

import numpy as np
from typing import Dict, List

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))

from pricing.black_scholes import black_scholes
from pricing.greeks import calculate_greeks
from pricing.second_order_greeks import calculate_all_second_order_greeks


def greeks_pnl_attribution(
    greeks_dict: Dict[str, float],
    delta_S: float,
    delta_sigma: float,
    delta_t: float
) -> Dict[str, float]:
    """
    Attribute P&L to individual Greeks.

    P&L = Delta*dS + 0.5*Gamma*dS^2 + Vega*d_sigma + Theta*dt
         + Vanna*dS*d_sigma + Charm*dt (second order)

    Args:
        greeks_dict: Dict with delta, gamma, vega, theta, vanna, charm keys
        delta_S: Change in spot price ($)
        delta_sigma: Change in volatility (absolute, e.g. 0.05 for 5%)
        delta_t: Change in time (days)

    Returns:
        Dict with each Greek's P&L contribution
    """
    delta = greeks_dict.get('delta', 0)
    gamma = greeks_dict.get('gamma', 0)
    vega = greeks_dict.get('vega', 0)  # per 1% vol
    theta = greeks_dict.get('theta', 0)  # per day
    vanna = greeks_dict.get('vanna', 0)  # per 1% vol
    charm = greeks_dict.get('charm', 0)  # per day

    pnl_delta = delta * delta_S
    pnl_gamma = 0.5 * gamma * delta_S ** 2
    pnl_vega = vega * (delta_sigma * 100)  # convert to 1% units
    pnl_theta = theta * delta_t
    pnl_vanna = vanna * delta_S * (delta_sigma * 100)
    pnl_charm = charm * delta_t

    total = pnl_delta + pnl_gamma + pnl_vega + pnl_theta + pnl_vanna + pnl_charm

    return {
        'delta_pnl': round(pnl_delta, 4),
        'gamma_pnl': round(pnl_gamma, 4),
        'vega_pnl': round(pnl_vega, 4),
        'theta_pnl': round(pnl_theta, 4),
        'vanna_pnl': round(pnl_vanna, 4),
        'charm_pnl': round(pnl_charm, 4),
        'total_pnl': round(total, 4)
    }


def stress_test_position(
    S: float, K: float, T: float, r: float, sigma: float,
    option_type: str = 'call', qty: int = 1,
    spot_shock_pct: float = 0.0, vol_shock_pct: float = 0.0
) -> Dict:
    """
    Stress test a single option position.

    Args:
        spot_shock_pct: Spot price shock as percentage (e.g., -0.20 for -20%)
        vol_shock_pct: Vol shock as percentage (e.g., 0.50 for +50% relative)

    Returns:
        Dict with current and stressed values, P&L breakdown
    """
    # Current values
    current_price = black_scholes(S, K, T, r, sigma, option_type)
    current_greeks = calculate_greeks(S, K, T, r, sigma, option_type)
    current_second = calculate_all_second_order_greeks(S, K, T, r, sigma, option_type)

    # Stressed values
    stressed_S = S * (1 + spot_shock_pct)
    stressed_sigma = max(sigma * (1 + vol_shock_pct), 0.01)

    stressed_price = black_scholes(stressed_S, K, T, r, stressed_sigma, option_type)
    stressed_greeks = calculate_greeks(stressed_S, K, T, r, stressed_sigma, option_type)
    stressed_second = calculate_all_second_order_greeks(stressed_S, K, T, r, stressed_sigma, option_type)

    # P&L
    position_pnl = (float(stressed_price) - float(current_price)) * qty * 100  # options are 100 shares

    # Attribution
    all_greeks = {**current_greeks, **current_second}
    delta_S = stressed_S - S
    delta_sigma = stressed_sigma - sigma

    attribution = greeks_pnl_attribution(all_greeks, delta_S, delta_sigma, 0)
    # Scale by qty * 100
    for key in attribution:
        attribution[key] = round(attribution[key] * qty * 100, 2)

    return {
        'current': {
            'price': float(current_price),
            'greeks': {**current_greeks, **current_second}
        },
        'stressed': {
            'price': float(stressed_price),
            'greeks': {**stressed_greeks, **stressed_second},
            'spot': stressed_S,
            'sigma': stressed_sigma
        },
        'pnl': position_pnl,
        'attribution': attribution,
        'qty': qty,
        'spot_shock_pct': spot_shock_pct,
        'vol_shock_pct': vol_shock_pct
    }


def stress_test_portfolio(
    positions: List[Dict],
    spot_shock_pct: float = 0.0,
    vol_shock_pct: float = 0.0
) -> Dict:
    """
    Stress test a portfolio of option positions.

    Args:
        positions: List of dicts with S, K, T, r, sigma, option_type, qty
        spot_shock_pct: Spot shock percentage
        vol_shock_pct: Vol shock percentage

    Returns:
        Aggregated stress test results
    """
    results = []
    total_pnl = 0.0
    total_attribution = {}

    for pos in positions:
        result = stress_test_position(
            S=pos['S'], K=pos['K'], T=pos['T'],
            r=pos.get('r', 0.05), sigma=pos['sigma'],
            option_type=pos.get('option_type', 'call'),
            qty=pos.get('qty', 1),
            spot_shock_pct=spot_shock_pct,
            vol_shock_pct=vol_shock_pct
        )
        results.append(result)
        total_pnl += result['pnl']

        for key, val in result['attribution'].items():
            total_attribution[key] = total_attribution.get(key, 0) + val

    return {
        'positions': results,
        'total_pnl': round(total_pnl, 2),
        'total_attribution': {k: round(v, 2) for k, v in total_attribution.items()},
        'spot_shock_pct': spot_shock_pct,
        'vol_shock_pct': vol_shock_pct
    }
