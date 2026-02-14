#!/usr/bin/env python3
"""
VegaEdge Daily Alerts Script v2 - With Keltner Channel Integration
Checks for crash warnings, IV/HV mispricing, AND technical signals (Keltner)
"""

import sys
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import yfinance as yf

# Add lib to path
sys.path.append('/home/ubuntu/.openclaw/workspace/trading-dashboard-app')
from lib.keltner_channel import calculate_keltner_channel
from lib.channel_signals import should_sell_put, should_sell_call, should_buy_leaps, get_leap_pricing, format_signal_alert


def check_ticker_alerts(ticker):
    """Check all alert conditions for a ticker (existing VegaEdge logic)"""
    
    alerts = []
    
    try:
        stock = yf.Ticker(ticker)
        hist = stock.history(period="3mo")
        
        if hist.empty:
            return None
        
        # Calculate indicators
        hist['returns'] = hist['Close'].pct_change()
        hist['HV'] = hist['returns'].rolling(window=30).std() * np.sqrt(252)
        hist['Volume_MA'] = hist['Volume'].rolling(window=20).mean()
        hist['SMA_20'] = hist['Close'].rolling(window=20).mean()
        hist['SMA_50'] = hist['Close'].rolling(window=50).mean()
        hist['Price_Change_10d'] = hist['Close'].pct_change(periods=10) * 100
        
        # Current values
        current = hist.iloc[-1]
        current_price = current['Close']
        current_hv = current['HV']
        
        # Calculate HV percentile
        hv_60d = hist['HV'].tail(60)
        if len(hv_60d) > 0 and hv_60d.max() > hv_60d.min():
            hv_percentile = (current_hv - hv_60d.min()) / (hv_60d.max() - hv_60d.min()) * 100
        else:
            hv_percentile = 50
        
        # Alert 1: Extreme Volatility
        if hv_percentile >= 90:
            alerts.append({
                'severity': 'HIGH' if hv_percentile >= 95 else 'MEDIUM',
                'type': 'VOLATILITY_SPIKE',
                'message': f"🟠 HV at {hv_percentile:.0f}th percentile ({current_hv*100:.1f}%) - Extreme volatility!"
            })
        
        # Alert 2: Volume Surge
        volume_surge = (current['Volume'] / current['Volume_MA'] - 1) * 100
        if volume_surge >= 100 and not np.isnan(volume_surge):
            alerts.append({
                'severity': 'MEDIUM',
                'type': 'VOLUME_SURGE',
                'message': f"🟡 Volume {volume_surge:.0f}% above average - Unusual activity!"
            })
        
        # Alert 3: Price Crash
        price_change = current['Price_Change_10d']
        if price_change <= -15 and not np.isnan(price_change):
            alerts.append({
                'severity': 'CRITICAL',
                'type': 'PRICE_CRASH',
                'message': f"🔴 CRASH: {price_change:.1f}% drop in 10 days!"
            })
        elif price_change <= -10 and not np.isnan(price_change):
            alerts.append({
                'severity': 'HIGH',
                'type': 'PRICE_DROP',
                'message': f"🟠 Sharp drop: {price_change:.1f}% in 10 days"
            })
        
        # Alert 4: Support Break
        if not np.isnan(current['SMA_20']) and current_price < current['SMA_20'] * 0.95:
            drop_pct = ((current_price / current['SMA_20']) - 1) * 100
            alerts.append({
                'severity': 'MEDIUM',
                'type': 'SUPPORT_BREAK',
                'message': f"🟡 Price {drop_pct:.1f}% below SMA-20 support"
            })
        
        # Get IV from options (simplified - just check if options exist)
        try:
            options = stock.options
            if len(options) > 0:
                # Get nearest expiration
                opt_chain = stock.option_chain(options[0])
                calls = opt_chain.calls
                
                # Find ATM option
                atm_idx = (calls['strike'] - current_price).abs().idxmin()
                iv = calls.loc[atm_idx, 'impliedVolatility'] if 'impliedVolatility' in calls.columns else None
                
                if iv and iv > 0 and current_hv > 0:
                    iv_hv_ratio = iv / current_hv
                    
                    # Calculate IV percentile based on IV/HV ratio
                    # If IV/HV < 0.8, it's in bottom 20% (cheap)
                    # If IV/HV > 1.5, it's in top 20% (expensive)
                    if iv_hv_ratio < 0.6:
                        iv_percentile = 5  # Very cheap
                    elif iv_hv_ratio < 0.8:
                        iv_percentile = 15  # Cheap (LEAP territory)
                    elif iv_hv_ratio < 1.0:
                        iv_percentile = 40  # Below average
                    elif iv_hv_ratio < 1.3:
                        iv_percentile = 60  # Average
                    elif iv_hv_ratio < 1.5:
                        iv_percentile = 75  # Elevated
                    else:
                        iv_percentile = 90  # Very expensive
                    
                    # Alert: IV/HV warnings
                    if iv_hv_ratio < 1.0:
                        alerts.append({
                            'severity': 'INFO',
                            'type': 'IV_CHEAP',
                            'message': f"💡 Options cheap! IV/HV={iv_hv_ratio:.2f} - Good time to BUY calls/puts"
                        })
                    elif iv_hv_ratio > 1.5:
                        alerts.append({
                            'severity': 'INFO',
                            'type': 'IV_EXPENSIVE',
                            'message': f"💰 Options overpriced! IV/HV={iv_hv_ratio:.2f} - Good time to SELL premium"
                        })
                    
                    iv_data = {
                        'iv_hv_ratio': iv_hv_ratio,
                        'iv_percentile': iv_percentile
                    }
                else:
                    iv_data = None
            else:
                iv_data = None
                
        except Exception:
            iv_data = None
        
        return {
            'ticker': ticker,
            'price': current_price,
            'hv': current_hv,
            'hv_percentile': hv_percentile,
            'alerts': alerts,
            'iv_data': iv_data
        }
        
    except Exception as e:
        print(f"Error checking {ticker}: {e}")
        return None


