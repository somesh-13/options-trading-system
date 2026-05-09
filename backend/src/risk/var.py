"""Value at Risk (VaR) Module - Multi-method VaR calculation.

Implements:
- Historical VaR (95th/99th percentile)
- Parametric VaR (normal distribution assumption)
- Monte Carlo VaR (simulation-based)
- Conditional VaR (Expected Shortfall)
"""

import numpy as np
import pandas as pd
from scipy.stats import norm
from typing import Optional

from data.market_provider import get_history, history_to_dataframe


def historical_var(
    ticker: str,
    portfolio_value: float = 100000.0,
    confidence: float = 0.95,
    lookback_days: int = 252,
    holding_period: int = 1,
) -> dict:
    """Calculate Historical VaR using past returns.

    Args:
        ticker: Stock ticker symbol
        portfolio_value: Total portfolio value
        confidence: Confidence level (0.95 or 0.99)
        lookback_days: Number of historical days
        holding_period: Holding period in days

    Returns:
        VaR metrics dict
    """
    bars = get_history(ticker, period=f"{lookback_days + 30}d")
    if len(bars) < 30:
        return {"error": "Insufficient data", "ticker": ticker}
    hist = history_to_dataframe(bars)

    prices = hist["Close"].tail(lookback_days)
    daily_returns = np.log(prices / prices.shift(1)).dropna().values

    # Scale to holding period
    if holding_period > 1:
        period_returns = []
        for i in range(len(daily_returns) - holding_period + 1):
            period_returns.append(np.sum(daily_returns[i:i + holding_period]))
        returns = np.array(period_returns)
    else:
        returns = daily_returns

    # Historical VaR = percentile of loss distribution
    var_pct = np.percentile(returns, (1 - confidence) * 100)
    var_dollars = abs(var_pct) * portfolio_value

    # Conditional VaR (Expected Shortfall) = average of losses beyond VaR
    tail_losses = returns[returns <= var_pct]
    cvar_pct = np.mean(tail_losses) if len(tail_losses) > 0 else var_pct
    cvar_dollars = abs(cvar_pct) * portfolio_value

    return {
        "method": "historical",
        "ticker": ticker,
        "confidence": confidence,
        "holding_period_days": holding_period,
        "var_pct": round(float(abs(var_pct)) * 100, 4),
        "var_dollars": round(float(var_dollars), 2),
        "cvar_pct": round(float(abs(cvar_pct)) * 100, 4),
        "cvar_dollars": round(float(cvar_dollars), 2),
        "portfolio_value": portfolio_value,
        "lookback_days": lookback_days,
        "observations": len(returns),
        "mean_return_pct": round(float(np.mean(returns)) * 100, 4),
        "volatility_pct": round(float(np.std(returns)) * 100, 4),
        "worst_day_pct": round(float(np.min(returns)) * 100, 4),
        "best_day_pct": round(float(np.max(returns)) * 100, 4),
    }


def parametric_var(
    ticker: str,
    portfolio_value: float = 100000.0,
    confidence: float = 0.95,
    lookback_days: int = 252,
    holding_period: int = 1,
) -> dict:
    """Calculate Parametric VaR assuming normal distribution.

    VaR = z * sigma * sqrt(holding_period) * portfolio_value
    """
    bars = get_history(ticker, period=f"{lookback_days + 30}d")
    if len(bars) < 30:
        return {"error": "Insufficient data", "ticker": ticker}
    hist = history_to_dataframe(bars)

    prices = hist["Close"].tail(lookback_days)
    daily_returns = np.log(prices / prices.shift(1)).dropna().values

    mu = np.mean(daily_returns)
    sigma = np.std(daily_returns)

    z = norm.ppf(1 - confidence)  # Negative z-score for VaR
    var_pct = abs(z * sigma * np.sqrt(holding_period))
    var_dollars = var_pct * portfolio_value

    # Parametric CVaR
    cvar_multiplier = norm.pdf(norm.ppf(1 - confidence)) / (1 - confidence)
    cvar_pct = sigma * np.sqrt(holding_period) * cvar_multiplier
    cvar_dollars = cvar_pct * portfolio_value

    return {
        "method": "parametric",
        "ticker": ticker,
        "confidence": confidence,
        "holding_period_days": holding_period,
        "var_pct": round(float(var_pct) * 100, 4),
        "var_dollars": round(float(var_dollars), 2),
        "cvar_pct": round(float(cvar_pct) * 100, 4),
        "cvar_dollars": round(float(cvar_dollars), 2),
        "portfolio_value": portfolio_value,
        "z_score": round(float(abs(z)), 4),
        "daily_mean_pct": round(float(mu) * 100, 6),
        "daily_vol_pct": round(float(sigma) * 100, 4),
        "annualized_vol_pct": round(float(sigma * np.sqrt(252)) * 100, 4),
    }


