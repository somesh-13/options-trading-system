"""
CIFR (Cipher Mining) Market Data Fetcher

Fetches real-time stock price, options chain, and calculates historical volatility.
Focused on CIFR for initial implementation.
"""

import yfinance as yf
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional


def get_cifr_price() -> float:
    """
    Get current CIFR stock price.
    
    Returns:
        Current price (float)
    """
    ticker = yf.Ticker("CIFR")
    data = ticker.history(period="1d")
    
    if data.empty:
        raise ValueError("Unable to fetch CIFR price from Yahoo Finance")
    
    return float(data['Close'].iloc[-1])


def get_historical_volatility(ticker: str = "CIFR", window: int = 30) -> float:
    """
    Calculate historical volatility (HV) using rolling window.
    
    Args:
        ticker: Stock symbol
        window: Number of days for rolling window
    
    Returns:
        Annualized historical volatility
    """
    stock = yf.Ticker(ticker)
    
    # Fetch extra data to ensure we have enough for rolling window
    hist = stock.history(period=f"{window + 10}d")
    
    if len(hist) < window:
        raise ValueError(f"Insufficient data: need {window} days, got {len(hist)}")
    
    # Calculate log returns
    returns = np.log(hist['Close'] / hist['Close'].shift(1)).dropna()
    
    # Annualized volatility (252 trading days)
    volatility = returns.std() * np.sqrt(252)
    
    return float(volatility)


def get_options_chain_yahoo(ticker: str = "CIFR") -> pd.DataFrame:
    """
    Fetch options chain from Yahoo Finance.
    
    Args:
        ticker: Stock symbol
    
    Returns:
        DataFrame with options data (strike, bid, ask, IV, volume, etc.)
    """
    stock = yf.Ticker(ticker)
    
    # Get available expiration dates
    expirations = stock.options
    
    if not expirations:
        raise ValueError(f"No options data available for {ticker}")
    
    # Get nearest expiration (first in list)
    nearest_exp = expirations[0]
    
    # Fetch options chain for nearest expiration
    opt_chain = stock.option_chain(nearest_exp)
    
    # Combine calls and puts
    calls = opt_chain.calls.copy()
    calls['type'] = 'call'
    
    puts = opt_chain.puts.copy()
    puts['type'] = 'put'
    
    # Combine both
    options = pd.concat([calls, puts], ignore_index=True)
    
    # Calculate mid price
    options['mid_price'] = (options['bid'] + options['ask']) / 2
    
    # Add expiration date
    options['expiration'] = nearest_exp
    
    return options


def detect_mispricing_cifr() -> Dict:
    """
    Detect IV vs HV mispricing opportunities for CIFR.
    
    Returns:
        Dictionary with mispricing analysis:
        {
            'ticker': 'CIFR',
            'spot_price': float,
            'historical_vol': float,
            'implied_vol_atm': float,
            'iv_hv_ratio': float,
            'signal': 'SELL' | 'BUY' | 'NEUTRAL',
            'expiration': str,
            'atm_strike': float,
            'atm_call_price': float
        }
    """
    ticker = "CIFR"
    
    # Get current price
    spot = get_cifr_price()
    
    # Get historical volatility (30-day)
    hv = get_historical_volatility(ticker, window=30)
    
    # Get options chain
    options = get_options_chain_yahoo(ticker)
    
    # Find ATM call (strike closest to spot price)
    calls = options[options['type'] == 'call'].copy()
    calls['distance_to_atm'] = abs(calls['strike'] - spot)
    atm_call = calls.loc[calls['distance_to_atm'].idxmin()]
    
    # Get implied volatility from ATM call
    iv = atm_call['impliedVolatility']
    
    # Calculate IV/HV ratio
    iv_hv_ratio = iv / hv if hv > 0 else 0
    
    # Determine signal
    if iv_hv_ratio > 1.3:
        signal = "SELL"  # IV overpriced - sell options
    elif iv_hv_ratio < 0.8:
        signal = "BUY"   # IV underpriced - buy options
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


if __name__ == "__main__":
    # Test CIFR data fetching
    print("Fetching CIFR data...")
    
    try:
        price = get_cifr_price()
        print(f"✓ Current price: ${price:.2f}")
        
        hv = get_historical_volatility("CIFR", window=30)
        print(f"✓ 30-day HV: {hv:.2%}")
        
        mispricing = detect_mispricing_cifr()
        print(f"\n📊 Mispricing Analysis:")
        print(f"  Spot: ${mispricing['spot_price']:.2f}")
        print(f"  HV: {mispricing['historical_vol']:.2%}")
        print(f"  IV (ATM): {mispricing['implied_vol_atm']:.2%}")
        print(f"  IV/HV Ratio: {mispricing['iv_hv_ratio']:.2f}x")
        print(f"  Signal: {mispricing['signal']}")
        print(f"  ATM Strike: ${mispricing['atm_strike']}")
        print(f"  ATM Call Price: ${mispricing['atm_call_price']:.2f}")
        
    except Exception as e:
        print(f"❌ Error: {e}")
