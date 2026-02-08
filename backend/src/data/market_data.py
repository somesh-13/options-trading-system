"""
Generic Market Data Module

Generalized version of cifr_data.py that works with any ticker.
Keeps cifr_data.py for backward compatibility.
"""

import yfinance as yf
import numpy as np
import pandas as pd
from datetime import datetime
from typing import Dict, Optional

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))

from data.cifr_data import get_historical_volatility, get_options_chain_yahoo


def get_ticker_price(ticker: str) -> float:
    """
    Get current stock price for any ticker.
    """
    stock = yf.Ticker(ticker)
    data = stock.history(period="1d")

    if data.empty:
        raise ValueError(f"Unable to fetch price for {ticker}")

    return float(data['Close'].iloc[-1])


def detect_mispricing(ticker: str) -> Dict:
    """
    Detect IV vs HV mispricing for any ticker.
    Generalized version of detect_mispricing_cifr().
    """
    spot = get_ticker_price(ticker)
    hv = get_historical_volatility(ticker, window=30)
    options = get_options_chain_yahoo(ticker)

    # Find ATM call
    calls = options[options['type'] == 'call'].copy()
    calls['distance_to_atm'] = abs(calls['strike'] - spot)
    atm_call = calls.loc[calls['distance_to_atm'].idxmin()]

    iv = atm_call['impliedVolatility']
    iv_hv_ratio = iv / hv if hv > 0 else 0

    if iv_hv_ratio > 1.3:
        signal = "SELL"
    elif iv_hv_ratio < 0.8:
        signal = "BUY"
    else:
        signal = "NEUTRAL"

    return {
        'ticker': ticker,
        'spot_price': float(spot),
        'historical_vol': float(hv),
        'implied_vol_atm': float(iv),
        'iv_hv_ratio': float(iv_hv_ratio),
        'signal': signal,
        'expiration': str(atm_call['expiration']),
        'atm_strike': float(atm_call['strike']),
        'atm_call_price': float(atm_call['mid_price']),
        'bid': float(atm_call['bid']),
        'ask': float(atm_call['ask']),
        'volume': int(atm_call['volume']) if not pd.isna(atm_call['volume']) else 0,
        'open_interest': int(atm_call['openInterest']) if not pd.isna(atm_call['openInterest']) else 0
    }


def get_options_chain(ticker: str, expiration_index: int = 0) -> Dict:
    """
    Get options chain for any ticker.

    Returns dict with calls, puts DataFrames and metadata.
    """
    stock = yf.Ticker(ticker)
    expirations = stock.options

    if not expirations:
        raise ValueError(f"No options data for {ticker}")

    if expiration_index >= len(expirations):
        expiration_index = len(expirations) - 1

    exp_date = expirations[expiration_index]
    chain = stock.option_chain(exp_date)

    calls = chain.calls.to_dict(orient='records')
    puts = chain.puts.to_dict(orient='records')

    return {
        'ticker': ticker,
        'expiration': exp_date,
        'expirations_available': list(expirations),
        'calls': calls,
        'puts': puts
    }


def get_tca_data(ticker: str) -> Dict:
    """
    Transaction Cost Analysis using bid/ask spread data.
    """
    spot = get_ticker_price(ticker)
    options = get_options_chain_yahoo(ticker)

    calls = options[options['type'] == 'call'].copy()
    calls['distance_to_atm'] = abs(calls['strike'] - spot)
    atm_call = calls.loc[calls['distance_to_atm'].idxmin()]

    bid = float(atm_call['bid'])
    ask = float(atm_call['ask'])
    mid = (bid + ask) / 2
    spread = ask - bid
    spread_pct = (spread / mid * 100) if mid > 0 else 0

    # Estimate slippage (half the spread for market orders)
    slippage = spread / 2

    # Total estimated TCA per contract
    tca_per_contract = spread * 100  # 100 shares per contract

    # Get IV and HV for edge comparison
    hv = get_historical_volatility(ticker, window=30)
    iv = float(atm_call['impliedVolatility'])
    edge = abs(iv - hv)

    # Convert edge to dollar terms (approximate via vega)
    # Edge survives if dollar edge > TCA
    edge_in_dollars = edge * mid * 100  # rough approximation
    edge_survives = edge_in_dollars > tca_per_contract

    return {
        'ticker': ticker,
        'bid': round(bid, 4),
        'ask': round(ask, 4),
        'mid': round(mid, 4),
        'spread': round(spread, 4),
        'spread_pct': round(spread_pct, 2),
        'slippage_estimate': round(slippage, 4),
        'tca_per_contract': round(tca_per_contract, 2),
        'iv': round(iv, 4),
        'hv': round(hv, 4),
        'edge_dollars': round(edge_in_dollars, 2),
        'edge_survives_tca': edge_survives,
        'atm_strike': float(atm_call['strike']),
        'expiration': str(atm_call['expiration'])
    }
