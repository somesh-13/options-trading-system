#!/usr/bin/env python3
"""
Weekly Backtest Comparison: VegaEdge vs Keltner vs Combined

Tests 3 strategies on weekly data:
1. VegaEdge Only: Pure IV/HV signals (buy/sell based on ratio)
2. Keltner Only: Buy LEAPs at bottom, sell calls at top, sell puts at bottom
3. Keltner + VegaEdge: Combined signals (Keltner position + IV/HV confirmation)

Timeframe: Weekly bars (1 candle = 1 week)
Period: 2021-2026 (5 years)
"""

import pandas as pd
import numpy as np
import yfinance as yf
from datetime import datetime, timedelta
import sys
from pathlib import Path

# Add backend to path
sys.path.append(str(Path(__file__).parent / 'backend' / 'src'))


def calculate_hv(returns, window=20):
    """Calculate historical volatility (annualized) for weekly data."""
    return returns.rolling(window=window).std() * np.sqrt(52)


def simulate_iv_hv_ratio(hv_percentile):
    """Simulate IV/HV ratio based on HV percentile."""
    if pd.isna(hv_percentile):
        return 1.0
    
    noise = np.random.uniform(-0.1, 0.1)
    
    if hv_percentile > 90:
        return np.random.uniform(1.2, 1.8) + noise
    elif hv_percentile > 70:
        return np.random.uniform(1.0, 1.4) + noise
    elif hv_percentile < 30:
        return np.random.uniform(0.6, 0.9) + noise
    else:
        return np.random.uniform(0.9, 1.2) + noise


def calculate_keltner_channel(df, ema_period=20, atr_period=20, multiplier=2.0):
    """Add Keltner Channel indicators to DataFrame."""
    
    # Calculate EMA
    df['ema_20'] = df['close'].ewm(span=ema_period, adjust=False).mean()
    
    # Calculate True Range
    df['prev_close'] = df['close'].shift(1)
    df['tr1'] = df['high'] - df['low']
    df['tr2'] = abs(df['high'] - df['prev_close'])
    df['tr3'] = abs(df['low'] - df['prev_close'])
    df['true_range'] = df[['tr1', 'tr2', 'tr3']].max(axis=1)
    
    # Calculate ATR
    df['atr_20'] = df['true_range'].ewm(span=atr_period, adjust=False).mean()
    
    # Calculate bands
    df['upper_band'] = df['ema_20'] + (multiplier * df['atr_20'])
    df['lower_band'] = df['ema_20'] - (multiplier * df['atr_20'])
    
    # Determine position (5% threshold)
    threshold = 0.05
    df['band_width'] = df['upper_band'] - df['lower_band']
    df['bottom_zone'] = df['lower_band'] + (df['band_width'] * threshold)
    df['top_zone'] = df['upper_band'] - (df['band_width'] * threshold)
    
    df['keltner_position'] = 'MIDDLE'
    df.loc[df['close'] <= df['bottom_zone'], 'keltner_position'] = 'BOTTOM'
    df.loc[df['close'] >= df['top_zone'], 'keltner_position'] = 'TOP'
    
    # Cleanup
    df.drop(['prev_close', 'tr1', 'tr2', 'tr3', 'true_range', 'band_width', 'bottom_zone', 'top_zone'], 
            axis=1, inplace=True)
    
    return df


def strategy_vegaedge_only(row, position, capital, initial_capital):
    """
    Strategy 1: VegaEdge Only
    Buy when IV/HV < 0.8, Sell when IV/HV > 1.3
    """
    iv_hv = row['iv_hv_ratio']
    
    if position is None:
        # Entry signals
        if iv_hv < 0.8:
            return {
                'action': 'BUY',
                'type': 'BUY_CALL',
                'entry_price': row['close'],
                'reason': f'IV/HV {iv_hv:.2f} < 0.8'
            }
        elif iv_hv > 1.3:
            return {
                'action': 'SELL',
                'type': 'SELL_CALL',
                'entry_price': row['close'],
                'reason': f'IV/HV {iv_hv:.2f} > 1.3'
            }
    else:
        # Exit signals
        days_held = position['weeks_held'] * 7
        price_change_pct = (row['close'] - position['entry_price']) / position['entry_price']
        
        # Time expiry (30 days = ~4 weeks)
        if position['weeks_held'] >= 4:
            return {'action': 'EXIT', 'reason': 'time_expiry'}
        
        # Stop loss (5%)
        if position['type'] == 'SELL_CALL' and price_change_pct > 0.05:
            return {'action': 'EXIT', 'reason': 'stop_loss'}
        if position['type'] == 'BUY_CALL' and price_change_pct < -0.05:
            return {'action': 'EXIT', 'reason': 'stop_loss'}
        
        # IV normalization
        if position['type'] == 'SELL_CALL' and iv_hv < 1.0:
            return {'action': 'EXIT', 'reason': 'iv_normalized'}
        if position['type'] == 'BUY_CALL' and iv_hv > 1.0:
            return {'action': 'EXIT', 'reason': 'iv_normalized'}
    
    return None


