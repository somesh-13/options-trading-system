"""
Historical Volatility with Confidence Intervals

Uses bootstrap resampling to provide confidence intervals on HV estimates.
Also implements Parkinson volatility estimator using high/low prices.
"""

import numpy as np
import yfinance as yf
from typing import Dict

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))


def hv_with_confidence(
    ticker: str,
    window: int = 30,
    confidence: float = 0.95,
    n_bootstrap: int = 1000
) -> Dict:
    """
    Calculate historical volatility with bootstrap confidence intervals.

    Args:
        ticker: Stock symbol
        window: Rolling window in days
        confidence: Confidence level (e.g. 0.95 for 95% CI)
        n_bootstrap: Number of bootstrap iterations

    Returns:
        {
            hv: float, ci_lower: float, ci_upper: float,
            confidence: float, parkinson_hv: float,
            ci_width: float, reliable: bool
        }
    """
    stock = yf.Ticker(ticker)
    hist = stock.history(period=f"{window + 30}d")

    if len(hist) < window:
        raise ValueError(f"Insufficient data: need {window} days, got {len(hist)}")

    # Calculate log returns
    returns = np.log(hist['Close'] / hist['Close'].shift(1)).dropna().values

    # Use last 'window' returns
    returns = returns[-window:]

    # Point estimate: annualized volatility
    hv = float(np.std(returns) * np.sqrt(252))

    # Bootstrap confidence interval
    bootstrap_hvs = []
    rng = np.random.default_rng(42)
    for _ in range(n_bootstrap):
        sample = rng.choice(returns, size=len(returns), replace=True)
        bootstrap_hv = np.std(sample) * np.sqrt(252)
        bootstrap_hvs.append(bootstrap_hv)

    bootstrap_hvs = np.array(bootstrap_hvs)
    alpha = 1 - confidence
    ci_lower = float(np.percentile(bootstrap_hvs, alpha / 2 * 100))
    ci_upper = float(np.percentile(bootstrap_hvs, (1 - alpha / 2) * 100))

    # Parkinson volatility (high-low estimator)
    highs = hist['High'].values[-window:]
    lows = hist['Low'].values[-window:]
    parkinson_hv = parkinson_volatility(highs, lows)

    ci_width = ci_upper - ci_lower
    # If CI is wider than 50% of HV, signal is unreliable
    reliable = ci_width < (hv * 0.5) if hv > 0 else False

    return {
        'ticker': ticker,
        'hv': round(hv, 4),
        'ci_lower': round(ci_lower, 4),
        'ci_upper': round(ci_upper, 4),
        'confidence': confidence,
        'parkinson_hv': round(parkinson_hv, 4),
        'ci_width': round(ci_width, 4),
        'reliable': reliable,
        'window': window
    }


def parkinson_volatility(highs: np.ndarray, lows: np.ndarray) -> float:
    """
    Parkinson volatility estimator using high/low prices.
    More efficient than close-to-close estimator as it uses intraday range.

    Formula: sigma = sqrt(1/(4*n*ln(2)) * sum(ln(H/L)^2)) * sqrt(252)
    """
    n = len(highs)
    if n == 0:
        return 0.0

    log_hl = np.log(highs / lows)
    variance = (1 / (4 * n * np.log(2))) * np.sum(log_hl ** 2)

    return float(np.sqrt(variance) * np.sqrt(252))
