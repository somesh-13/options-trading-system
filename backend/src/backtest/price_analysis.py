"""Price Movement Analysis for Backtesting Results.

Analyzes how underlying stock price movements affect strategy performance.
Measures market neutrality, directional risk, and P&L attribution.
"""

import numpy as np
import pandas as pd
from typing import Optional
from scipy.stats import pearsonr


def calculate_price_metrics(
    entry_spot: float,
    exit_spot: float,
    entry_iv: float,
    exit_iv: float,
    price_history: list[float],
    position_direction: str,
    avg_delta: float = 0.5,
    avg_vega: float = 0.02,
    total_pnl: float = 0.0,
    contracts: int = 1,
) -> dict:
    """Calculate price movement and P&L attribution metrics for a single trade.
    
    Args:
        entry_spot: Stock price at trade entry
        exit_spot: Stock price at trade exit
        entry_iv: Implied volatility at entry
        exit_iv: Implied volatility at exit
        price_history: List of stock prices during the trade
        position_direction: "SELL_CALL" or "BUY_CALL"
        avg_delta: Average delta during trade (default 0.5)
        avg_vega: Average vega during trade (default 0.02)
        total_pnl: Total P&L from the trade
        contracts: Number of contracts
    
    Returns:
        Dictionary with price metrics and P&L attribution
    """
    
    # 1. Price return
    underlying_return_pct = (exit_spot - entry_spot) / entry_spot * 100
    
    # 2. Price direction
    if abs(underlying_return_pct) < 2.0:
        direction = "FLAT"
    elif underlying_return_pct > 0:
        direction = "UP"
    else:
        direction = "DOWN"
    
    # 3. Realized volatility during trade
    if len(price_history) > 2:
        prices_arr = np.array(price_history)
        returns = np.diff(np.log(prices_arr))
        realized_vol = np.std(returns) * np.sqrt(252)
    else:
        realized_vol = 0.0
    
    # 4. P&L Attribution
    # Delta P&L (from directional move)
    # For SELL_CALL: negative delta (lose when price goes up)
    # For BUY_CALL: positive delta (gain when price goes up)
    delta_sign = -1 if position_direction == "SELL_CALL" else 1
    delta_pnl = delta_sign * avg_delta * (exit_spot - entry_spot) * contracts * 100
    
    # Vega P&L (from volatility change - our main edge)
    # For SELL_CALL: negative vega (lose when IV goes up)
    # For BUY_CALL: positive vega (gain when IV goes up)
    vega_sign = -1 if position_direction == "SELL_CALL" else 1
    vega_pnl = vega_sign * avg_vega * (exit_iv - entry_iv) * contracts * 100
    
    # Gamma P&L (residual - includes theta decay and realized vol vs implied)
    gamma_pnl = total_pnl - delta_pnl - vega_pnl
    
    return {
        "underlying_return_pct": round(float(underlying_return_pct), 4),
        "underlying_realized_vol": round(float(realized_vol), 4),
        "price_direction": direction,
        "delta_pnl": round(float(delta_pnl), 2),
        "vega_pnl": round(float(vega_pnl), 2),
        "gamma_pnl": round(float(gamma_pnl), 2),
    }


