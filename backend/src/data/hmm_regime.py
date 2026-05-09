"""
HMM Regime Detection

Uses Hidden Markov Models to detect market volatility regimes.
Classifies current market state as Low Vol, Medium Vol, or High Vol.
"""

import numpy as np
from typing import Dict

import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))

from data.market_provider import get_history, history_to_dataframe


def fit_regime_model(
    ticker: str,
    n_regimes: int = 3,
    lookback_days: int = 120
) -> Dict:
    """
    Fit a Gaussian HMM to detect volatility regimes.

    Args:
        ticker: Stock symbol
        n_regimes: Number of regimes (default 3: low, medium, high vol)
        lookback_days: Days of history to use for fitting

    Returns:
        Dict with regime info, model parameters, and current state
    """
    try:
        from hmmlearn.hmm import GaussianHMM
    except ImportError:
        return {
            'ticker': ticker,
            'error': 'hmmlearn not installed',
            'regime': 'Unknown',
            'probability': 0.0,
            'regime_means': [],
            'regime_vols': []
        }

    bars = get_history(ticker, period=f"{lookback_days + 10}d")
    if len(bars) < 30:
        raise ValueError(f"Insufficient data for {ticker}")
    hist = history_to_dataframe(bars)

    # Calculate log returns
    returns = np.log(hist['Close'] / hist['Close'].shift(1)).dropna().values
    returns = returns.reshape(-1, 1)

    # Fit HMM
    model = GaussianHMM(
        n_components=n_regimes,
        covariance_type="full",
        n_iter=100,
        random_state=42
    )
    model.fit(returns)

    # Get hidden states
    hidden_states = model.predict(returns)
    state_probs = model.predict_proba(returns)

    # Current state
    current_state = int(hidden_states[-1])
    current_probs = state_probs[-1].tolist()

    # Extract regime parameters
    means = model.means_.flatten().tolist()
    vols = [float(np.sqrt(model.covars_[i][0][0])) for i in range(n_regimes)]

    # Sort regimes by volatility (ascending) and relabel
    sorted_indices = np.argsort(vols)
    regime_labels = ["Low Vol", "Medium Vol", "High Vol"]
    if n_regimes == 2:
        regime_labels = ["Low Vol", "High Vol"]
    elif n_regimes > 3:
        regime_labels = [f"Regime {i+1}" for i in range(n_regimes)]

    # Map current state to sorted label
    current_sorted_idx = int(np.where(sorted_indices == current_state)[0][0])
    current_regime = regime_labels[current_sorted_idx] if current_sorted_idx < len(regime_labels) else f"Regime {current_sorted_idx}"

    sorted_means = [means[i] for i in sorted_indices]
    sorted_vols = [vols[i] for i in sorted_indices]
    sorted_probs = [current_probs[i] for i in sorted_indices]

    return {
        'ticker': ticker,
        'regime': current_regime,
        'probability': round(max(current_probs), 4),
        'regime_means': [round(m * 252, 4) for m in sorted_means],  # annualize
        'regime_vols': [round(v * np.sqrt(252), 4) for v in sorted_vols],  # annualize
        'regime_probs': [round(p, 4) for p in sorted_probs],
        'regime_labels': regime_labels[:n_regimes],
        'n_regimes': n_regimes,
        'lookback_days': lookback_days
    }


def detect_current_regime(ticker: str) -> Dict:
    """
    Quick function to detect current market regime.

    Returns:
        {regime: str, probability: float, regime_means: [], regime_vols: []}
    """
    return fit_regime_model(ticker, n_regimes=3, lookback_days=120)
