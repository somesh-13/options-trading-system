#!/usr/bin/env python3
"""
Daily Backtest Comparison: VegaEdge vs VegaEdge+Keltner

Compares two strategies on 1-year daily data:
1. VegaEdge Only: Pure IV/HV volatility signals
2. VegaEdge + Keltner: IV/HV + Keltner Channel confirmation

Metrics:
- Total return (%)
- Win rate / accuracy (%)
- Number of trades
- Sharpe ratio
- Max drawdown
- Average P&L per trade
"""

import pandas as pd
import numpy as np
import yfinance as yf
from datetime import datetime, timedelta
import sys
from pathlib import Path

# Add backend to path
sys.path.append(str(Path(__file__).parent / 'backend' / 'src'))

from backtest.strategies import IVHVArbitrageStrategy, BarData, SignalResult
from backtest.keltner_strategy import KeltnerVegaEdgeStrategy, KeltnerBarData, calculate_keltner_channel


def calculate_hv(returns, window=30):
    """Calculate historical volatility (annualized)."""
    return returns.rolling(window=window).std() * np.sqrt(252)


def simulate_iv_hv_ratio(hv_percentile, volatility_regime='normal'):
    """
    Simulate IV/HV ratio based on HV percentile.
    
    High HV (panic) → Usually high IV → IV/HV > 1.0
    Low HV (calm) → Usually low IV → IV/HV < 1.0
    """
    if pd.isna(hv_percentile):
        return 1.0
    
    # Add noise for realism
    noise = np.random.uniform(-0.1, 0.1)
    
    if hv_percentile > 90:  # Extreme volatility
        return np.random.uniform(1.2, 1.8) + noise
    elif hv_percentile > 70:  # High volatility
        return np.random.uniform(1.0, 1.4) + noise
    elif hv_percentile < 30:  # Low volatility
        return np.random.uniform(0.6, 0.9) + noise
    else:  # Normal
        return np.random.uniform(0.9, 1.2) + noise


def run_backtest(ticker='HOOD', start_date='2025-02-14', end_date='2026-02-14', initial_capital=100000):
    """
    Run backtest comparison between VegaEdge and VegaEdge+Keltner.
    
    Returns:
        dict with results for both strategies
    """
    
    print(f"\n{'='*80}")
    print(f"📊 DAILY BACKTEST COMPARISON - {ticker}")
    print(f"Period: {start_date} to {end_date}")
    print(f"Initial Capital: ${initial_capital:,.0f}")
    print(f"{'='*80}\n")
    
    # Fetch data
    print(f"📥 Fetching daily data...")
    stock = yf.Ticker(ticker)
    df = stock.history(start=start_date, end=end_date, interval='1d')
    
    if df.empty:
        print(f"❌ No data for {ticker}")
        return None
    
    # Standardize column names
    df.columns = [c.lower() for c in df.columns]
    
    print(f"✅ Loaded {len(df)} days of data")
    
    # Calculate indicators
    print(f"\n📊 Calculating indicators...")
    df['returns'] = df['close'].pct_change()
    df['hv'] = calculate_hv(df['returns'], window=30)
    
    # Calculate HV percentile (60-day rolling)
    df['hv_percentile'] = df['hv'].rolling(window=60).apply(
        lambda x: (x.iloc[-1] - x.min()) / (x.max() - x.min()) * 100 if x.max() > x.min() else 50
    )
    
    # Simulate IV/HV ratio
    df['iv_hv_ratio'] = df['hv_percentile'].apply(simulate_iv_hv_ratio)
    df['iv'] = df['hv'] * df['iv_hv_ratio']
    
    # Calculate IV/HV rolling stats for strategies
    df['iv_hv_rolling_mean'] = df['iv_hv_ratio'].rolling(window=30).mean()
    df['iv_hv_rolling_std'] = df['iv_hv_ratio'].rolling(window=30).std()
    
    # Calculate Keltner Channel
    df = calculate_keltner_channel(df)
    
    # Drop NaN rows
    df = df.dropna()
    
    print(f"✅ Indicators calculated ({len(df)} valid days)")
    
    # Strategy configurations
    config = {
        'iv_hv_sell_threshold': 1.3,
        'iv_hv_buy_threshold': 0.8,
        'stop_loss_pct': 0.05,
        'risk_free_rate': 0.05
    }
    
    # Run both strategies
    results = {}
    
    # Strategy 1: VegaEdge Only
    print(f"\n{'='*80}")
    print(f"🔵 Running Strategy 1: VegaEdge Only (IV/HV Signals)")
    print(f"{'='*80}")
    results['vegaedge'] = run_single_strategy(
        df, IVHVArbitrageStrategy(), config, initial_capital, "VegaEdge Only"
    )
    
    # Strategy 2: VegaEdge + Keltner
    print(f"\n{'='*80}")
    print(f"🟢 Running Strategy 2: VegaEdge + Keltner Channel")
    print(f"{'='*80}")
    results['keltner'] = run_single_strategy(
        df, KeltnerVegaEdgeStrategy(), config, initial_capital, "VegaEdge + Keltner"
    )
    
    # Comparison Report
    print(f"\n{'='*80}")
    print(f"📊 COMPARISON REPORT")
    print(f"{'='*80}\n")
    
    generate_comparison_report(results['vegaedge'], results['keltner'], ticker, start_date, end_date)
    
    return results