def check_keltner_signals(ticker, iv_data):
    """
    Check for Keltner Channel + IV signals
    Returns list of actionable signals: SELL_PUT, SELL_CALL, BUY_LEAP
    """
    signals = []
    
    try:
        # Get Keltner Channel data
        keltner = calculate_keltner_channel(ticker)
        
        if not iv_data:
            # No IV data, can't generate signals
            return signals
        
        iv_hv_ratio = iv_data['iv_hv_ratio']
        iv_percentile = iv_data['iv_percentile']
        
        # Check for Sell Put signal
        should_put, put_reason = should_sell_put(keltner['position'], iv_hv_ratio, iv_percentile)
        if should_put:
            signals.append({
                'type': 'SELL_PUT',
                'ticker': ticker,
                'keltner': keltner,
                'iv_data': iv_data,
                'reason': put_reason
            })
        
        # Check for Sell Call signal (assume no shares - user will need to verify)
        should_call, call_reason = should_sell_call(keltner['position'], iv_hv_ratio, iv_percentile, has_shares=False)
        if should_call:
            signals.append({
                'type': 'SELL_CALL',
                'ticker': ticker,
                'keltner': keltner,
                'iv_data': iv_data,
                'reason': call_reason
            })
        
        # Check for Buy LEAP signal
        should_leap, leap_reason, discount = should_buy_leaps(iv_hv_ratio, iv_percentile, keltner['position'])
        if should_leap:
            leap_data = get_leap_pricing(ticker, keltner['current_price'], [1.5, 2.0])
            signals.append({
                'type': 'BUY_LEAP',
                'ticker': ticker,
                'keltner': keltner,
                'iv_data': iv_data,
                'reason': leap_reason,
                'discount': discount,
                'leap_data': leap_data
            })
        
    except Exception as e:
        print(f"Keltner check failed for {ticker}: {e}")
    
    return signals


