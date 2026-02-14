#!/usr/bin/env python3
"""
Keltner Channel Calculator - Weekly Timeframe
Uses EMA-20 and ATR-20 to calculate upper/lower bands
"""

import requests
import os
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
try:
    import yfinance as yf
    HAS_YFINANCE = True
except ImportError:
    HAS_YFINANCE = False


def get_weekly_data(symbol, weeks=52):
    """
    Fetch weekly OHLC data using yfinance (reliable, free)
    Falls back to Alpaca if yfinance unavailable
    
    Args:
        symbol: Stock ticker (e.g., 'HOOD')
        weeks: Number of weeks to fetch (default 52 = 1 year)
    
    Returns:
        DataFrame with columns: open, high, low, close, volume, timestamp
    """
    # Try yfinance first (more reliable for weekly data)
    if HAS_YFINANCE:
        try:
            # Calculate period
            period = f"{int(weeks/52) + 1}y" if weeks > 52 else "1y"
            
            # Fetch data
            ticker = yf.Ticker(symbol)
            df = ticker.history(period=period, interval="1wk")
            
            if df.empty:
                raise ValueError(f"No data returned for {symbol}")
            
            # Standardize column names
            df = df.reset_index()
            df = df.rename(columns={
                'Date': 'timestamp',
                'Open': 'open',
                'High': 'high',
                'Low': 'low',
                'Close': 'close',
                'Volume': 'volume'
            })
            
            # Take last N weeks
            df = df.tail(weeks)
            df = df[['timestamp', 'open', 'high', 'low', 'close', 'volume']]
            df = df.reset_index(drop=True)
            
            return df
            
        except Exception as e:
            print(f"yfinance failed, trying Alpaca: {e}")
    
    # Fallback to Alpaca
    api_key = os.environ.get('ALPACA_API_KEY')
    secret_key = os.environ.get('ALPACA_SECRET_KEY')
    
    if not api_key or not secret_key:
        raise ValueError("No data source available (yfinance not installed, Alpaca credentials missing)")
    
    # Calculate date range
    end_date = datetime.now()
    start_date = end_date - timedelta(weeks=weeks)
    
    # Alpaca bars endpoint
    url = f'https://data.alpaca.markets/v2/stocks/{symbol}/bars'
    headers = {
        'APCA-API-KEY-ID': api_key,
        'APCA-API-SECRET-KEY': secret_key
    }
    
    params = {
        'timeframe': '1W',  # Weekly bars
        'start': start_date.strftime('%Y-%m-%d'),
        'end': end_date.strftime('%Y-%m-%d'),
        'limit': weeks,
        'adjustment': 'split'  # Adjust for splits
    }
    
    try:
        response = requests.get(url, headers=headers, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        if 'bars' not in data or not data['bars']:
            raise ValueError(f"No weekly data found for {symbol}")
        
        # Convert to DataFrame
        df = pd.DataFrame(data['bars'])
        df['timestamp'] = pd.to_datetime(df['t'])
        df = df.rename(columns={'o': 'open', 'h': 'high', 'l': 'low', 'c': 'close', 'v': 'volume'})
        df = df[['timestamp', 'open', 'high', 'low', 'close', 'volume']]
        df = df.sort_values('timestamp').reset_index(drop=True)
        
        return df
        
    except Exception as e:
        raise ValueError(f"Error fetching weekly data for {symbol}: {str(e)}")


def calculate_ema(prices, period=20):
    """
    Calculate Exponential Moving Average
    
    Args:
        prices: Series or array of prices
        period: EMA period (default 20)
    
    Returns:
        Series of EMA values
    """
    if isinstance(prices, pd.Series):
        return prices.ewm(span=period, adjust=False).mean()
    else:
        prices_series = pd.Series(prices)
        return prices_series.ewm(span=period, adjust=False).mean()


def calculate_atr(high, low, close, period=20):
    """
    Calculate Average True Range
    
    Args:
        high: Series of high prices
        low: Series of low prices
        close: Series of close prices
        period: ATR period (default 20)
    
    Returns:
        Series of ATR values
    """
    # True Range = max(high - low, abs(high - prev_close), abs(low - prev_close))
    prev_close = close.shift(1)
    
    tr1 = high - low
    tr2 = abs(high - prev_close)
    tr3 = abs(low - prev_close)
    
    true_range = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    
    # ATR is EMA of True Range
    atr = true_range.ewm(span=period, adjust=False).mean()
    
    return atr


def calculate_keltner_channel(symbol, ema_period=20, atr_period=20, multiplier=2.0, weeks=52):
    """
    Calculate Keltner Channel for weekly data
    
    Args:
        symbol: Stock ticker
        ema_period: EMA period (default 20 weeks)
        atr_period: ATR period (default 20 weeks)
        multiplier: ATR multiplier for bands (default 2.0)
        weeks: Historical data to fetch (default 52 weeks)
    
    Returns:
        dict with:
            - middle: Middle line (EMA-20)
            - upper: Upper band (EMA + 2*ATR)
            - lower: Lower band (EMA - 2*ATR)
            - current_price: Latest close price
            - position: 'BOTTOM'|'TOP'|'MIDDLE'
            - atr: Current ATR value
            - band_width: Distance between upper and lower
    """
    # Fetch data
    df = get_weekly_data(symbol, weeks)
    
    if len(df) < max(ema_period, atr_period):
        raise ValueError(f"Not enough data for {symbol}: need {max(ema_period, atr_period)} weeks, got {len(df)}")
    
    # Calculate EMA (middle line)
    df['ema'] = calculate_ema(df['close'], ema_period)
    
    # Calculate ATR
    df['atr'] = calculate_atr(df['high'], df['low'], df['close'], atr_period)
    
    # Calculate bands
    df['upper'] = df['ema'] + (multiplier * df['atr'])
    df['lower'] = df['ema'] - (multiplier * df['atr'])
    
    # Get latest values
    latest = df.iloc[-1]
    
    current_price = latest['close']
    middle = latest['ema']
    upper = latest['upper']
    lower = latest['lower']
    atr = latest['atr']
    band_width = upper - lower
    
    # Determine position (with 5% threshold)
    threshold = 0.05
    bottom_zone = lower + (band_width * threshold)
    top_zone = upper - (band_width * threshold)
    
    if current_price <= bottom_zone:
        position = 'BOTTOM'
    elif current_price >= top_zone:
        position = 'TOP'
    else:
        position = 'MIDDLE'
    
    return {
        'symbol': symbol,
        'current_price': float(current_price),
        'middle': float(middle),
        'upper': float(upper),
        'lower': float(lower),
        'atr': float(atr),
        'band_width': float(band_width),
        'position': position,
        'timestamp': latest['timestamp'].isoformat(),
        'pct_from_lower': float(((current_price - lower) / band_width) * 100),
        'pct_from_upper': float(((upper - current_price) / band_width) * 100)
    }


if __name__ == '__main__':
    # Test with HOOD
    import sys
    
    if len(sys.argv) > 1:
        symbol = sys.argv[1].upper()
    else:
        symbol = 'HOOD'
    
    print(f"\n🔍 Keltner Channel Analysis - {symbol} (Weekly)")
    print("=" * 60)
    
    try:
        result = calculate_keltner_channel(symbol)
        
        print(f"\nCurrent Price: ${result['current_price']:.2f}")
        print(f"Position: {result['position']}")
        print(f"\nKeltner Bands:")
        print(f"  Upper:  ${result['upper']:.2f} ({result['pct_from_upper']:.1f}% away)")
        print(f"  Middle: ${result['middle']:.2f} (EMA-20)")
        print(f"  Lower:  ${result['lower']:.2f} ({result['pct_from_lower']:.1f}% away)")
        print(f"\nBand Width: ${result['band_width']:.2f}")
        print(f"ATR (20): ${result['atr']:.2f}")
        print(f"Last Updated: {result['timestamp'][:10]}")
        
        if result['position'] == 'BOTTOM':
            print(f"\n🟢 AT SUPPORT - Consider selling cash-secured puts (if IV spike)")
        elif result['position'] == 'TOP':
            print(f"\n🔴 AT RESISTANCE - Consider selling covered calls (if IV spike)")
        else:
            print(f"\n⚪ MIDDLE OF CHANNEL - No edge at current price level")
            
    except Exception as e:
        print(f"\n❌ Error: {e}")
        sys.exit(1)