def run_single_strategy(df, strategy, config, initial_capital, strategy_name):
    """Run a single strategy and track performance."""
    
    capital = initial_capital
    position = None
    trades = []
    equity_curve = [initial_capital]
    
    for i in range(len(df)):
        row = df.iloc[i]
        date = df.index[i]
        
        # Create bar data
        if isinstance(strategy, KeltnerVegaEdgeStrategy):
            bar = KeltnerBarData(
                date=str(date.date()),
                spot=row['close'],
                hv=row['hv'],
                iv=row['iv'],
                iv_hv_ratio=row['iv_hv_ratio'],
                iv_hv_rolling_mean=row['iv_hv_rolling_mean'],
                iv_hv_rolling_std=row['iv_hv_rolling_std'],
                ema_20=row['ema_20'],
                atr_20=row['atr_20'],
                upper_band=row['upper_band'],
                lower_band=row['lower_band'],
                keltner_position=row['keltner_position']
            )
        else:
            bar = BarData(
                date=str(date.date()),
                spot=row['close'],
                hv=row['hv'],
                iv=row['iv'],
                iv_hv_ratio=row['iv_hv_ratio'],
                iv_hv_rolling_mean=row['iv_hv_rolling_mean'],
                iv_hv_rolling_std=row['iv_hv_rolling_std']
            )
        
        # Check for exit if in position
        if position:
            position['days_held'] += 1
            exit_signal = strategy.exit_signal(bar, position, config)
            
            if exit_signal.should_act:
                # Close position
                exit_price = bar.spot
                pnl = calculate_pnl(position, exit_price)
                capital += pnl
                
                trades.append({
                    'entry_date': position['entry_date'],
                    'exit_date': bar.date,
                    'direction': position['direction'],
                    'entry_price': position['entry_spot'],
                    'exit_price': exit_price,
                    'pnl': pnl,
                    'pnl_pct': (pnl / initial_capital) * 100,
                    'days_held': position['days_held'],
                    'exit_reason': exit_signal.reason,
                    'signal_type': position.get('signal_type', 'N/A')
                })
                
                position = None
        
        # Check for entry if no position
        if not position:
            entry_signal = strategy.entry_signal(bar, config)
            
            if entry_signal.should_act:
                # Open position
                position = {
                    'entry_date': bar.date,
                    'entry_spot': bar.spot,
                    'direction': entry_signal.direction,
                    'days_held': 0,
                    'signal_type': entry_signal.metadata.get('signal_type', 'N/A')
                }
        
        # Track equity
        if position:
            # Mark to market
            unrealized_pnl = calculate_pnl(position, bar.spot)
            equity = capital + unrealized_pnl
        else:
            equity = capital
        
        equity_curve.append(equity)
    
    # Calculate metrics
    trades_df = pd.DataFrame(trades) if trades else pd.DataFrame()
    metrics = calculate_metrics(trades_df, equity_curve, initial_capital)
    
    print(f"\n{strategy_name} Results:")
    print(f"  Total Trades: {len(trades)}")
    print(f"  Win Rate: {metrics['win_rate']:.1f}%")
    print(f"  Total Return: {metrics['total_return']:.2f}%")
    print(f"  Final Capital: ${metrics['final_capital']:,.0f}")
    
    return {
        'strategy_name': strategy_name,
        'trades': trades_df,
        'equity_curve': equity_curve,
        'metrics': metrics
    }