def format_alerts_message(tickers=['HOOD', 'CIFR', 'WULF', 'PYPL', 'GRAB']):
    """Generate full alert message for all tickers"""
    
    all_results = []
    all_keltner_signals = []
    
    for ticker in tickers:
        result = check_ticker_alerts(ticker)
        if result and result['alerts']:
            all_results.append(result)
        
        # Check Keltner signals
        if result and result['iv_data']:
            keltner_sigs = check_keltner_signals(ticker, result['iv_data'])
            all_keltner_signals.extend(keltner_sigs)
    
    # Build message
    total_warnings = sum(len(r['alerts']) for r in all_results)
    total_signals = len(all_keltner_signals)
    
    msg = []
    msg.append(f"🚨 VEGAEDGE ALERT - {datetime.now().strftime('%Y-%m-%d')}")
    msg.append("")
    
    if total_warnings > 0:
        msg.append(f"**{total_warnings} Warning(s) Detected!**")
    if total_signals > 0:
        msg.append(f"**{total_signals} Actionable Signal(s)!**")
    
    msg.append("=" * 40)
    msg.append("")
    
    # Standard alerts
    for result in all_results:
        msg.append(f"📊 **{result['ticker']} - ${result['price']:.2f}**")
        msg.append(f"HV: {result['hv']*100:.1f}% ({result['hv_percentile']:.0f}th percentile)")
        
        if result['iv_data']:
            msg.append(f"IV/HV: {result['iv_data']['iv_hv_ratio']:.3f}")
        
        msg.append("")
        
        for alert in result['alerts']:
            msg.append(alert['message'])
        
        msg.append("")
        msg.append("-" * 40)
        msg.append("")
    
    # Keltner Channel Signals
    if all_keltner_signals:
        msg.append("")
        msg.append("🎯 **ACTIONABLE SIGNALS:**")
        msg.append("=" * 40)
        msg.append("")
        
        for signal in all_keltner_signals:
            if signal['type'] == 'SELL_PUT':
                formatted = format_signal_alert('SELL_PUT', signal['ticker'], signal['keltner'], signal['iv_data'])
            elif signal['type'] == 'SELL_CALL':
                formatted = format_signal_alert('SELL_CALL', signal['ticker'], signal['keltner'], signal['iv_data'])
            elif signal['type'] == 'BUY_LEAP':
                formatted = format_signal_alert('BUY_LEAP', signal['ticker'], signal['keltner'], signal['iv_data'], signal['leap_data'], signal['discount'])
            
            msg.append(formatted)
            msg.append("")
            msg.append("-" * 40)
            msg.append("")
    
    if total_warnings == 0 and total_signals == 0:
        msg.append("✅ **No alerts or signals detected**")
        msg.append("")
        msg.append("All stocks within normal ranges")
    else:
        msg.append("")
        msg.append("💡 **TIP: Review signals and consider action!**")
    
    msg.append("")
    msg.append("🤖 VegaEdge Auto-Monitor (Keltner + IV)")
    
    return "\n".join(msg)


if __name__ == '__main__':
    print(f"\n🔍 VegaEdge Daily Alert Check (Keltner Enhanced) - {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 80)
    print()
    
    tickers = ['HOOD', 'CIFR', 'WULF', 'PYPL', 'GRAB']
    
    for ticker in tickers:
        print(f"Checking {ticker}...")
        result = check_ticker_alerts(ticker)
        if result:
            print(f"  ⚠️  {len(result['alerts'])} alert(s) found")
            if result['iv_data']:
                sigs = check_keltner_signals(ticker, result['iv_data'])
                if sigs:
                    print(f"  🎯  {len(sigs)} Keltner signal(s) found")
        else:
            print(f"  ✅  No data/alerts")
    
    print()
    print("=" * 80)
    print("📱 WhatsApp Message:")
    print("=" * 80)
    
    message = format_alerts_message(tickers)
    
    print()
    print("__MESSAGE_START__")
    print(message)
    print("__MESSAGE_END__")
