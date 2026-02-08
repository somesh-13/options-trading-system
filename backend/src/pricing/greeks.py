"""
Greeks Calculations for Options

Implements Delta, Gamma, Vega, Theta, and Rho calculations using Black-Scholes.
All Greeks are computed analytically for accuracy and speed.
"""

import numpy as np
from scipy.stats import norm
from typing import Dict


def calculate_greeks(S: float, K: float, T: float, r: float, sigma: float, option_type: str = 'call') -> Dict[str, float]:
    """
    Calculate all Greeks for an option.
    
    Args:
        S: Spot price
        K: Strike price
        T: Time to expiration (years)
        r: Risk-free rate
        sigma: Volatility
        option_type: 'call' or 'put'
    
    Returns:
        Dictionary containing:
            - delta: Change in price per $1 change in stock
            - gamma: Change in delta per $1 change in stock
            - vega: Change in price per 1% change in volatility
            - theta: Change in price per day (time decay)
            - rho: Change in price per 1% change in interest rate
    """
    if T <= 0:
        # At expiration, Greeks are undefined (or zero)
        return {
            'delta': 1.0 if S > K else 0.0,
            'gamma': 0.0,
            'vega': 0.0,
            'theta': 0.0,
            'rho': 0.0
        }
    
    # Calculate d1 and d2
    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    
    # Common terms
    phi_d1 = norm.pdf(d1)  # Standard normal PDF at d1
    N_d1 = norm.cdf(d1)    # Standard normal CDF at d1
    N_d2 = norm.cdf(d2)    # Standard normal CDF at d2
    N_minus_d1 = norm.cdf(-d1)
    N_minus_d2 = norm.cdf(-d2)
    
    # Delta
    if option_type.lower() == 'call':
        delta = N_d1
    else:  # put
        delta = N_d1 - 1
    
    # Gamma (same for call and put)
    gamma = phi_d1 / (S * sigma * np.sqrt(T))
    
    # Vega (same for call and put)
    # Divided by 100 to represent 1% volatility change
    vega = S * np.sqrt(T) * phi_d1 / 100
    
    # Theta
    # Divided by 365 to represent per-day decay
    if option_type.lower() == 'call':
        theta = (
            -(S * phi_d1 * sigma) / (2 * np.sqrt(T))
            - r * K * np.exp(-r * T) * N_d2
        ) / 365
    else:  # put
        theta = (
            -(S * phi_d1 * sigma) / (2 * np.sqrt(T))
            + r * K * np.exp(-r * T) * N_minus_d2
        ) / 365
    
    # Rho
    # Divided by 100 to represent 1% rate change
    if option_type.lower() == 'call':
        rho = K * T * np.exp(-r * T) * N_d2 / 100
    else:  # put
        rho = -K * T * np.exp(-r * T) * N_minus_d2 / 100
    
    return {
        'delta': float(delta),
        'gamma': float(gamma),
        'vega': float(vega),
        'theta': float(theta),
        'rho': float(rho)
    }


def calculate_delta(S: float, K: float, T: float, r: float, sigma: float, option_type: str = 'call') -> float:
    """Calculate Delta only (∂V/∂S)"""
    if T <= 0:
        return 1.0 if (S > K and option_type == 'call') or (S < K and option_type == 'put') else 0.0
    
    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    
    if option_type.lower() == 'call':
        return norm.cdf(d1)
    else:
        return norm.cdf(d1) - 1


def calculate_gamma(S: float, K: float, T: float, r: float, sigma: float) -> float:
    """Calculate Gamma only (∂²V/∂S²)"""
    if T <= 0:
        return 0.0
    
    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    phi_d1 = norm.pdf(d1)
    
    return phi_d1 / (S * sigma * np.sqrt(T))


def calculate_vega(S: float, K: float, T: float, r: float, sigma: float) -> float:
    """Calculate Vega only (∂V/∂σ)"""
    if T <= 0:
        return 0.0
    
    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    phi_d1 = norm.pdf(d1)
    
    return S * np.sqrt(T) * phi_d1 / 100


if __name__ == "__main__":
    # Quick test
    S, K, T, r, sigma = 100, 100, 1, 0.05, 0.2
    
    greeks_call = calculate_greeks(S, K, T, r, sigma, 'call')
    greeks_put = calculate_greeks(S, K, T, r, sigma, 'put')
    
    print("Call Greeks:")
    for greek, value in greeks_call.items():
        print(f"  {greek.capitalize()}: {value:.4f}")
    
    print("\nPut Greeks:")
    for greek, value in greeks_put.items():
        print(f"  {greek.capitalize()}: {value:.4f}")
