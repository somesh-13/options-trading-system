"""
Implied Volatility Solver

Uses Newton-Raphson method to solve for implied volatility given market price.
Vega (∂V/∂σ) is used as the derivative for fast convergence.
"""

import numpy as np
from .black_scholes import black_scholes
from .greeks import calculate_vega


def implied_volatility(
    market_price: float,
    S: float,
    K: float,
    T: float,
    r: float,
    option_type: str = 'call',
    max_iterations: int = 100,
    tolerance: float = 1e-6
) -> float | None:
    """
    Solve for implied volatility using Newton-Raphson method.
    
    Args:
        market_price: Observed option price in market
        S: Spot price
        K: Strike price
        T: Time to expiration (years)
        r: Risk-free rate
        option_type: 'call' or 'put'
        max_iterations: Maximum solver iterations
        tolerance: Convergence threshold
    
    Returns:
        Implied volatility (float) or None if no convergence
    
    Algorithm:
        Newton-Raphson: σ_new = σ_old + (market_price - BS_price) / vega
        
    Example:
        >>> iv = implied_volatility(market_price=10.45, S=100, K=100, T=1, r=0.05)
        >>> print(f"Implied Vol: {iv:.2%}")
    """
    # Input validation
    if market_price <= 0:
        return None
    
    if T <= 0:
        # At expiration, check if price matches intrinsic value
        intrinsic = max(S - K, 0) if option_type == 'call' else max(K - S, 0)
        return None if abs(market_price - intrinsic) > tolerance else 0.0
    
    # Check bounds (arbitrage-free constraints)
    if option_type == 'call':
        lower_bound = max(S - K * np.exp(-r * T), 0)
        upper_bound = S
    else:  # put
        lower_bound = max(K * np.exp(-r * T) - S, 0)
        upper_bound = K * np.exp(-r * T)
    
    if market_price < lower_bound or market_price > upper_bound:
        # Price violates arbitrage bounds
        return None
    
    # Initial guess: 30% volatility
    sigma = 0.3
    
    for i in range(max_iterations):
        # Calculate theoretical price and vega
        price = black_scholes(S, K, T, r, sigma, option_type)
        vega = calculate_vega(S, K, T, r, sigma)
        
        # Undo the /100 scaling in vega calculation
        vega_full = vega * 100
        
        # Check convergence
        diff = market_price - price
        if abs(diff) < tolerance:
            return sigma
        
        # Avoid division by zero
        if vega_full == 0:
            return None
        
        # Newton-Raphson update
        sigma += diff / vega_full
        
        # Keep sigma within reasonable bounds (1% to 500%)
        sigma = max(0.01, min(sigma, 5.0))
    
    # Did not converge
    return None


def iv_vectorized(
    market_prices: np.ndarray,
    S: float,
    K: np.ndarray,
    T: float,
    r: float,
    option_type: str = 'call'
) -> np.ndarray:
    """
    Vectorized implied volatility solver for entire options chain.
    
    Args:
        market_prices: Array of observed option prices
        S: Spot price
        K: Array of strike prices
        T: Time to expiration
        r: Risk-free rate
        option_type: 'call' or 'put'
    
    Returns:
        Array of implied volatilities (None values become np.nan)
    """
    iv_array = np.zeros_like(market_prices, dtype=float)
    
    for i, (price, strike) in enumerate(zip(market_prices, K)):
        iv = implied_volatility(price, S, strike, T, r, option_type)
        iv_array[i] = iv if iv is not None else np.nan
    
    return iv_array


