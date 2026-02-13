"""Test script for price movement analysis."""

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent / "src"))

from backtest.engine import BacktestConfig, run_backtest
import json

print("Testing price movement analysis implementation...\n")

# Run a simple backtest
config = BacktestConfig(
    ticker="CIFR",
    start_date="2023-01-01",
    end_date="2024-01-01",
    initial_capital=100000.0,
    iv_hv_sell_threshold=1.15,
    iv_hv_buy_threshold=0.85,
)

print(f"Running backtest for {config.ticker}...")
result = run_backtest(config)

print(f"\n✅ Backtest completed!")
print(f"Total trades: {len(result.trades)}")

if len(result.trades) > 0:
    print(f"\n📊 Sample trade with price metrics:")
    trade = result.trades[0]
    print(json.dumps({
        "entry_date": trade.get("entry_date"),
        "exit_date": trade.get("exit_date"),
        "direction": trade.get("direction"),
        "pnl": trade.get("pnl"),
        "underlying_return_pct": trade.get("underlying_return_pct"),
        "price_direction": trade.get("price_direction"),
        "delta_pnl": trade.get("delta_pnl"),
        "vega_pnl": trade.get("vega_pnl"),
        "gamma_pnl": trade.get("gamma_pnl"),
    }, indent=2))
    
    # Check if price_analysis is in metrics
    if "price_analysis" in result.metrics:
        print(f"\n📈 Price Analysis Summary:")
        pa = result.metrics["price_analysis"]
        
        print(f"\nMarket Neutrality:")
        print(f"  Score: {pa['market_neutrality']['score']:.4f} ({pa['market_neutrality']['interpretation']})")
        print(f"  Beta: {pa['price_correlation']['beta_to_underlying']:.4f}")
        print(f"  Correlation: {pa['price_correlation']['pnl_vs_price_correlation']:.4f}")
        
        print(f"\nP&L by Direction:")
        print(f"  UP markets: ${pa['pnl_by_direction']['up_market_pnl']:.2f}")
        print(f"  DOWN markets: ${pa['pnl_by_direction']['down_market_pnl']:.2f}")
        print(f"  FLAT markets: ${pa['pnl_by_direction']['flat_market_pnl']:.2f}")
        
        print(f"\nP&L Attribution:")
        print(f"  Vega (Vol Edge): ${pa['pnl_attribution']['from_vega']:.2f} ({pa['pnl_attribution']['vega_pct']:.1f}%)")
        print(f"  Delta (Directional): ${pa['pnl_attribution']['from_delta']:.2f} ({pa['pnl_attribution']['delta_pct']:.1f}%)")
        print(f"  Gamma (Scalping): ${pa['pnl_attribution']['from_gamma']:.2f} ({pa['pnl_attribution']['gamma_pct']:.1f}%)")
        
        print(f"\n✅ Price analysis implementation successful!")
    else:
        print(f"\n⚠️ Warning: price_analysis not found in metrics")
else:
    print(f"\n⚠️ No trades executed in this backtest period")

print(f"\n✅ Test complete!")