def calculate_pnl(position, current_price):
    """Calculate P&L for a position."""
    entry_price = position['entry_spot']
    direction = position['direction']
    
    if direction in ['BUY_CALL', 'BUY_PUT']:
        # Long option: profit when price moves favorably
        return (current_price - entry_price) * 100  # 1 contract = 100 shares
    else:  # SELL_CALL, SELL_PUT
        # Short option: profit when price moves against holder
        return (entry_price - current_price) * 100


def calculate_metrics(trades_df, equity_curve, initial_capital):
    """Calculate performance metrics."""
    
    metrics = {}
    
    # Trade statistics
    if len(trades_df) > 0:
        metrics['num_trades'] = len(trades_df)
        metrics['winning_trades'] = len(trades_df[trades_df['pnl'] > 0])
        metrics['losing_trades'] = len(trades_df[trades_df['pnl'] <= 0])
        metrics['win_rate'] = (metrics['winning_trades'] / metrics['num_trades']) * 100
        metrics['avg_win'] = trades_df[trades_df['pnl'] > 0]['pnl'].mean() if metrics['winning_trades'] > 0 else 0
        metrics['avg_loss'] = trades_df[trades_df['pnl'] <= 0]['pnl'].mean() if metrics['losing_trades'] > 0 else 0
        metrics['avg_pnl_per_trade'] = trades_df['pnl'].mean()
    else:
        metrics['num_trades'] = 0
        metrics['winning_trades'] = 0
        metrics['losing_trades'] = 0
        metrics['win_rate'] = 0
        metrics['avg_win'] = 0
        metrics['avg_loss'] = 0
        metrics['avg_pnl_per_trade'] = 0
    
    # Portfolio metrics
    metrics['final_capital'] = equity_curve[-1]
    metrics['total_return'] = ((metrics['final_capital'] - initial_capital) / initial_capital) * 100
    
    # Drawdown
    equity_series = pd.Series(equity_curve)
    running_max = equity_series.expanding().max()
    drawdown = (equity_series - running_max) / running_max * 100
    metrics['max_drawdown'] = drawdown.min()
    
    # Sharpe Ratio (simplified)
    if len(trades_df) > 0:
        returns = trades_df['pnl_pct'].values
        metrics['sharpe_ratio'] = (returns.mean() / returns.std()) * np.sqrt(252) if returns.std() > 0 else 0
    else:
        metrics['sharpe_ratio'] = 0
    
    return metrics