def strategy_keltner_only(row, position, capital, initial_capital):
    """
    Strategy 2: Keltner Only
    - BUY LEAP at BOTTOM
    - SELL CALL at TOP
    - SELL PUT at BOTTOM (when no position)
    """
    keltner_pos = row['keltner_position']
    
    if position is None:
        # Entry signals based on Keltner position only
        if keltner_pos == 'BOTTOM':
            # Prefer LEAP over CSP
            return {
                'action': 'BUY',
                'type': 'BUY_LEAP',
                'entry_price': row['close'],
                'reason': f'At Keltner BOTTOM'
            }
        elif keltner_pos == 'TOP':
            return {
                'action': 'SELL',
                'type': 'SELL_CALL',
                'entry_price': row['close'],
                'reason': f'At Keltner TOP'
            }
    else:
        # Exit signals
        price_change_pct = (row['close'] - position['entry_price']) / position['entry_price']
        
        # LEAPs: longer hold (60 days = ~8 weeks)
        if position['type'] == 'BUY_LEAP':
            if position['weeks_held'] >= 8:
                return {'action': 'EXIT', 'reason': 'leap_time_expiry'}
            if price_change_pct < -0.10:
                return {'action': 'EXIT', 'reason': 'leap_stop_loss'}
        else:
            # Calls/Puts: 4 weeks max
            if position['weeks_held'] >= 4:
                return {'action': 'EXIT', 'reason': 'time_expiry'}
            if position['type'] == 'SELL_CALL' and price_change_pct > 0.05:
                return {'action': 'EXIT', 'reason': 'stop_loss'}
            if position['type'] == 'SELL_PUT' and price_change_pct < -0.05:
                return {'action': 'EXIT', 'reason': 'stop_loss'}
    
    return None


def strategy_combined(row, position, capital, initial_capital):
    """
    Strategy 3: Keltner + VegaEdge Combined
    - BUY LEAP: IV/HV < 0.8 AND at BOTTOM
    - SELL CALL: IV/HV > 1.3 AND at TOP
    - SELL PUT: IV/HV > 1.3 AND at BOTTOM
    """
    iv_hv = row['iv_hv_ratio']
    keltner_pos = row['keltner_position']
    
    if position is None:
        # Combined signals
        if iv_hv < 0.8 and keltner_pos == 'BOTTOM':
            return {
                'action': 'BUY',
                'type': 'BUY_LEAP',
                'entry_price': row['close'],
                'reason': f'LEAP: IV/HV {iv_hv:.2f} < 0.8 + BOTTOM'
            }
        elif iv_hv > 1.3 and keltner_pos == 'TOP':
            return {
                'action': 'SELL',
                'type': 'SELL_CALL',
                'entry_price': row['close'],
                'reason': f'CALL: IV/HV {iv_hv:.2f} > 1.3 + TOP'
            }
        elif iv_hv > 1.3 and keltner_pos == 'BOTTOM':
            return {
                'action': 'SELL',
                'type': 'SELL_PUT',
                'entry_price': row['close'],
                'reason': f'CSP: IV/HV {iv_hv:.2f} > 1.3 + BOTTOM'
            }
    else:
        # Exit signals (same as keltner_only)
        price_change_pct = (row['close'] - position['entry_price']) / position['entry_price']
        
        if position['type'] == 'BUY_LEAP':
            if position['weeks_held'] >= 8:
                return {'action': 'EXIT', 'reason': 'leap_time_expiry'}
            if price_change_pct < -0.10:
                return {'action': 'EXIT', 'reason': 'leap_stop_loss'}
            if iv_hv > 1.0:
                return {'action': 'EXIT', 'reason': 'iv_normalized'}
        else:
            if position['weeks_held'] >= 4:
                return {'action': 'EXIT', 'reason': 'time_expiry'}
            if position['type'] == 'SELL_CALL' and price_change_pct > 0.05:
                return {'action': 'EXIT', 'reason': 'stop_loss'}
            if position['type'] == 'SELL_PUT' and price_change_pct < -0.05:
                return {'action': 'EXIT', 'reason': 'stop_loss'}
            if position['type'] == 'SELL_CALL' and iv_hv < 1.0:
                return {'action': 'EXIT', 'reason': 'iv_normalized'}
            if position['type'] == 'SELL_PUT' and iv_hv < 1.0:
                return {'action': 'EXIT', 'reason': 'iv_normalized'}
    
    return None


