"""
CIFR (Cipher Mining) Market Data Fetcher

Fetches real-time stock price, options chain, and calculates historical volatility.
Focused on CIFR for initial implementation.
"""

import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from data.market_provider import (
    get_history,
    get_option_chain,
    get_option_expirations,
    history_to_dataframe,
)


def get_cifr_price() -> float:
    """Get current CIFR stock price."""
    bars = get_history("CIFR", period="1d")
    if not bars:
        raise ValueError("Unable to fetch CIFR price from market provider")
    return float(bars[-1].close)


def get_historical_volatility(ticker: str = "CIFR", window: int = 30) -> float:
    """Annualized HV from a rolling window of log returns."""
    bars = get_history(ticker, period=f"{window + 10}d")
    if len(bars) < window:
        raise ValueError(f"Insufficient data: need {window} days, got {len(bars)}")
    hist = history_to_dataframe(bars)
    returns = np.log(hist['Close'] / hist['Close'].shift(1)).dropna()
    return float(returns.std() * np.sqrt(252))


def get_options_chain_yahoo(ticker: str = "CIFR") -> pd.DataFrame:
    """Fetch options chain (calls + puts) for the nearest expiration via the
    market provider. Returns a DataFrame with the columns the rest of the
    backend already expects (strike, bid, ask, impliedVolatility, volume,
    openInterest, type, mid_price, expiration)."""
    expirations = get_option_expirations(ticker)
    if not expirations:
        raise ValueError(f"No options data available for {ticker}")

    nearest_exp = expirations[0]
    chain = get_option_chain(ticker, nearest_exp)

    def _contracts_to_records(contracts, side: str):
        return [
            {
                "strike": c.strike,
                "lastPrice": c.last_price,
                "bid": c.bid,
                "ask": c.ask,
                "impliedVolatility": c.implied_volatility,
                "openInterest": c.open_interest,
                "volume": c.volume,
                "inTheMoney": c.in_the_money,
                "type": side,
            }
            for c in contracts
        ]

    options = pd.DataFrame(
        _contracts_to_records(chain.calls, "call")
        + _contracts_to_records(chain.puts, "put")
    )
    if options.empty:
        return options
    options['mid_price'] = (options['bid'].fillna(0) + options['ask'].fillna(0)) / 2
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
