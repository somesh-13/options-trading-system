"""
Black-Scholes Options Pricing Model

Implements European call and put option pricing using the Black-Scholes formula.
Vectorized for efficient calculation across multiple strikes/expiries.
"""

import numpy as np
from scipy.stats import norm


def black_scholes_call(S: float, K: float | np.ndarray, T: float, r: float, sigma: float) -> float | np.ndarray:
    """
    Calculate European call option price using Black-Scholes formula.
    
    Args:
        S: Spot price (current stock price)
        K: Strike price (can be array for multiple strikes)
        T: Time to expiration in years
        r: Risk-free rate (annualized)
        sigma: Volatility (annualized standard deviation)
    
    Returns:
        Call option price (float or array matching K)
    
    Example:
        >>> price = black_scholes_call(S=100, K=100, T=1, r=0.05, sigma=0.2)
        >>> print(f"Call price: ${price:.2f}")
    """
    if T <= 0:
        # At expiration: intrinsic value only
        return np.maximum(S - K, 0)
    
    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    
    call_price = S * norm.cdf(d1) - K * np.exp(-r * T) * norm.cdf(d2)
    return call_price


def black_scholes_put(S: float, K: float | np.ndarray, T: float, r: float, sigma: float) -> float | np.ndarray:
    """
    Calculate European put option price using Black-Scholes formula.
    
    Args:
        S: Spot price (current stock price)
        K: Strike price (can be array for multiple strikes)
        T: Time to expiration in years
        r: Risk-free rate (annualized)
        sigma: Volatility (annualized standard deviation)
    
    Returns:
        Put option price (float or array matching K)
    """
    if T <= 0:
        # At expiration: intrinsic value only
        return np.maximum(K - S, 0)
    
    d1 = (np.log(S / K) + (r + 0.5 * sigma**2) * T) / (sigma * np.sqrt(T))
    d2 = d1 - sigma * np.sqrt(T)
    
    put_price = K * np.exp(-r * T) * norm.cdf(-d2) - S * norm.cdf(-d1)
    return put_price


def black_scholes(S: float, K: float | np.ndarray, T: float, r: float, sigma: float, option_type: str = 'call') -> float | np.ndarray:
    """
    Unified interface for Black-Scholes pricing.
    
    Args:
        S: Spot price
        K: Strike price
        T: Time to expiration (years)
        r: Risk-free rate
        sigma: Volatility
        option_type: 'call' or 'put'
    
    Returns:
        Option price
    
    Raises:
        ValueError: If option_type is not 'call' or 'put'
    """
    if option_type.lower() == 'call':
        return black_scholes_call(S, K, T, r, sigma)
    elif option_type.lower() == 'put':
        return black_scholes_put(S, K, T, r, sigma)
    else:
        raise ValueError(f"option_type must be 'call' or 'put', got '{option_type}'")


if __name__ == "__main__":
    # Quick test
    S, K, T, r, sigma = 100, 100, 1, 0.05, 0.2
    call = black_scholes_call(S, K, T, r, sigma)
    put = black_scholes_put(S, K, T, r, sigma)
    
    print(f"Call price: ${call:.4f}")
    print(f"Put price: ${put:.4f}")
    print(f"Put-Call Parity: C - P = {call - put:.4f}, S - PV(K) = {S - K * np.exp(-r * T):.4f}")
