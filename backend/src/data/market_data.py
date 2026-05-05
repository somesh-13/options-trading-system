"""
Generic Market Data Module

Generalized version of cifr_data.py that works with any ticker.
Keeps cifr_data.py for backward compatibility.
"""

import math

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


def get_ticker_detail(ticker: str) -> Dict:
    """
    Rich ticker snapshot for the stock detail page: price, day/52w range,
    volume, market cap, P/E, company name. Tolerant of yfinance flakiness —
    missing fields come back as None rather than raising.
    """
    stock = yf.Ticker(ticker)
    hist = stock.history(period="5d")

    if hist.empty:
        raise ValueError(f"Unable to fetch price for {ticker}")

    last = hist.iloc[-1]
    prev_close = float(hist['Close'].iloc[-2]) if len(hist) >= 2 else float(last['Open'])
    price = float(last['Close'])
    # Refuse to leak a bogus 0 / NaN price: yfinance occasionally returns a
    # row with NaN Close (rate-limited, delisted, or stale-cache). The DCF
    # page does `currentPrice.toFixed(2)` and would otherwise render "$0.00",
    # which the user reads as "this stock is worthless." Better to 5xx here so
    # the frontend can show a clean error / loading state.
    if not math.isfinite(price) or price <= 0:
        raise ValueError(
            f"yfinance returned an invalid Close ({price!r}) for {ticker}; refusing to surface as $0"
        )
    change = price - prev_close
    change_pct = (change / prev_close * 100.0) if prev_close else 0.0

    info: Dict = {}
    try:
        info = stock.info or {}
    except Exception:
        info = {}

    def _f(key):
        v = info.get(key)
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    def _i(key):
        v = info.get(key)
        try:
            return int(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    market_cap_raw = info.get('marketCap')
    market_cap_str = _format_market_cap(market_cap_raw) if market_cap_raw else "—"

    # DCF-friendly fundamentals. All in absolute dollars (not $M) so the client
    # can decide its own display units. Any missing field stays as None so the
    # frontend can fall back to a sensible default.
    total_debt = _f('totalDebt')
    total_cash = _f('totalCash') or _f('totalCashPerShare')
    net_debt_abs = None
    if total_debt is not None:
        net_debt_abs = total_debt - (total_cash or 0.0)

    fundamentals = {
        'revenue':          _f('totalRevenue'),        # TTM revenue ($)
        'operatingMargin':  _f('operatingMargins'),    # decimal (0.25 = 25%)
        'profitMargin':     _f('profitMargins'),       # decimal
        'sharesOutstanding': _f('sharesOutstanding'),  # shares, not millions
        'totalDebt':        total_debt,
        'totalCash':        total_cash,
        'netDebt':          net_debt_abs,
        'ebitda':           _f('ebitda'),
        'revenueGrowth':    _f('revenueGrowth'),       # decimal YoY
        'beta':             _f('beta'),
    }

    return {
        'ticker': ticker.upper(),
        'name': info.get('longName') or info.get('shortName') or ticker.upper(),
        'price': round(price, 4),
        'change': round(change, 4),
        'changePercent': round(change_pct, 4),
        'volume': int(last['Volume']) if not pd.isna(last['Volume']) else 0,
        'marketCap': market_cap_str,
        'marketCapValue': _f('marketCap'),
        'dayHigh': round(float(last['High']), 4),
        'dayLow': round(float(last['Low']), 4),
        'open': round(float(last['Open']), 4),
        'previousClose': round(prev_close, 4),
        'pe': _f('trailingPE'),
        'yearHigh': _f('fiftyTwoWeekHigh'),
        'yearLow': _f('fiftyTwoWeekLow'),
        'avgVolume': _i('averageVolume'),
        'lastUpdated': str(hist.index[-1]),
        'fundamentals': fundamentals,
    }


def _format_market_cap(value: float) -> str:
    """Format market cap as $1.23T / $45.6B / $123M / $45K."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return "—"
    abs_v = abs(v)
    if abs_v >= 1e12:
        return f"${v / 1e12:.2f}T"
    if abs_v >= 1e9:
        return f"${v / 1e9:.2f}B"
    if abs_v >= 1e6:
        return f"${v / 1e6:.2f}M"
    if abs_v >= 1e3:
        return f"${v / 1e3:.2f}K"
    return f"${v:.2f}"


def detect_mispricing(ticker: str) -> Dict:
    """
    Detect IV vs HV mispricing for any ticker.
    Generalized version of detect_mispricing_cifr().
    """
    # Pull a 5d window so we get spot + prev close in one yfinance call.
    # Falls back to today's open if we only have a single bar (first listing
    # day, holiday-adjacent windows). Mirrors get_ticker_detail's logic.
    stock = yf.Ticker(ticker)
    hist = stock.history(period="5d")
    if hist.empty:
        raise ValueError(f"Unable to fetch price for {ticker}")
    last = hist.iloc[-1]
    spot = float(last['Close'])
    prev_close = float(hist['Close'].iloc[-2]) if len(hist) >= 2 else float(last['Open'])
    change = spot - prev_close
    change_pct = (change / prev_close * 100.0) if prev_close else 0.0

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
        'previous_close': round(prev_close, 4),
        'change': round(change, 4),
        'change_percent': round(change_pct, 4),
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


def get_price_history(ticker: str, period: str = "1M", interval: str = "1D") -> dict:
    """
    Get OHLCV price history for any ticker.

    Args:
        ticker: Stock symbol
        period: 1D, 5D, 1W, 1M, 3M, 6M, 1Y, 2Y, 5Y, ALL
        interval: Auto-mapped from period if not specified
    """
    period_map = {
        "1D": "1d", "5D": "5d", "1W": "5d",
        "1M": "1mo", "3M": "3mo", "6M": "6mo",
        "1Y": "1y", "2Y": "2y", "5Y": "5y", "ALL": "max",
    }
    interval_map = {
        "1D": "5m", "5D": "30m", "1W": "30m",
        "1M": "1d", "3M": "1d", "6M": "1d",
        "1Y": "1d", "2Y": "1wk", "5Y": "1wk", "ALL": "1wk",
    }

    yf_period = period_map.get(period.upper(), "1mo")
    yf_interval = interval_map.get(period.upper(), "1d")

    stock = yf.Ticker(ticker)
    data = stock.history(period=yf_period, interval=yf_interval)

    if data.empty:
        raise ValueError(f"No price history for {ticker}")

    records = []
    for idx, row in data.iterrows():
        ts_ns = idx.value if hasattr(idx, "value") else int(pd.Timestamp(idx).value)
        timestamp_ms = int(ts_ns // 1_000_000)
        date_iso = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
        records.append({
            "timestamp": timestamp_ms,
            "date": date_iso,
            "open": round(float(row["Open"]), 4),
            "high": round(float(row["High"]), 4),
            "low": round(float(row["Low"]), 4),
            "close": round(float(row["Close"]), 4),
            "volume": int(row["Volume"]) if not pd.isna(row["Volume"]) else 0,
        })

    return {
        "ticker": ticker,
        "period": period.upper(),
        "interval": yf_interval,
        "data": records,
    }


def detect_mispricing_alpaca(ticker: str) -> Dict:
    """
    Detect IV vs HV mispricing using Alpaca's real-time options data.
    
    More accurate than Yahoo Finance version - uses live greeks and IV.
    """
    from execution.alpaca_client import get_options_chain_snapshot
    
    # Get spot price from Yahoo (still free and reliable)
    spot = get_ticker_price(ticker)
    
    # Get historical volatility
    hv = get_historical_volatility(ticker, window=30)
    
    # Get Alpaca options chain snapshot
    chain_data = get_options_chain_snapshot(ticker, option_type='call')
    
    if 'error' in chain_data:
        raise ValueError(f"Alpaca options data unavailable: {chain_data.get('error')}")
    
    snapshots = chain_data.get('snapshots', {})
    if not snapshots:
        raise ValueError(f"No options data for {ticker}")
    
    # Find ATM call with IV data
    best_atm = None
    min_distance = float('inf')
    
    for symbol, data in snapshots.items():
        # Extract strike from OCC symbol (e.g., CIFR260220C00017000 -> $17.00)
        try:
            strike_str = symbol[-8:]  # Last 8 chars = strike price in cents
            strike = float(strike_str) / 1000.0
        except:
            continue
            
        if 'impliedVolatility' not in data or data['impliedVolatility'] is None:
            continue
            
        distance = abs(strike - spot)
        if distance < min_distance:
            min_distance = distance
            best_atm = {
                'symbol': symbol,
                'strike': strike,
                'iv': data['impliedVolatility'],
                'greeks': data.get('greeks', {}),
                'quote': data.get('latestQuote', {}),
            }
    
    if not best_atm:
        raise ValueError(f"No ATM options with IV data found for {ticker}")
    
    iv = best_atm['iv']
    iv_hv_ratio = iv / hv if hv > 0 else 0
    
    if iv_hv_ratio > 1.3:
        signal = "SELL"
    elif iv_hv_ratio < 0.8:
        signal = "BUY"
    else:
        signal = "NEUTRAL"
    
    quote = best_atm['quote']
    bid = quote.get('bp', 0)
    ask = quote.get('ap', 0)
    mid = (bid + ask) / 2 if bid > 0 and ask > 0 else 0
    
    # Extract expiration from symbol (e.g., CIFR260220C00017000 -> 2026-02-20)
    symbol = best_atm['symbol']
    exp_year = 2000 + int(symbol[4:6])
    exp_month = int(symbol[6:8])
    exp_day = int(symbol[8:10])
    expiration = f"{exp_year}-{exp_month:02d}-{exp_day:02d}"
    
    return {
        'ticker': ticker,
        'spot_price': float(spot),
        'historical_vol': float(hv),
        'implied_vol_atm': float(iv),
        'iv_hv_ratio': float(iv_hv_ratio),
        'signal': signal,
        'expiration': expiration,
        'atm_strike': best_atm['strike'],
        'atm_call_price': mid,
        'bid': bid,
        'ask': ask,
        'greeks': best_atm['greeks'],
        'occ_symbol': symbol,
        'data_source': 'alpaca',
    }
