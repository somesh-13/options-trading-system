"""
Volatility Surface Generator

Builds 3D volatility surface from options chain data.
X-axis: Strike, Y-axis: Expiration, Z-axis: Implied Volatility
"""

import numpy as np
import yfinance as yf
from datetime import datetime
from typing import Dict, List, Optional

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))

from pricing.implied_vol import implied_volatility
from data.cifr_data import get_options_chain_yahoo


def generate_vol_smile(ticker: str, expiration_index: int = 0) -> Dict:
    """
    Generate volatility smile for a single expiration.

    Args:
        ticker: Stock symbol
        expiration_index: Index into available expirations (0 = nearest)

    Returns:
        {strikes: [], ivs: [], spot_price: float, expiration: str}
    """
    stock = yf.Ticker(ticker)
    expirations = stock.options

    if not expirations:
        raise ValueError(f"No options data for {ticker}")

    if expiration_index >= len(expirations):
        expiration_index = len(expirations) - 1

    exp_date = expirations[expiration_index]
    chain = stock.option_chain(exp_date)

    # Get spot price
    hist = stock.history(period="1d")
    spot = float(hist['Close'].iloc[-1])

    # Calculate time to expiration
    exp_dt = datetime.strptime(exp_date, "%Y-%m-%d")
    T = max((exp_dt - datetime.now()).days / 365.0, 1/365)

    calls = chain.calls
    strikes = []
    ivs = []

    for _, row in calls.iterrows():
        mid_price = (row['bid'] + row['ask']) / 2
        if mid_price > 0.01 and row['bid'] > 0:
            iv = implied_volatility(
                market_price=mid_price,
                S=spot,
                K=row['strike'],
                T=T,
                r=0.05,
                option_type='call'
            )
            if iv is not None and 0.01 < iv < 5.0:
                strikes.append(float(row['strike']))
                ivs.append(float(iv))

    return {
        'strikes': strikes,
        'ivs': ivs,
        'spot_price': spot,
        'expiration': exp_date,
        'ticker': ticker
    }


def generate_vol_surface(ticker: str, max_expirations: int = 6) -> Dict:
    """
    Generate full volatility surface across multiple expirations.

    Args:
        ticker: Stock symbol
        max_expirations: Maximum number of expirations to include

    Returns:
        {strikes: [], expirations: [], iv_matrix: [[]], spot_price: float}
    """
    stock = yf.Ticker(ticker)
    expirations = stock.options

    if not expirations:
        raise ValueError(f"No options data for {ticker}")

    n_exp = min(len(expirations), max_expirations)

    hist = stock.history(period="1d")
    spot = float(hist['Close'].iloc[-1])

    all_strikes = set()
    exp_data = []

    for i in range(n_exp):
        exp_date = expirations[i]
        try:
            chain = stock.option_chain(exp_date)
            exp_dt = datetime.strptime(exp_date, "%Y-%m-%d")
            T = max((exp_dt - datetime.now()).days / 365.0, 1/365)

            calls = chain.calls
            strike_iv_map = {}

            for _, row in calls.iterrows():
                mid_price = (row['bid'] + row['ask']) / 2
                if mid_price > 0.01 and row['bid'] > 0:
                    iv = implied_volatility(
                        market_price=mid_price,
                        S=spot,
                        K=row['strike'],
                        T=T,
                        r=0.05,
                        option_type='call'
                    )
                    if iv is not None and 0.01 < iv < 5.0:
                        strike_iv_map[float(row['strike'])] = float(iv)
                        all_strikes.add(float(row['strike']))

            exp_data.append({
                'expiration': exp_date,
                'T': T,
                'strike_iv_map': strike_iv_map
            })
        except Exception:
            continue

    if not exp_data or not all_strikes:
        raise ValueError(f"Insufficient options data for {ticker}")

    sorted_strikes = sorted(all_strikes)
    sorted_expirations = [e['expiration'] for e in exp_data]

    # Build IV matrix (expirations x strikes), None for missing data
    iv_matrix = []
    for exp in exp_data:
        row = []
        for strike in sorted_strikes:
            iv_val = exp['strike_iv_map'].get(strike)
            row.append(iv_val)
        iv_matrix.append(row)

    return {
        'strikes': sorted_strikes,
        'expirations': sorted_expirations,
        'iv_matrix': iv_matrix,
        'spot_price': spot,
        'ticker': ticker
    }