def run_strategy(df, strategy_func, strategy_name, initial_capital=100000):
    """Run a single strategy on the data."""
    
    capital = initial_capital
    position = None
    trades = []
    equity_curve = [initial_capital]
    
    for i in range(len(df)):
        row = df.iloc[i]
        date = df.index[i]
        
        # Update position age
        if position:
            position['weeks_held'] += 1
        
        # Get strategy signal
        signal = strategy_func(row, position, capital, initial_capital)
        
        if signal:
            if signal['action'] == 'BUY' or signal['action'] == 'SELL':
                # Open new position
                position = {
                    'entry_date': date,
                    'entry_price': signal['entry_price'],
                    'type': signal['type'],
                    'weeks_held': 0,
                    'reason': signal['reason']
                }
            elif signal['action'] == 'EXIT' and position:
                # Close position
                exit_price = row['close']
                pnl = calculate_pnl(position, exit_price)
                capital += pnl
                
                trades.append({
                    'entry_date': position['entry_date'],
                    'exit_date': date,
                    'type': position['type'],
                    'entry_price': position['entry_price'],
                    'exit_price': exit_price,
                    'pnl': pnl,
                    'pnl_pct': (pnl / initial_capital) * 100,
                    'weeks_held': position['weeks_held'],
                    'exit_reason': signal['reason'],
                    'entry_reason': position['reason']
                })
                
                position = None
        
        # Track equity
        if position:
            unrealized_pnl = calculate_pnl(position, row['close'])
            equity = capital + unrealized_pnl
        else:
            equity = capital
        
        equity_curve.append(equity)
    
    # Calculate metrics
    trades_df = pd.DataFrame(trades) if trades else pd.DataFrame()
    metrics = calculate_metrics(trades_df, equity_curve, initial_capital)
    
    return {
        'strategy_name': strategy_name,
        'trades': trades_df,
        'equity_curve': equity_curve,
        'metrics': metrics
    }


def calculate_pnl(position, current_price):
    """Calculate P&L for a position."""
    entry_price = position['entry_price']
    ptype = position['type']
    
    if ptype in ['BUY_CALL', 'BUY_LEAP']:
        return (current_price - entry_price) * 100
    else:  # SELL_CALL, SELL_PUT
        return (entry_price - current_price) * 100


def calculate_metrics(trades_df, equity_curve, initial_capital):
    """Calculate performance metrics."""
    
    metrics = {}
    
    if len(trades_df) > 0:
        metrics['num_trades'] = len(trades_df)
        metrics['winning_trades'] = len(trades_df[trades_df['pnl'] > 0])
        metrics['losing_trades'] = len(trades_df[trades_df['pnl'] <= 0])
        metrics['win_rate'] = (metrics['winning_trades'] / metrics['num_trades']) * 100
        metrics['avg_win'] = trades_df[trades_df['pnl'] > 0]['pnl'].mean() if metrics['winning_trades'] > 0 else 0
        metrics['avg_loss'] = trades_df[trades_df['pnl'] <= 0]['pnl'].mean() if metrics['losing_trades'] > 0 else 0
        metrics['avg_pnl_per_trade'] = trades_df['pnl'].mean()
        
        # Win/loss ratio
        if metrics['avg_loss'] != 0:
            metrics['win_loss_ratio'] = abs(metrics['avg_win'] / metrics['avg_loss'])
        else:
            metrics['win_loss_ratio'] = float('inf') if metrics['avg_win'] > 0 else 0
    else:
        metrics['num_trades'] = 0
        metrics['winning_trades'] = 0
        metrics['losing_trades'] = 0
        metrics['win_rate'] = 0
        metrics['avg_win'] = 0
        metrics['avg_loss'] = 0
        metrics['avg_pnl_per_trade'] = 0
        metrics['win_loss_ratio'] = 0
    
    metrics['final_capital'] = equity_curve[-1]
    metrics['total_return'] = ((metrics['final_capital'] - initial_capital) / initial_capital) * 100
    
    # Drawdown
    equity_series = pd.Series(equity_curve)
    running_max = equity_series.expanding().max()
    drawdown = (equity_series - running_max) / running_max * 100
    metrics['max_drawdown'] = drawdown.min()
    
    # Sharpe
    if len(trades_df) > 0:
        returns = trades_df['pnl_pct'].values
        metrics['sharpe_ratio'] = (returns.mean() / returns.std()) * np.sqrt(52) if returns.std() > 0 else 0
    else:
        metrics['sharpe_ratio'] = 0
    
    return metrics


