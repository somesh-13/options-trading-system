"""Multi-Strategy Backtesting Engine.

Runs multiple strategies across multiple tickers and produces
a comparative results table.
"""

import numpy as np
import pandas as pd
import yfinance as yf
from datetime import datetime

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))

from backtest.engine import compute_metrics, _compute_rolling_hv, _compute_monthly_returns
from backtest.strategies import (
    BarData, BaseStrategy, STRATEGY_MAP,
)
from backtest.price_analysis import calculate_price_metrics, analyze_price_sensitivity


def _compute_synthetic_iv_seeded(hv: pd.Series, seed: int, noise_factor: float = 0.15) -> pd.Series:
    """Generate synthetic IV with a per-ticker deterministic seed."""
    rng = np.random.RandomState(seed)
    premium = 1.0 + np.abs(rng.normal(0.1, noise_factor, len(hv)))
    return hv * premium


def _prepare_data(ticker: str, start_date: str, end_date: str) -> pd.DataFrame:
    """Fetch price data and compute all BarData columns for a ticker.

    Returns a DataFrame with columns:
        date, spot, hv, iv, iv_hv_ratio, iv_hv_rolling_mean, iv_hv_rolling_std
    Rows with NaN are dropped.
    """
    stock = yf.Ticker(ticker)
    hist = stock.history(start=start_date, end=end_date)

    if hist.empty or len(hist) < 60:
        return pd.DataFrame()

    prices = hist["Close"]
    hv = _compute_rolling_hv(prices, window=30)

    seed = hash(ticker) % 10000
    iv = _compute_synthetic_iv_seeded(hv, seed=seed)

    ratio = iv / hv

    rolling_mean = ratio.rolling(window=20).mean()
    rolling_std = ratio.rolling(window=20).std()

    df = pd.DataFrame({
        "date": prices.index,
        "spot": prices.values,
        "hv": hv.values,
        "iv": iv.values,
        "iv_hv_ratio": ratio.values,
        "iv_hv_rolling_mean": rolling_mean.values,
        "iv_hv_rolling_std": rolling_std.values,
    })

    df = df.dropna().reset_index(drop=True)
    return df


def run_strategy_backtest(
    strategy: BaseStrategy,
    ticker: str,
    data: pd.DataFrame,
    config: dict,
) -> dict:
    """Run a single strategy on prepared data for one ticker.

    Returns dict with keys: trades, equity_curve, final_capital.
    """
    initial_capital = config.get("initial_capital", 100000.0)
    max_position_pct = config.get("max_position_pct", 0.1)

    capital = initial_capital
    equity_curve = []
    trades = []
    position = None

    for idx in range(len(data)):
        row = data.iloc[idx]
        bar = BarData(
            date=str(pd.Timestamp(row["date"]).date()) if not isinstance(row["date"], str) else row["date"],
            spot=float(row["spot"]),
            hv=float(row["hv"]),
            iv=float(row["iv"]),
            iv_hv_ratio=float(row["iv_hv_ratio"]),
            iv_hv_rolling_mean=float(row["iv_hv_rolling_mean"]),
            iv_hv_rolling_std=float(row["iv_hv_rolling_std"]),
        )

        # Check exit
        if position is not None:
            # Track price history
            position.setdefault("price_history", []).append(bar.spot)
            
            position["days_held"] = idx - position["entry_idx"]
            exit_sig = strategy.exit_signal(bar, position, config)

            if exit_sig.should_act:
                # P&L formula from engine.py
                if position["direction"] == "SELL_CALL":
                    pnl = position["premium"] * (1.0 - bar.iv_hv_ratio / position["iv_hv_ratio"])
                else:
                    pnl = position["premium"] * (bar.iv_hv_ratio / position["iv_hv_ratio"] - 1.0)

                pnl = round(pnl * position["contracts"] * 100, 2)
                capital += pnl

                # Calculate price movement metrics
                price_metrics = calculate_price_metrics(
                    entry_spot=position["entry_spot"],
                    exit_spot=bar.spot,
                    entry_iv=position["iv"],
                    exit_iv=bar.iv,
                    price_history=position.get("price_history", [position["entry_spot"], bar.spot]),
                    position_direction=position["direction"],
                    avg_delta=0.5,
                    avg_vega=0.02,
                    total_pnl=pnl,
                    contracts=position["contracts"],
                )

                trades.append({
                    "entry_date": position["entry_date"],
                    "exit_date": bar.date,
                    "ticker": ticker,
                    "direction": position["direction"],
                    "entry_price": position["entry_spot"],
                    "exit_price": bar.spot,
                    "pnl": pnl,
                    "pnl_pct": round(pnl / initial_capital * 100, 4),
                    "iv_at_entry": position["iv"],
                    "hv_at_entry": position["hv"],
                    "iv_hv_ratio": position["iv_hv_ratio"],
                    "holding_days": position["days_held"],
                    "exit_reason": exit_sig.reason,
                    "metadata": {**position.get("metadata", {}), **exit_sig.metadata},
                    # NEW: Price movement metrics
                    **price_metrics,
                })
                position = None

        # Check entry
        if position is None:
            entry_sig = strategy.entry_signal(bar, config)
            if entry_sig.should_act:
                premium = bar.spot * bar.iv * np.sqrt(30 / 365) * 0.4
                contracts = max(1, int(capital * max_position_pct / (premium * 100)))
                position = {
                    "entry_date": bar.date,
                    "entry_idx": idx,
                    "entry_spot": bar.spot,
                    "direction": entry_sig.direction,
                    "premium": premium,
                    "contracts": contracts,
                    "iv": bar.iv,
                    "hv": bar.hv,
                    "iv_hv_ratio": bar.iv_hv_ratio,
                    "days_held": 0,
                    "metadata": entry_sig.metadata,
                    "price_history": [bar.spot],  # Track prices during trade
                }

        equity_curve.append({"date": bar.date, "equity": round(capital, 2)})

    # Close remaining position at end
    if position is not None and len(data) > 0:
        last_row = data.iloc[-1]
        last_ratio = float(last_row["iv_hv_ratio"])
        if position["direction"] == "SELL_CALL":
            pnl = position["premium"] * (1.0 - last_ratio / position["iv_hv_ratio"])
        else:
            pnl = position["premium"] * (last_ratio / position["iv_hv_ratio"] - 1.0)
        pnl = round(pnl * position["contracts"] * 100, 2)
        capital += pnl

        # Calculate price movement metrics
        price_metrics = calculate_price_metrics(
            entry_spot=position["entry_spot"],
            exit_spot=float(last_row["spot"]),
            entry_iv=position["iv"],
            exit_iv=float(last_row["iv"]),
            price_history=position.get("price_history", [position["entry_spot"], float(last_row["spot"])]),
            position_direction=position["direction"],
            avg_delta=0.5,
            avg_vega=0.02,
            total_pnl=pnl,
            contracts=position["contracts"],
        )

        last_date = str(pd.Timestamp(last_row["date"]).date()) if not isinstance(last_row["date"], str) else last_row["date"]
        trades.append({
            "entry_date": position["entry_date"],
            "exit_date": last_date,
            "ticker": ticker,
            "direction": position["direction"],
            "entry_price": position["entry_spot"],
            "exit_price": float(last_row["spot"]),
            "pnl": pnl,
            "pnl_pct": round(pnl / initial_capital * 100, 4),
            "iv_at_entry": position["iv"],
            "hv_at_entry": position["hv"],
            "iv_hv_ratio": position["iv_hv_ratio"],
            "holding_days": len(data) - 1 - position["entry_idx"],
            "exit_reason": "backtest_end",
            "metadata": position.get("metadata", {}),
            # NEW: Price movement metrics
            **price_metrics,
        })

    return {
        "trades": trades,
        "equity_curve": equity_curve,
        "final_capital": round(capital, 2),
    }


