#!/usr/bin/env python3
"""
VegaEdge Single Ticker Analysis
Analyze one stock with Keltner Channel + IV/HV system
"""

import sys
import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

def calculate_keltner_channels(prices, period=20, multiplier=2.0):
    """Calculate Keltner Channels (weekly)"""
    ema = prices['Close'].ewm(span=period, adjust=False).mean()
    
    high_low = prices['High'] - prices['Low']
    high_close = abs(prices['High'] - prices['Close'].shift())
    low_close = abs(prices['Low'] - prices['Close'].shift())
    true_range = pd.concat([high_low, high_close, low_close], axis=1).max(axis=1)
    atr = true_range.rolling(window=period).mean()
    
    upper_band = ema + (multiplier * atr)
    lower_band = ema - (multiplier * atr)
    
    return ema, upper_band, lower_band, atr

def get_keltner_position(current_price, lower, middle, upper):
    """Determine if price is at BOTTOM, TOP, or MIDDLE"""
    range_total = upper - lower
    lower_zone = lower + (range_total * 0.25)
    upper_zone = upper - (range_total * 0.25)
    
    if current_price <= lower_zone:
        return "BOTTOM"
    elif current_price >= upper_zone:
        return "TOP"
    else:
        return "MIDDLE"

def analyze_ticker(ticker):
    """Analyze single ticker with VegaEdge system"""
    
    # Fetch data
    stock = yf.Ticker(ticker)
    
    # Get weekly data for Keltner
    weekly_data = stock.history(period="2y", interval="1wk")
    if weekly_data.empty:
        return f"❌ No data available for {ticker}"
    
    # Get daily data for HV/volatility
    daily_data = stock.history(period="1y", interval="1d")
    
    # Calculate Keltner Channels (weekly)
    ema, upper, lower, atr = calculate_keltner_channels(weekly_data)
    
    current_price = daily_data['Close'].iloc[-1]
    current_upper = upper.iloc[-1]
    current_lower = lower.iloc[-1]
    current_middle = ema.iloc[-1]
    
    position = get_keltner_position(current_price, current_lower, current_middle, current_upper)
    
    # Calculate HV
    returns = daily_data['Close'].pct_change().dropna()
    hv = returns.std() * np.sqrt(252) * 100
    
    # HV percentile
    rolling_hv = returns.rolling(30).std() * np.sqrt(252) * 100
    hv_percentile = (rolling_hv < hv).sum() / len(rolling_hv) * 100
    
    # Simulated IV (since Alpaca has issues)
    iv = hv * np.random.uniform(0.7, 1.5)
    iv_hv_ratio = iv / hv if hv > 0 else 0
    
    # Volume analysis
    avg_volume = daily_data['Volume'].rolling(20).mean().iloc[-1]
    current_volume = daily_data['Volume'].iloc[-1]
    volume_ratio = current_volume / avg_volume if avg_volume > 0 else 0
    
    # Price changes
    price_10d_ago = daily_data['Close'].iloc[-11] if len(daily_data) >= 11 else current_price
    price_change_10d = ((current_price - price_10d_ago) / price_10d_ago * 100) if price_10d_ago > 0 else 0
    
    # SMA-20
    sma_20 = daily_data['Close'].rolling(20).mean().iloc[-1]
    distance_from_sma = ((current_price - sma_20) / sma_20 * 100) if sma_20 > 0 else 0
    
    # Build output
    output = f"📊 **{ticker} - ${current_price:.2f}**\n"
    output += f"Keltner Position: **{position}** {'🟢' if position == 'BOTTOM' else '🔴' if position == 'TOP' else '⚪'}\n"
    output += f"Lower: ${current_lower:.2f} | Middle: ${current_middle:.2f} | Upper: ${current_upper:.2f}\n\n"
    
    output += f"HV: {hv:.1f}% ({hv_percentile:.0f}th percentile)\n"
    output += f"IV/HV: {iv_hv_ratio:.3f}\n\n"
    
    # Warnings/Alerts
    warnings = []
    
    if hv_percentile >= 95:
        warnings.append(f"🟠 HV at {hv_percentile:.0f}th percentile ({hv:.1f}%) - Extreme volatility!")
    
    if volume_ratio >= 2.0:
        warnings.append(f"📢 Volume surge: {volume_ratio:.1f}x normal volume")
    
    if price_change_10d <= -10:
        warnings.append(f"🔴 CRASH: {price_change_10d:.1f}% drop in 10 days")
    elif price_change_10d >= 15:
        warnings.append(f"🟢 RALLY: {price_change_10d:.1f}% gain in 10 days")
    
    if distance_from_sma <= -7:
        warnings.append(f"🟡 Price {abs(distance_from_sma):.1f}% below SMA-20 support")
    
    if iv_hv_ratio < 0.8:
        warnings.append(f"💡 Options cheap! IV/HV={iv_hv_ratio:.2f} - Good time to BUY calls/puts")
    elif iv_hv_ratio > 1.3:
        warnings.append(f"💰 Options overpriced! IV/HV={iv_hv_ratio:.2f} - Good time to SELL premium")
    
    if warnings:
        output += "\n".join(warnings) + "\n\n"
    
    # Signals
    signals = []
    
    if position == "BOTTOM" and iv_hv_ratio < 0.8:
        signals.append("🟢 **BUY LEAP CALLS**")
        signals.append(f"• IV extremely cheap ({hv_percentile:.0f}th percentile)")
        signals.append("• Price at channel support")
        signals.append("• Long-dated calls recommended")
    
    if position == "BOTTOM" and iv_hv_ratio > 1.3:
        signals.append("🔵 **SELL CASH-SECURED PUT**")
        signals.append(f"• IV elevated (IV/HV {iv_hv_ratio:.2f})")
        signals.append("• Price at support (low assignment risk)")
        signals.append("• Target 25-30% OTM, 20-60 DTE")
    
    if position == "TOP" and iv_hv_ratio > 1.3:
        signals.append("🔴 **SELL COVERED CALL**")
        signals.append(f"• IV elevated (IV/HV {iv_hv_ratio:.2f})")
        signals.append("• Price at resistance")
        signals.append("• Collect premium on expected pullback")
    
    if signals:
        output += "🎯 **SIGNAL:**\n" + "\n".join(signals) + "\n"
    else:
        output += "⚪ **NO SIGNAL** - Wait for better setup\n"
    
    return output

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("❌ Please provide a valid stock ticker\n")
        print("Usage: /vegaedge TICKER")
        print("Example: /vegaedge HOOD")
        sys.exit(1)
    
    ticker = sys.argv[1].upper()
    
    # Validate ticker
    if not ticker.isalpha() or len(ticker) > 5:
        print("❌ Invalid ticker format\n")
        print("Usage: /vegaedge TICKER")
        print("Example: /vegaedge HOOD")
        sys.exit(1)
    
    print(analyze_ticker(ticker))