def generate_comparison_report(vegaedge_results, keltner_results, ticker, start_date, end_date):
    """Generate side-by-side comparison report."""
    
    ve = vegaedge_results['metrics']
    ke = keltner_results['metrics']
    
    print(f"**{ticker} - {start_date} to {end_date}**\n")
    
    print(f"{'Metric':<30} {'VegaEdge Only':<20} {'VegaEdge+Keltner':<20} {'Winner':<10}")
    print(f"{'-'*80}")
    
    # Number of trades
    winner = '✅ Keltner' if ke['num_trades'] < ve['num_trades'] else '✅ VegaEdge' if ve['num_trades'] < ke['num_trades'] else 'Tie'
    print(f"{'Total Trades':<30} {ve['num_trades']:<20} {ke['num_trades']:<20} {winner:<10}")
    
    # Win Rate
    winner = '✅ Keltner' if ke['win_rate'] > ve['win_rate'] else '✅ VegaEdge' if ve['win_rate'] > ke['win_rate'] else 'Tie'
    print(f"{'Win Rate (%)':<30} {ve['win_rate']:<20.1f} {ke['win_rate']:<20.1f} {winner:<10}")
    
    # Total Return
    winner = '✅ Keltner' if ke['total_return'] > ve['total_return'] else '✅ VegaEdge'
    print(f"{'Total Return (%)':<30} {ve['total_return']:<20.2f} {ke['total_return']:<20.2f} {winner:<10}")
    
    # Sharpe Ratio
    winner = '✅ Keltner' if ke['sharpe_ratio'] > ve['sharpe_ratio'] else '✅ VegaEdge'
    print(f"{'Sharpe Ratio':<30} {ve['sharpe_ratio']:<20.2f} {ke['sharpe_ratio']:<20.2f} {winner:<10}")
    
    # Max Drawdown (less negative is better)
    winner = '✅ Keltner' if ke['max_drawdown'] > ve['max_drawdown'] else '✅ VegaEdge'
    print(f"{'Max Drawdown (%)':<30} {ve['max_drawdown']:<20.2f} {ke['max_drawdown']:<20.2f} {winner:<10}")
    
    # Avg P&L per trade
    winner = '✅ Keltner' if ke['avg_pnl_per_trade'] > ve['avg_pnl_per_trade'] else '✅ VegaEdge'
    print(f"{'Avg P&L per Trade ($)':<30} {ve['avg_pnl_per_trade']:<20.0f} {ke['avg_pnl_per_trade']:<20.0f} {winner:<10}")
    
    print(f"\n{'='*80}")
    print(f"💡 KEY INSIGHTS\n")
    
    # Quality vs Quantity
    if ke['num_trades'] < ve['num_trades'] and ke['win_rate'] > ve['win_rate']:
        print(f"✅ **Keltner filters for QUALITY over quantity:**")
        print(f"   - {ve['num_trades'] - ke['num_trades']} fewer trades")
        print(f"   - +{ke['win_rate'] - ve['win_rate']:.1f}% higher win rate")
        print(f"   - Keltner Channel confirms support/resistance levels\n")
    
    # Return comparison
    return_diff = ke['total_return'] - ve['total_return']
    if abs(return_diff) > 5:
        if return_diff > 0:
            print(f"✅ **Keltner outperformed by {return_diff:.1f}%**")
            print(f"   - Technical confirmation improves edge")
        else:
            print(f"⚠️ **VegaEdge outperformed by {abs(return_diff):.1f}%**")
            print(f"   - More signals captured more opportunities")
    else:
        print(f"⚖️ **Similar returns ({abs(return_diff):.1f}% difference)**")
        print(f"   - Keltner's selectivity trades quantity for quality")
    
    print(f"\n{'='*80}\n")


if __name__ == '__main__':
    # Run 1-year backtest on HOOD
    ticker = 'HOOD'
    end_date = datetime.now()
    start_date = end_date - timedelta(days=365)
    
    results = run_backtest(
        ticker=ticker,
        start_date=start_date.strftime('%Y-%m-%d'),
        end_date=end_date.strftime('%Y-%m-%d'),
        initial_capital=100000
    )
    
    # Save results
    if results:
        output_file = f'/home/ubuntu/.openclaw/workspace/trading-dashboard-app/daily_backtest_{ticker}_comparison.csv'
        
        # Combine trade history
        ve_trades = results['vegaedge']['trades'].copy()
        ve_trades['strategy'] = 'VegaEdge Only'
        
        ke_trades = results['keltner']['trades'].copy()
        ke_trades['strategy'] = 'VegaEdge + Keltner'
        
        combined = pd.concat([ve_trades, ke_trades], ignore_index=True)
        combined.to_csv(output_file, index=False)
        
        print(f"📁 Detailed results saved to: {output_file}")
