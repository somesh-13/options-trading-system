#!/usr/bin/env python3
"""
5-Year Backtest: Keltner Channel + VegaEdge Strategy on HOOD
Tests LEAP buying, CSP selling, and covered call signals
"""

import pandas as pd
import numpy as np
from datetime import datetime, timedelta
import yfinance as yf
import sys

sys.path.append('/home/ubuntu/.openclaw/workspace/trading-dashboard-app')
from lib.keltner_channel import calculate_ema, calculate_atr


def backtest_keltner_strategy(symbol='HOOD', years=5):
    """
    Backtest Keltner + IV strategy
    
    Signals tested:
    1. BUY LEAP at bottom when IV cheap (IV/HV < 0.8)
    2. SELL CSP at bottom when IV spike (IV/HV > 1.3)
    3. SELL Covered Call at top when IV spike (IV/HV > 1.3)
    """
    
    print(f"\n{'='*80}")
    print(f"🔍 {symbol} - {years}-Year Keltner Channel + VegaEdge Backtest")
    print(f"{'='*80}\n")
    
    # Fetch data
    print(f"📥 Fetching {years} years of weekly data...")
    ticker = yf.Ticker(symbol)
    end_date = datetime.now()
    start_date = end_date - timedelta(days=365 * years)
    
    # Get weekly data
    hist = ticker.history(start=start_date, end=end_date, interval="1wk")
    
    if hist.empty:
        print(f"❌ No data available for {symbol}")
        return
    
    print(f"✅ Loaded {len(hist)} weeks of data ({hist.index[0].date()} to {hist.index[-1].date()})")
    
    # Calculate indicators
    print(f"\n📊 Calculating Keltner Channel (EMA-20, ATR-20)...")
    hist['returns'] = hist['Close'].pct_change()
    hist['HV'] = hist['returns'].rolling(window=20).std() * np.sqrt(52)  # Annualized weekly HV
    
    # Keltner Channel
    hist['EMA_20'] = calculate_ema(hist['Close'], period=20)
    hist['ATR_20'] = calculate_atr(hist['High'], hist['Low'], hist['Close'], period=20)
    hist['Upper_Band'] = hist['EMA_20'] + (2.0 * hist['ATR_20'])
    hist['Lower_Band'] = hist['EMA_20'] - (2.0 * hist['ATR_20'])
    hist['Band_Width'] = hist['Upper_Band'] - hist['Lower_Band']
    
    # Position detection (5% threshold)
    threshold = 0.05
    hist['Bottom_Zone'] = hist['Lower_Band'] + (hist['Band_Width'] * threshold)
    hist['Top_Zone'] = hist['Upper_Band'] - (hist['Band_Width'] * threshold)
    
    hist['Position'] = 'MIDDLE'
    hist.loc[hist['Close'] <= hist['Bottom_Zone'], 'Position'] = 'BOTTOM'
    hist.loc[hist['Close'] >= hist['Top_Zone'], 'Position'] = 'TOP'
    
    # Simulate IV/HV ratio (real IV data unavailable)
    # When HV spikes (market crashes), IV tends to spike even more (IV/HV > 1.3)
    # When HV is normal or low, IV tends to compress (IV/HV < 1.0)
    hist['HV_Percentile'] = hist['HV'].rolling(window=52).apply(
        lambda x: (x.iloc[-1] - x.min()) / (x.max() - x.min()) * 100 if x.max() > x.min() else 50
    )
    
    # Simulate IV/HV ratio based on HV percentile
    # High HV usually means high IV, creating IV spike
    # Low HV usually means low IV, creating cheap options
    def simulate_iv_hv(hv_pct):
        if pd.isna(hv_pct):
            return 1.0
        if hv_pct > 90:  # Extreme volatility -> IV spike
            return np.random.uniform(1.3, 2.0)
        elif hv_pct > 70:  # High volatility -> elevated IV
            return np.random.uniform(1.1, 1.4)
        elif hv_pct < 30:  # Low volatility -> cheap IV
            return np.random.uniform(0.6, 0.9)
        else:  # Normal volatility
            return np.random.uniform(0.9, 1.2)
    
    hist['IV_HV_Ratio'] = hist['HV_Percentile'].apply(simulate_iv_hv)
    hist['IV_Percentile'] = hist['IV_HV_Ratio'].apply(
        lambda x: 5 if x < 0.6 else 15 if x < 0.8 else 40 if x < 1.0 else 60 if x < 1.3 else 90
    )
    
    # Track signals
    signals = []
    
    for i in range(20, len(hist)):  # Start after indicators are calculated
        row = hist.iloc[i]
        date = hist.index[i]
        
        position = row['Position']
        iv_hv = row['IV_HV_Ratio']
        iv_pct = row['IV_Percentile']
        price = row['Close']
        hv = row['HV']
        hv_pct = row['HV_Percentile']
        
        # Signal 1: BUY LEAP (bottom + IV cheap)
        if position == 'BOTTOM' and iv_hv < 0.8 and iv_pct < 20:
            discount = 0.20 if iv_hv < 0.6 else 0.15 if iv_hv < 0.7 else 0.10
            discount += 0.05  # Extra for being at bottom
            
            signals.append({
                'Date': date,
                'Type': 'BUY_LEAP',
                'Price': price,
                'Position': position,
                'IV_HV': iv_hv,
                'IV_Pct': iv_pct,
                'HV': hv * 100,
                'HV_Pct': hv_pct,
                'Discount': discount * 100,
                'Lower_Band': row['Lower_Band'],
                'Upper_Band': row['Upper_Band']
            })
        
        # Signal 2: SELL CSP (bottom + IV spike)
        if position == 'BOTTOM' and (iv_hv > 1.3 or iv_pct > 80):
            signals.append({
                'Date': date,
                'Type': 'SELL_CSP',
                'Price': price,
                'Position': position,
                'IV_HV': iv_hv,
                'IV_Pct': iv_pct,
                'HV': hv * 100,
                'HV_Pct': hv_pct,
                'Discount': 0,
                'Lower_Band': row['Lower_Band'],
                'Upper_Band': row['Upper_Band']
            })
        
        # Signal 3: SELL Covered Call (top + IV spike)
        if position == 'TOP' and (iv_hv > 1.3 or iv_pct > 80):
            signals.append({
                'Date': date,
                'Type': 'SELL_CALL',
                'Price': price,
                'Position': position,
                'IV_HV': iv_hv,
                'IV_Pct': iv_pct,
                'HV': hv * 100,
                'HV_Pct': hv_pct,
                'Discount': 0,
                'Lower_Band': row['Lower_Band'],
                'Upper_Band': row['Upper_Band']
            })
    
    # Convert to DataFrame
    signals_df = pd.DataFrame(signals)
    
    # Results
    print(f"\n{'='*80}")
    print(f"📈 BACKTEST RESULTS - {symbol} ({years} years)")
    print(f"{'='*80}\n")
    
    print(f"**Data Period:** {hist.index[0].date()} to {hist.index[-1].date()}")
    print(f"**Total Weeks:** {len(hist)}")
    print(f"**Price Range:** ${hist['Close'].min():.2f} - ${hist['Close'].max():.2f}")
    print(f"**Current Price:** ${hist['Close'].iloc[-1]:.2f}")
    
    print(f"\n{'='*80}")
    print(f"🎯 SIGNAL SUMMARY")
    print(f"{'='*80}\n")
    
    if len(signals_df) == 0:
        print("❌ No signals generated in backtest period")
        return
    
    # Count by type
    signal_counts = signals_df['Type'].value_counts()
    total_signals = len(signals_df)
    
    print(f"**Total Signals:** {total_signals}")
    print(f"")
    for sig_type, count in signal_counts.items():
        pct = (count / total_signals) * 100
        emoji = "🟢" if sig_type == "BUY_LEAP" else "🔵" if sig_type == "SELL_CSP" else "🔴"
        print(f"{emoji} **{sig_type}:** {count} ({pct:.1f}%)")
    
    print(f"\n{'='*80}")
    print(f"📊 SIGNAL BREAKDOWN")
    print(f"{'='*80}\n")
    
    # BUY LEAP signals
    leap_signals = signals_df[signals_df['Type'] == 'BUY_LEAP']
    if len(leap_signals) > 0:
        print(f"🟢 **BUY LEAP SIGNALS:** {len(leap_signals)}")
        print(f"   Average Price: ${leap_signals['Price'].mean():.2f}")
        print(f"   Avg IV/HV: {leap_signals['IV_HV'].mean():.2f}")
        print(f"   Avg Discount: {leap_signals['Discount'].mean():.1f}%")
        print(f"   Date Range: {leap_signals['Date'].min().date()} to {leap_signals['Date'].max().date()}")
        print(f"")
    
    # SELL CSP signals
    csp_signals = signals_df[signals_df['Type'] == 'SELL_CSP']
    if len(csp_signals) > 0:
        print(f"🔵 **SELL CSP SIGNALS:** {len(csp_signals)}")
        print(f"   Average Price: ${csp_signals['Price'].mean():.2f}")
        print(f"   Avg IV/HV: {csp_signals['IV_HV'].mean():.2f}")
        print(f"   Date Range: {csp_signals['Date'].min().date()} to {csp_signals['Date'].max().date()}")
        print(f"")
    
    # SELL Call signals
    call_signals = signals_df[signals_df['Type'] == 'SELL_CALL']
    if len(call_signals) > 0:
        print(f"🔴 **SELL CALL SIGNALS:** {len(call_signals)}")
        print(f"   Average Price: ${call_signals['Price'].mean():.2f}")
        print(f"   Avg IV/HV: {call_signals['IV_HV'].mean():.2f}")
        print(f"   Date Range: {call_signals['Date'].min().date()} to {call_signals['Date'].max().date()}")
        print(f"")
    
    print(f"{'='*80}")
    print(f"💡 KEY INSIGHTS")
    print(f"{'='*80}\n")
    
    # Frequency
    weeks_per_signal = len(hist) / total_signals if total_signals > 0 else 0
    print(f"**Signal Frequency:** 1 signal every {weeks_per_signal:.1f} weeks (~{52/weeks_per_signal:.1f} per year)")
    
    # Keltner position stats
    position_counts = hist['Position'].value_counts()
    print(f"\n**Keltner Position Distribution:**")
    for pos, count in position_counts.items():
        pct = (count / len(hist)) * 100
        emoji = "🟢" if pos == "BOTTOM" else "🔴" if pos == "TOP" else "⚪"
        print(f"   {emoji} {pos}: {count} weeks ({pct:.1f}%)")
    
    # Recent signals (last 6 months)
    recent_cutoff = hist.index[-1] - timedelta(days=180)
    recent_signals = signals_df[signals_df['Date'] >= recent_cutoff]
    
    print(f"\n**Recent Activity (Last 6 months):**")
    print(f"   Signals: {len(recent_signals)}")
    if len(recent_signals) > 0:
        for _, sig in recent_signals.iterrows():
            emoji = "🟢" if sig['Type'] == "BUY_LEAP" else "🔵" if sig['Type'] == "SELL_CSP" else "🔴"
            print(f"   {emoji} {sig['Date'].date()}: {sig['Type']} at ${sig['Price']:.2f} (IV/HV={sig['IV_HV']:.2f})")
    
    print(f"\n{'='*80}")
    print(f"✅ BACKTEST COMPLETE")
    print(f"{'='*80}\n")
    
    # Save detailed results
    output_file = f'/home/ubuntu/.openclaw/workspace/trading-dashboard-app/backtest_results_{symbol}_{years}yr.csv'
    signals_df.to_csv(output_file, index=False)
    print(f"📁 Detailed results saved to: {output_file}")
    
    return signals_df, hist


if __name__ == '__main__':
    symbol = 'HOOD'
    years = 5
    
    if len(sys.argv) > 1:
        symbol = sys.argv[1].upper()
    if len(sys.argv) > 2:
        years = int(sys.argv[2])
    
    signals_df, hist = backtest_keltner_strategy(symbol, years)
