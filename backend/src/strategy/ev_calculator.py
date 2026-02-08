"""Expected Value Calculator - EV analysis for every potential trade.

Implements: EV = P(expire worthless) x Premium - P(assigned) x (Assignment Cost + Opp Cost)
Only execute trades where EV exceeds a minimum threshold.
"""

import numpy as np
from scipy.stats import norm

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))

from pricing.black_scholes import black_scholes
from pricing.greeks import calculate_greeks


def calculate_trade_ev(
    S: float,
    K: float,
    T: float,
    r: float,
    sigma: float,
    option_type: str = "call",
    premium: float = None,
    contracts: int = 1,
    direction: str = "sell",
    transaction_cost_per_contract: float = 1.30,
) -> dict:
    """Calculate Expected Value for a potential options trade.

    Args:
        S: Spot price
        K: Strike price
        T: Time to expiry (years)
        r: Risk-free rate
        sigma: Implied volatility
        option_type: 'call' or 'put'
        premium: Market premium (if None, use BS theoretical)
        contracts: Number of contracts
        direction: 'sell' or 'buy'
        transaction_cost_per_contract: Round-trip TC per contract
    """
    # Theoretical price
    bs_price = black_scholes(S, K, T, r, sigma, option_type)
    if premium is None:
        premium = float(bs_price)

    greeks = calculate_greeks(S, K, T, r, sigma, option_type)
    delta = abs(greeks["delta"])

    # Probability of expiring ITM ~ |delta| for quick estimate
    prob_itm = delta
    prob_otm = 1.0 - prob_itm

    total_premium = premium * contracts * 100
    total_tc = transaction_cost_per_contract * contracts * 2  # round-trip

    if direction == "sell":
        # Selling options: profit from premium, risk from assignment
        # Max profit = premium received - TC
        max_profit = total_premium - total_tc

        # Expected loss if assigned (approximation: intrinsic value at expected move)
        expected_move = S * sigma * np.sqrt(T)
        if option_type == "call":
            expected_loss_if_itm = expected_move * 0.5 * contracts * 100
        else:
            expected_loss_if_itm = expected_move * 0.5 * contracts * 100

        ev = prob_otm * max_profit - prob_itm * expected_loss_if_itm

    else:  # buy
        # Buying options: risk premium paid, profit from movement
        max_loss = total_premium + total_tc

        expected_move = S * sigma * np.sqrt(T)
        if option_type == "call":
            expected_gain_if_itm = expected_move * 0.5 * contracts * 100
        else:
            expected_gain_if_itm = expected_move * 0.5 * contracts * 100

        ev = prob_itm * expected_gain_if_itm - prob_otm * max_loss

    # Edge: difference between market premium and theoretical
    edge = (premium - float(bs_price)) * contracts * 100
    if direction == "sell":
        edge = -edge  # Selling overpriced is positive edge

    return {
        "ev": round(float(ev), 2),
        "ev_per_contract": round(float(ev / contracts), 2),
        "direction": direction,
        "option_type": option_type,
        "premium": round(premium, 4),
        "bs_theoretical": round(float(bs_price), 4),
        "edge_dollars": round(float(edge), 2),
        "prob_itm": round(float(prob_itm) * 100, 2),
        "prob_otm": round(float(prob_otm) * 100, 2),
        "max_profit": round(float(total_premium - total_tc) if direction == "sell" else float(ev), 2),
        "max_loss": round(float(-total_premium - total_tc) if direction == "buy" else float(-ev), 2),
        "transaction_costs": round(float(total_tc), 2),
        "contracts": contracts,
        "execute": bool(ev > 50 * contracts),  # $50/contract minimum EV threshold
        "signal": "EXECUTE" if ev > 50 * contracts else "PASS",
        "delta": round(float(greeks["delta"]), 4),
        "gamma": round(float(greeks["gamma"]), 4),
    }


def scan_opportunities(
    S: float,
    T: float,
    r: float,
    sigma: float,
    strike_range_pct: float = 0.2,
    num_strikes: int = 10,
    min_ev_per_contract: float = 50.0,
) -> list[dict]:
    """Scan across strikes for the best EV trades.

    Args:
        S: Current spot price
        T: Time to expiry
        r: Risk-free rate
        sigma: Implied volatility
        strike_range_pct: Range of strikes to scan (e.g., 0.2 = ±20%)
        num_strikes: Number of strikes to evaluate
        min_ev_per_contract: Minimum EV per contract to include

    Returns:
        List of trade opportunities sorted by EV
    """
    strikes = np.linspace(S * (1 - strike_range_pct), S * (1 + strike_range_pct), num_strikes)
    opportunities = []

    for K in strikes:
        for option_type in ["call", "put"]:
            for direction in ["sell", "buy"]:
                ev_data = calculate_trade_ev(
                    S=S, K=float(K), T=T, r=r, sigma=sigma,
                    option_type=option_type, direction=direction,
                )
                if ev_data["ev_per_contract"] >= min_ev_per_contract:
                    ev_data["strike"] = round(float(K), 2)
                    opportunities.append(ev_data)

    opportunities.sort(key=lambda x: x["ev_per_contract"], reverse=True)
    return opportunities
