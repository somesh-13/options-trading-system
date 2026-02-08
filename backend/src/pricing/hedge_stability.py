"""
Hedge Stability Forecasting

Forecasts how delta changes over time (Charm) and under vol shocks (Vanna).
Used to recommend rehedging frequency and quantify hedge risk.
"""

import numpy as np
from typing import Dict, List

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))

from pricing.greeks import calculate_greeks


def forecast_delta_decay(
    S: float, K: float, T: float, r: float, sigma: float,
    option_type: str = 'call', days: int = 30
) -> Dict:
    """
    Forecast delta over the next N days as time decays.

    Returns:
        {days: [], deltas: [], gammas: [], thetas: [], initial_delta: float}
    """
    days_list = []
    deltas = []
    gammas = []
    thetas = []

    for d in range(days + 1):
        t_remaining = T - d / 365.0
        if t_remaining <= 0:
            break

        greeks = calculate_greeks(S, K, t_remaining, r, sigma, option_type)
        days_list.append(d)
        deltas.append(greeks['delta'])
        gammas.append(greeks['gamma'])
        thetas.append(greeks['theta'])

    return {
        'days': days_list,
        'deltas': deltas,
        'gammas': gammas,
        'thetas': thetas,
        'initial_delta': deltas[0] if deltas else 0
    }


def forecast_vol_shock(
    S: float, K: float, T: float, r: float, sigma: float,
    option_type: str = 'call',
    shocks: List[float] = None
) -> Dict:
    """
    Forecast delta under various volatility shocks.

    Args:
        shocks: List of vol shock percentages (e.g., [-0.10, -0.05, 0, 0.05, 0.10])

    Returns:
        {shocks: [], deltas: [], gammas: [], vegas: [], current_delta: float}
    """
    if shocks is None:
        shocks = [-0.20, -0.15, -0.10, -0.05, 0, 0.05, 0.10, 0.15, 0.20]

    shock_labels = []
    deltas = []
    gammas = []
    vegas = []

    for shock in shocks:
        shocked_sigma = max(sigma + shock, 0.01)
        greeks = calculate_greeks(S, K, T, r, shocked_sigma, option_type)
        shock_labels.append(shock)
        deltas.append(greeks['delta'])
        gammas.append(greeks['gamma'])
        vegas.append(greeks['vega'])

    base_greeks = calculate_greeks(S, K, T, r, sigma, option_type)

    return {
        'shocks': shock_labels,
        'deltas': deltas,
        'gammas': gammas,
        'vegas': vegas,
        'current_delta': base_greeks['delta'],
        'current_sigma': sigma
    }


def rehedge_recommendation(
    S: float, K: float, T: float, r: float, sigma: float,
    option_type: str = 'call'
) -> Dict:
    """
    Generate rehedging frequency recommendation based on Charm and Gamma.
    """
    greeks = calculate_greeks(S, K, T, r, sigma, option_type)

    gamma = greeks['gamma']
    daily_delta_change = abs(greeks['theta'])  # proxy for daily movement

    # High gamma = need frequent rehedging
    if abs(gamma) > 0.05:
        frequency = "Multiple times daily"
        urgency = "high"
    elif abs(gamma) > 0.02:
        frequency = "Daily"
        urgency = "medium"
    else:
        frequency = "Weekly"
        urgency = "low"

    return {
        'frequency': frequency,
        'urgency': urgency,
        'gamma': gamma,
        'estimated_daily_delta_change': daily_delta_change,
        'days_to_expiry': round(T * 365)
    }
