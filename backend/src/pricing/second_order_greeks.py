"""
Second-Order Greeks: Vanna and Charm

These measure how Delta changes with volatility and time, critical for
understanding how hedges "bleed" or "gain" in different market regimes.
"""

import numpy as np
from scipy.stats import norm


def calculate_vanna(S: float, K: float, T: float, r: float, sigma: float) -> float:
    """
    Calculate Vanna: ∂Delta/∂σ (or ∂Vega/∂S)
    
    Measures how Delta changes when volatility changes.
    Critical for understanding hedge risk during volatility shocks.
    
    Args:
        S: Spot price
        K: Strike price
        T: Time to expiration (years)
        r: Risk-free rate
        sigma: Volatility
    
    Returns:
        Vanna (change in delta per 1% volatility change)
    
    Interview Question:
        "If IV spikes by 10%, how much will your delta hedge be off by?"
        Answer: Vanna × 10% × position_size
    """
    if T <= 0 or sigma <= 0:
        return 0.0
    
    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    
    phi_d1 = norm.pdf(d1)
    
    # Vanna = -φ(d1) × d2 / σ
    vanna = -phi_d1 * d2 / sigma / 100  # Divided by 100 for 1% vol change
    
    return float(vanna)


def calculate_charm(S: float, K: float, T: float, r: float, sigma: float, option_type: str = 'call') -> float:
    """
    Calculate Charm: ∂Delta/∂t (Delta decay)
    
    Measures how Delta changes as time passes (with all else constant).
    Critical for understanding how hedges need to be adjusted over time.
    
    Args:
        S: Spot price
        K: Strike price
        T: Time to expiration (years)
        r: Risk-free rate
        sigma: Volatility
        option_type: 'call' or 'put'
    
    Returns:
        Charm (change in delta per day)
    
    Interview Question:
        "Your delta is 0.5 today. What will it be tomorrow if nothing else changes?"
        Answer: delta_tomorrow = delta_today + charm
    
    SIG Context:
        Charm tells you how much your Delta hedge will "bleed" as expiration approaches.
        If you're delta-neutral today, you might need to trade tomorrow just due to time decay.
    """
    if T <= 0 or sigma <= 0:
        return 0.0
    
    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    
    phi_d1 = norm.pdf(d1)
    N_d2 = norm.cdf(d2)
    N_minus_d2 = norm.cdf(-d2)
    
    # Charm formula (per day, so divide by 365)
    if option_type.lower() == 'call':
        charm = -phi_d1 * (
            (2 * r * T - d2 * sigma * np.sqrt(T)) / (2 * T * sigma * np.sqrt(T))
        ) / 365
    else:  # put
        charm = -phi_d1 * (
            (2 * r * T - d2 * sigma * np.sqrt(T)) / (2 * T * sigma * np.sqrt(T))
        ) / 365
    
    return float(charm)


def calculate_volga(S: float, K: float, T: float, r: float, sigma: float) -> float:
    """
    Calculate Volga (Vomma): ∂Vega/∂σ
    
    Measures convexity of option price with respect to volatility.
    Important for understanding Vega hedge stability.
    
    Args:
        S: Spot price
        K: Strike price
        T: Time to expiration (years)
        r: Risk-free rate
        sigma: Volatility
    
    Returns:
        Volga (second derivative of price w.r.t. volatility)
    """
    if T <= 0 or sigma <= 0:
        return 0.0
    
    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    
    phi_d1 = norm.pdf(d1)
    
    # Volga = Vega × (d1 × d2 / σ)
    vega = S * np.sqrt(T) * phi_d1
    volga = vega * d1 * d2 / sigma / 10000  # Divided by 10000 for 1% vol change squared
    
    return float(volga)


def calculate_all_second_order_greeks(S: float, K: float, T: float, r: float, sigma: float, option_type: str = 'call') -> dict:
    """
    Calculate all second-order Greeks at once.
    
    Returns:
        {
            'vanna': float,    # ∂Delta/∂σ
            'charm': float,    # ∂Delta/∂t
            'volga': float     # ∂Vega/∂σ
        }
    """
    return {
        'vanna': calculate_vanna(S, K, T, r, sigma),
        'charm': calculate_charm(S, K, T, r, sigma, option_type),
        'volga': calculate_volga(S, K, T, r, sigma)
    }


if __name__ == "__main__":
    # Test with CIFR example
    S, K, T, r, sigma = 15.50, 16, 30/365, 0.05, 0.8
    
    second_order = calculate_all_second_order_greeks(S, K, T, r, sigma, 'call')
    
    print("Second-Order Greeks (CIFR $16 Call, 30 DTE):")
    print(f"  Vanna: {second_order['vanna']:.6f} (delta change per 1% vol)")
    print(f"  Charm: {second_order['charm']:.6f} (delta change per day)")
    print(f"  Volga: {second_order['volga']:.6f} (vega convexity)")
    
    print("\n📖 Interview Interpretation:")
    print(f"  • If IV increases by 10%, delta changes by {second_order['vanna'] * 10:.4f}")
    print(f"  • Tomorrow (all else equal), delta changes by {second_order['charm']:.4f}")
    print(f"  • This position has {'positive' if second_order['volga'] > 0 else 'negative'} vega convexity")