def run_backtest(ticker='HOOD', years=5, initial_capital=100000):
    """Run weekly backtest comparison."""
    
    print(f"\n{'='*80}")
    print(f"📊 WEEKLY BACKTEST COMPARISON - {ticker}")
    print(f"Period: {years} years")
    print(f"Initial Capital: ${initial_capital:,.0f}")
    print(f"{'='*80}\n")
    
    # Fetch weekly data
    print(f"📥 Fetching weekly data...")
    end_date = datetime.now()
    start_date = end_date - timedelta(days=365 * years)
    
    stock = yf.Ticker(ticker)
    df = stock.history(start=start_date, end=end_date, interval='1wk')
    
    if df.empty:
        print(f"❌ No data for {ticker}")
        return None
    
    df.columns = [c.lower() for c in df.columns]
    print(f"✅ Loaded {len(df)} weeks of data")
    
    # Calculate indicators
    print(f"\n📊 Calculating indicators...")
    df['returns'] = df['close'].pct_change()
    df['hv'] = calculate_hv(df['returns'], window=20)
    
    df['hv_percentile'] = df['hv'].rolling(window=52).apply(
        lambda x: (x.iloc[-1] - x.min()) / (x.max() - x.min()) * 100 if x.max() > x.min() else 50
    )
    
    df['iv_hv_ratio'] = df['hv_percentile'].apply(simulate_iv_hv_ratio)
    df['iv'] = df['hv'] * df['iv_hv_ratio']
    
    # Keltner Channel
    df = calculate_keltner_channel(df)
    df = df.dropna()
    
    print(f"✅ Indicators calculated ({len(df)} valid weeks)")
    
    # Run strategies
    results = {}
    
    print(f"\n{'='*80}")
    print(f"Running Strategies...")
    print(f"{'='*80}\n")
    
    results['vegaedge'] = run_strategy(df, strategy_vegaedge_only, "VegaEdge Only", initial_capital)
    print(f"✅ VegaEdge Only: {results['vegaedge']['metrics']['num_trades']} trades, {results['vegaedge']['metrics']['total_return']:.2f}% return")
    
    results['keltner'] = run_strategy(df, strategy_keltner_only, "Keltner Only", initial_capital)
    print(f"✅ Keltner Only: {results['keltner']['metrics']['num_trades']} trades, {results['keltner']['metrics']['total_return']:.2f}% return")
    
    results['combined'] = run_strategy(df, strategy_combined, "Combined (Keltner+VegaEdge)", initial_capital)
    print(f"✅ Combined: {results['combined']['metrics']['num_trades']} trades, {results['combined']['metrics']['total_return']:.2f}% return")
    
    # Comparison report
    print(f"\n{'='*80}")
    print(f"📊 COMPARISON REPORT")
    print(f"{'='*80}\n")
    
    generate_report(results, ticker, years)
    
    return results