def monte_carlo_var(
    ticker: str,
    portfolio_value: float = 100000.0,
    confidence: float = 0.95,
    lookback_days: int = 252,
    holding_period: int = 1,
    n_simulations: int = 10000,
) -> dict:
    """Calculate Monte Carlo VaR using simulated price paths.

    Generates random returns from fitted distribution and computes VaR
    from the simulated P&L distribution.
    """
    bars = get_history(ticker, period=f"{lookback_days + 30}d")
    if len(bars) < 30:
        return {"error": "Insufficient data", "ticker": ticker}
    hist = history_to_dataframe(bars)

    prices = hist["Close"].tail(lookback_days)
    daily_returns = np.log(prices / prices.shift(1)).dropna().values

    mu = np.mean(daily_returns)
    sigma = np.std(daily_returns)

    # Simulate returns
    np.random.seed(None)  # Use truly random seed
    simulated_returns = np.random.normal(mu, sigma, (n_simulations, holding_period))
    period_returns = np.sum(simulated_returns, axis=1)

    # VaR from simulated distribution
    var_pct = abs(np.percentile(period_returns, (1 - confidence) * 100))
    var_dollars = var_pct * portfolio_value

    # CVaR
    threshold = np.percentile(period_returns, (1 - confidence) * 100)
    tail = period_returns[period_returns <= threshold]
    cvar_pct = abs(np.mean(tail)) if len(tail) > 0 else var_pct
    cvar_dollars = cvar_pct * portfolio_value

    return {
        "method": "monte_carlo",
        "ticker": ticker,
        "confidence": confidence,
        "holding_period_days": holding_period,
        "var_pct": round(float(var_pct) * 100, 4),
        "var_dollars": round(float(var_dollars), 2),
        "cvar_pct": round(float(cvar_pct) * 100, 4),
        "cvar_dollars": round(float(cvar_dollars), 2),
        "portfolio_value": portfolio_value,
        "n_simulations": n_simulations,
        "sim_mean_pct": round(float(np.mean(period_returns)) * 100, 4),
        "sim_std_pct": round(float(np.std(period_returns)) * 100, 4),
        "sim_worst_pct": round(float(np.min(period_returns)) * 100, 4),
    }


def comprehensive_var(
    ticker: str,
    portfolio_value: float = 100000.0,
    confidence: float = 0.95,
    holding_period: int = 1,
) -> dict:
    """Run all three VaR methods and return comparison."""
    hist_var = historical_var(ticker, portfolio_value, confidence, holding_period=holding_period)
    param_var = parametric_var(ticker, portfolio_value, confidence, holding_period=holding_period)
    mc_var = monte_carlo_var(ticker, portfolio_value, confidence, holding_period=holding_period)

    return {
        "ticker": ticker,
        "portfolio_value": portfolio_value,
        "confidence": confidence,
        "holding_period_days": holding_period,
        "historical": hist_var,
        "parametric": param_var,
        "monte_carlo": mc_var,
        "summary": {
            "avg_var_dollars": round(
                np.mean([
                    hist_var.get("var_dollars", 0),
                    param_var.get("var_dollars", 0),
                    mc_var.get("var_dollars", 0),
                ]), 2
            ),
            "max_var_dollars": round(
                max(
                    hist_var.get("var_dollars", 0),
                    param_var.get("var_dollars", 0),
                    mc_var.get("var_dollars", 0),
                ), 2
            ),
            "recommendation": "Conservative: use highest VaR estimate for risk limits",
        },
    }