def bisection_iv(
    market_price: float,
    S: float,
    K: float,
    T: float,
    r: float,
    option_type: str = 'call',
    max_iterations: int = 100,
    tolerance: float = 1e-6
) -> dict | None:
    """
    Solve for implied volatility using bisection method.
    More robust than Newton-Raphson but slower convergence.

    Returns:
        dict with 'iv', 'iterations', 'method' or None if no convergence
    """
    if market_price <= 0 or T <= 0:
        return None

    # Check arbitrage bounds
    if option_type == 'call':
        lower_bound = max(S - K * np.exp(-r * T), 0)
        upper_bound = S
    else:
        lower_bound = max(K * np.exp(-r * T) - S, 0)
        upper_bound = K * np.exp(-r * T)

    if market_price < lower_bound or market_price > upper_bound:
        return None

    sigma_low = 0.01
    sigma_high = 5.0

    for i in range(max_iterations):
        sigma_mid = (sigma_low + sigma_high) / 2
        price = black_scholes(S, K, T, r, sigma_mid, option_type)
        diff = price - market_price

        if abs(diff) < tolerance:
            return {'iv': sigma_mid, 'iterations': i + 1, 'method': 'bisection'}

        if diff > 0:
            sigma_high = sigma_mid
        else:
            sigma_low = sigma_mid

    return None


def implied_volatility_nr(
    market_price: float,
    S: float,
    K: float,
    T: float,
    r: float,
    option_type: str = 'call',
    max_iterations: int = 100,
    tolerance: float = 1e-6
) -> dict | None:
    """
    Newton-Raphson IV solver that returns detailed result dict.
    """
    if market_price <= 0 or T <= 0:
        return None

    if option_type == 'call':
        lower_bound = max(S - K * np.exp(-r * T), 0)
        upper_bound = S
    else:
        lower_bound = max(K * np.exp(-r * T) - S, 0)
        upper_bound = K * np.exp(-r * T)

    if market_price < lower_bound or market_price > upper_bound:
        return None

    sigma = 0.3

    for i in range(max_iterations):
        price = black_scholes(S, K, T, r, sigma, option_type)
        vega = calculate_vega(S, K, T, r, sigma)
        vega_full = vega * 100

        diff = market_price - price
        if abs(diff) < tolerance:
            return {'iv': sigma, 'iterations': i + 1, 'method': 'newton_raphson'}

        if vega_full == 0:
            return None

        sigma += diff / vega_full
        sigma = max(0.01, min(sigma, 5.0))

    return None


def implied_volatility_compare(
    market_price: float,
    S: float,
    K: float,
    T: float,
    r: float,
    option_type: str = 'call'
) -> dict:
    """
    Compare Newton-Raphson and Bisection IV solvers.
    Returns both results with iteration counts.
    """
    import time

    start = time.perf_counter()
    nr_result = implied_volatility_nr(market_price, S, K, T, r, option_type)
    nr_time = time.perf_counter() - start

    start = time.perf_counter()
    bs_result = bisection_iv(market_price, S, K, T, r, option_type)
    bs_time = time.perf_counter() - start

    return {
        'newton_raphson': {
            'iv': nr_result['iv'] if nr_result else None,
            'iterations': nr_result['iterations'] if nr_result else None,
            'time_ms': nr_time * 1000,
            'converged': nr_result is not None
        },
        'bisection': {
            'iv': bs_result['iv'] if bs_result else None,
            'iterations': bs_result['iterations'] if bs_result else None,
            'time_ms': bs_time * 1000,
            'converged': bs_result is not None
        }
    }


if __name__ == "__main__":
    # Test with known values
    import sys
    from pathlib import Path
    sys.path.append(str(Path(__file__).parent))
    from black_scholes import black_scholes
    
    # Generate a known option price
    S, K, T, r, true_sigma = 100, 100, 1, 0.05, 0.25
    market_price = black_scholes(S, K, T, r, true_sigma, 'call')
    
    print(f"True volatility: {true_sigma:.4f}")
    print(f"Market price: ${market_price:.4f}")
    
    # Solve for IV
    solved_iv = implied_volatility(market_price, S, K, T, r, 'call')
    
    if solved_iv:
        print(f"Solved IV: {solved_iv:.4f}")
        print(f"Error: {abs(solved_iv - true_sigma):.6f}")
    else:
        print("IV solver failed to converge")