def generate_report(results, ticker, years):
    """Generate comparison report."""
    
    ve = results['vegaedge']['metrics']
    ke = results['keltner']['metrics']
    co = results['combined']['metrics']
    
    print(f"**{ticker} - {years} Year Weekly Backtest**\n")
    print(f"{'Metric':<30} {'VegaEdge':<15} {'Keltner':<15} {'Combined':<15} {'Winner':<15}")
    print(f"{'-'*95}")
    
    # Trades
    min_trades = min(ve['num_trades'], ke['num_trades'], co['num_trades'])
    winner = 'VegaEdge' if ve['num_trades'] == min_trades else 'Keltner' if ke['num_trades'] == min_trades else 'Combined'
    print(f"{'Total Trades':<30} {ve['num_trades']:<15} {ke['num_trades']:<15} {co['num_trades']:<15} ✅ {winner}")
    
    # Win rate
    max_wr = max(ve['win_rate'], ke['win_rate'], co['win_rate'])
    winner = 'VegaEdge' if ve['win_rate'] == max_wr else 'Keltner' if ke['win_rate'] == max_wr else 'Combined'
    print(f"{'Win Rate (%)':<30} {ve['win_rate']:<15.1f} {ke['win_rate']:<15.1f} {co['win_rate']:<15.1f} ✅ {winner}")
    
    # Return
    max_ret = max(ve['total_return'], ke['total_return'], co['total_return'])
    winner = 'VegaEdge' if ve['total_return'] == max_ret else 'Keltner' if ke['total_return'] == max_ret else 'Combined'
    print(f"{'Total Return (%)':<30} {ve['total_return']:<15.2f} {ke['total_return']:<15.2f} {co['total_return']:<15.2f} ✅ {winner}")
    
    # Sharpe
    max_sharpe = max(ve['sharpe_ratio'], ke['sharpe_ratio'], co['sharpe_ratio'])
    winner = 'VegaEdge' if ve['sharpe_ratio'] == max_sharpe else 'Keltner' if ke['sharpe_ratio'] == max_sharpe else 'Combined'
    print(f"{'Sharpe Ratio':<30} {ve['sharpe_ratio']:<15.2f} {ke['sharpe_ratio']:<15.2f} {co['sharpe_ratio']:<15.2f} ✅ {winner}")
    
    # Drawdown (less negative is better)
    max_dd = max(ve['max_drawdown'], ke['max_drawdown'], co['max_drawdown'])
    winner = 'VegaEdge' if ve['max_drawdown'] == max_dd else 'Keltner' if ke['max_drawdown'] == max_dd else 'Combined'
    print(f"{'Max Drawdown (%)':<30} {ve['max_drawdown']:<15.2f} {ke['max_drawdown']:<15.2f} {co['max_drawdown']:<15.2f} ✅ {winner}")
    
    # Avg P&L
    max_avg = max(ve['avg_pnl_per_trade'], ke['avg_pnl_per_trade'], co['avg_pnl_per_trade'])
    winner = 'VegaEdge' if ve['avg_pnl_per_trade'] == max_avg else 'Keltner' if ke['avg_pnl_per_trade'] == max_avg else 'Combined'
    print(f"{'Avg P&L/Trade ($)':<30} {ve['avg_pnl_per_trade']:<15.0f} {ke['avg_pnl_per_trade']:<15.0f} {co['avg_pnl_per_trade']:<15.0f} ✅ {winner}")
    
    # Win/Loss ratio
    max_wl = max(ve['win_loss_ratio'], ke['win_loss_ratio'], co['win_loss_ratio'])
    winner = 'VegaEdge' if ve['win_loss_ratio'] == max_wl else 'Keltner' if ke['win_loss_ratio'] == max_wl else 'Combined'
    print(f"{'Win/Loss Ratio':<30} {ve['win_loss_ratio']:<15.2f} {ke['win_loss_ratio']:<15.2f} {co['win_loss_ratio']:<15.2f} ✅ {winner}")
    
    print(f"\n{'='*95}\n")
    
    # Determine overall winner
    scores = {'VegaEdge': 0, 'Keltner': 0, 'Combined': 0}
    
    if ve['total_return'] == max(ve['total_return'], ke['total_return'], co['total_return']):
        scores['VegaEdge'] += 2
    elif ke['total_return'] == max(ve['total_return'], ke['total_return'], co['total_return']):
        scores['Keltner'] += 2
    else:
        scores['Combined'] += 2
    
    if ve['sharpe_ratio'] == max(ve['sharpe_ratio'], ke['sharpe_ratio'], co['sharpe_ratio']):
        scores['VegaEdge'] += 1
    elif ke['sharpe_ratio'] == max(ve['sharpe_ratio'], ke['sharpe_ratio'], co['sharpe_ratio']):
        scores['Keltner'] += 1
    else:
        scores['Combined'] += 1
    
    if ve['win_rate'] == max(ve['win_rate'], ke['win_rate'], co['win_rate']):
        scores['VegaEdge'] += 1
    elif ke['win_rate'] == max(ve['win_rate'], ke['win_rate'], co['win_rate']):
        scores['Keltner'] += 1
    else:
        scores['Combined'] += 1
    
    overall_winner = max(scores, key=scores.get)
    print(f"🏆 **OVERALL WINNER: {overall_winner}** (score: {scores[overall_winner]}/4)")
    print(f"\n{'='*95}\n")


if __name__ == '__main__':
    results = run_backtest(ticker='HOOD', years=5, initial_capital=100000)
    
    if results:
        # Save combined results
        output_file = '/home/ubuntu/.openclaw/workspace/trading-dashboard-app/weekly_backtest_HOOD_comparison.csv'
        
        ve_trades = results['vegaedge']['trades'].copy()
        ve_trades['strategy'] = 'VegaEdge Only'
        
        ke_trades = results['keltner']['trades'].copy()
        ke_trades['strategy'] = 'Keltner Only'
        
        co_trades = results['combined']['trades'].copy()
        co_trades['strategy'] = 'Combined'
        
        combined = pd.concat([ve_trades, ke_trades, co_trades], ignore_index=True)
        combined.to_csv(output_file, index=False)
        
        print(f"📁 Results saved to: {output_file}")