def analyze_price_sensitivity(trades: list[dict], equity_curve: list[dict]) -> dict:
    """Analyze how stock price movements affect strategy performance.
    
    Computes:
    - Correlation between P&L and price movements
    - Beta to underlying
    - P&L by market direction (UP/DOWN/FLAT)
    - Market neutrality score
    - Sharpe ratio by direction
    - P&L attribution aggregates
    
    Args:
        trades: List of trade dictionaries with price metrics
        equity_curve: List of equity curve points
    
    Returns:
        Comprehensive price sensitivity analysis
    """
    
    if not trades:
        return {
            "price_correlation": {
                "pnl_vs_price_correlation": 0.0,
                "p_value": 1.0,
                "beta_to_underlying": 0.0,
            },
            "pnl_by_direction": {
                "up_market_pnl": 0.0,
                "down_market_pnl": 0.0,
                "flat_market_pnl": 0.0,
                "edge_ratio": 1.0,
            },
            "market_neutrality": {
                "score": 1.0,
                "interpretation": "INSUFFICIENT_DATA"
            },
            "sharpe_by_direction": {
                "up_market": 0.0,
                "down_market": 0.0,
                "flat_market": 0.0,
            },
            "pnl_attribution": {
                "from_delta": 0.0,
                "from_vega": 0.0,
                "from_gamma": 0.0,
                "total": 0.0,
                "vega_pct": 0.0,
            },
            "trade_counts": {
                "up_markets": 0,
                "down_markets": 0,
                "flat_markets": 0,
            }
        }
    
    df = pd.DataFrame(trades)
    
    # 1. Correlation analysis
    if len(df) > 2 and "underlying_return_pct" in df.columns:
        try:
            correlation, p_value = pearsonr(
                df["underlying_return_pct"].fillna(0),
                df["pnl"].fillna(0)
            )
        except Exception:
            correlation, p_value = 0.0, 1.0
    else:
        correlation, p_value = 0.0, 1.0
    
    # 2. P&L by direction
    up_trades = df[df.get("price_direction", "FLAT") == "UP"] if "price_direction" in df.columns else pd.DataFrame()
    down_trades = df[df.get("price_direction", "FLAT") == "DOWN"] if "price_direction" in df.columns else pd.DataFrame()
    flat_trades = df[df.get("price_direction", "FLAT") == "FLAT"] if "price_direction" in df.columns else pd.DataFrame()
    
    pnl_up = float(up_trades["pnl"].sum()) if len(up_trades) > 0 else 0.0
    pnl_down = float(down_trades["pnl"].sum()) if len(down_trades) > 0 else 0.0
    pnl_flat = float(flat_trades["pnl"].sum()) if len(flat_trades) > 0 else 0.0
    
    # 3. Market neutrality metrics
    # Edge ratio: how balanced is P&L between up and down markets?
    if pnl_up > 0 and pnl_down > 0:
        edge_ratio = min(pnl_up, pnl_down) / max(pnl_up, pnl_down)
    elif pnl_up < 0 and pnl_down < 0:
        # Both negative - still check balance
        edge_ratio = max(pnl_up, pnl_down) / min(pnl_up, pnl_down)
    else:
        edge_ratio = 0.0
    
    # Market neutrality score (0-1, higher = more neutral)
    # Based on: low correlation + low beta + balanced P&L across directions
    neutrality_score = 0.0
    
    # Component 1: Low correlation (30% weight)
    corr_component = max(0, 1.0 - abs(correlation)) * 0.3
    
    # Component 2: Balanced P&L (40% weight)
    balance_component = edge_ratio * 0.4
    
    # Component 3: Beta (30% weight) - calculated below
    
    # 4. Beta calculation
    if len(df) > 5 and "underlying_return_pct" in df.columns and "pnl_pct" in df.columns:
        try:
            strategy_returns = df["pnl_pct"].fillna(0).values
            underlying_returns = df["underlying_return_pct"].fillna(0).values
            
            cov_matrix = np.cov(strategy_returns, underlying_returns)
            cov = cov_matrix[0, 1]
            var_market = np.var(underlying_returns)
            beta = cov / var_market if var_market > 0 else 0.0
        except Exception:
            beta = 0.0
    else:
        beta = 0.0
    
    # Component 3: Low beta
    beta_component = max(0, 1.0 - min(1.0, abs(beta))) * 0.3
    
    neutrality_score = corr_component + balance_component + beta_component
    
    # Interpretation
    if neutrality_score > 0.85:
        interpretation = "EXCELLENT"
    elif neutrality_score > 0.70:
        interpretation = "GOOD"
    elif neutrality_score > 0.50:
        interpretation = "FAIR"
    else:
        interpretation = "POOR"
    
    # 5. Sharpe by direction
    def safe_sharpe(pnls):
        if len(pnls) < 2:
            return 0.0
        arr = np.array(pnls)
        return float(np.mean(arr) / np.std(arr) * np.sqrt(252 / 30)) if np.std(arr) > 0 else 0.0
    
    sharpe_up = safe_sharpe(up_trades["pnl"].values) if len(up_trades) > 0 else 0.0
    sharpe_down = safe_sharpe(down_trades["pnl"].values) if len(down_trades) > 0 else 0.0
    sharpe_flat = safe_sharpe(flat_trades["pnl"].values) if len(flat_trades) > 0 else 0.0
    
    # 6. P&L attribution aggregate
    total_delta_pnl = float(df["delta_pnl"].sum()) if "delta_pnl" in df.columns else 0.0
    total_vega_pnl = float(df["vega_pnl"].sum()) if "vega_pnl" in df.columns else 0.0
    total_gamma_pnl = float(df["gamma_pnl"].sum()) if "gamma_pnl" in df.columns else 0.0
    total_pnl = float(df["pnl"].sum())
    
    vega_pct = (total_vega_pnl / total_pnl * 100) if total_pnl != 0 else 0.0
    
    return {
        "price_correlation": {
            "pnl_vs_price_correlation": round(float(correlation), 4),
            "p_value": round(float(p_value), 4),
            "beta_to_underlying": round(float(beta), 4),
        },
        "pnl_by_direction": {
            "up_market_pnl": round(pnl_up, 2),
            "down_market_pnl": round(pnl_down, 2),
            "flat_market_pnl": round(pnl_flat, 2),
            "edge_ratio": round(float(edge_ratio), 4),
        },
        "market_neutrality": {
            "score": round(float(neutrality_score), 4),
            "interpretation": interpretation,
            "components": {
                "correlation": round(float(corr_component), 4),
                "balance": round(float(balance_component), 4),
                "beta": round(float(beta_component), 4),
            }
        },
        "sharpe_by_direction": {
            "up_market": round(sharpe_up, 4),
            "down_market": round(sharpe_down, 4),
            "flat_market": round(sharpe_flat, 4),
        },
        "pnl_attribution": {
            "from_delta": round(total_delta_pnl, 2),
            "from_vega": round(total_vega_pnl, 2),
            "from_gamma": round(total_gamma_pnl, 2),
            "total": round(total_pnl, 2),
            "vega_pct": round(vega_pct, 2),
            "delta_pct": round((total_delta_pnl / total_pnl * 100) if total_pnl != 0 else 0.0, 2),
            "gamma_pct": round((total_gamma_pnl / total_pnl * 100) if total_pnl != 0 else 0.0, 2),
        },
        "trade_counts": {
            "up_markets": len(up_trades),
            "down_markets": len(down_trades),
            "flat_markets": len(flat_trades),
            "total": len(df),
        }
    }