def run_multi_backtest(config: dict) -> dict:
    """Run multiple strategies across multiple tickers.

    Args:
        config: dict with keys matching MultiBacktestRequest fields.

    Returns:
        Comparative results for all strategies.
    """
    tickers = config.get("tickers", ["CIFR", "MARA", "RIOT", "COIN", "SQ"])
    start_date = config.get("start_date", "2022-01-01")
    end_date = config.get("end_date", "2025-12-31")
    strategy_names = config.get("strategies", ["iv_hv_arbitrage", "ev_filtered", "mean_reversion"])
    initial_capital = config.get("initial_capital", 100000.0)

    # Prepare data once per ticker
    ticker_data = {}
    for ticker in tickers:
        df = _prepare_data(ticker, start_date, end_date)
        if not df.empty:
            ticker_data[ticker] = df

    if not ticker_data:
        return {"error": "No data available for any ticker", "strategies": {}}

    # Run each strategy across all tickers
    results = {}
    for strat_name in strategy_names:
        if strat_name not in STRATEGY_MAP:
            continue

        strategy = STRATEGY_MAP[strat_name]()
        all_trades = []
        combined_equity = []
        per_ticker = {}

        for ticker, data in ticker_data.items():
            bt = run_strategy_backtest(strategy, ticker, data, config)
            all_trades.extend(bt["trades"])
            per_ticker[ticker] = {
                "trades": len(bt["trades"]),
                "final_capital": bt["final_capital"],
            }
            # Use the equity curve from the first ticker for the combined curve
            # (each ticker runs independently with the same initial capital)
            if not combined_equity:
                combined_equity = bt["equity_curve"]

        # Compute aggregate metrics across all trades
        metrics = compute_metrics(all_trades, combined_equity, initial_capital)
        monthly = _compute_monthly_returns(combined_equity)
        
        # Compute price sensitivity analysis
        price_analysis = analyze_price_sensitivity(all_trades, combined_equity)

        results[strat_name] = {
            "strategy": strat_name,
            "metrics": metrics,
            "trades": all_trades,
            "equity_curve": combined_equity,
            "monthly_returns": monthly,
            "per_ticker": per_ticker,
            "price_analysis": price_analysis,  # NEW
        }

    # Build comparison table
    comparison = []
    for strat_name, strat_result in results.items():
        m = strat_result["metrics"]
        p = strat_result.get("price_analysis", {})
        comparison.append({
            "strategy": strat_name,
            "total_return_pct": m.get("total_return_pct", 0),
            "sharpe_ratio": m.get("sharpe_ratio", 0),
            "max_drawdown_pct": m.get("max_drawdown_pct", 0),
            "win_rate": m.get("win_rate", 0),
            "profit_factor": m.get("profit_factor", 0),
            "total_trades": m.get("total_trades", 0),
            "avg_pnl": m.get("avg_pnl", 0),
            "final_equity": m.get("final_equity", 0),
            # NEW: Price neutrality metrics
            "beta": p.get("price_correlation", {}).get("beta_to_underlying", 0),
            "market_neutrality_score": p.get("market_neutrality", {}).get("score", 0),
            "vega_pnl_pct": p.get("pnl_attribution", {}).get("vega_pct", 0),
        })

    return {
        "config": {
            "tickers": list(ticker_data.keys()),
            "start_date": start_date,
            "end_date": end_date,
            "initial_capital": initial_capital,
            "strategies": strategy_names,
        },
        "comparison": comparison,
        "strategies": results,
    }
