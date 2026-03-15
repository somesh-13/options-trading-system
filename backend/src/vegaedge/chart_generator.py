"""
Keltner-style channel chart generator for VegaEdge.
Produces PNG (base64) and channel_position for multimodal output.
"""

import base64
import io
from typing import Tuple

import numpy as np
import pandas as pd
import yfinance as yf

# Matplotlib only when generating
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


def _ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def _atr(high: pd.Series, low: pd.Series, close: pd.Series, span: int = 14) -> pd.Series:
    tr1 = high - low
    tr2 = (high - close.shift(1)).abs()
    tr3 = (low - close.shift(1)).abs()
    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    return tr.ewm(span=span, adjust=False).mean()


def _channel_position(price: float, lower: float, upper: float) -> str:
    """Return BOTTOM, TOP, or MIDDLE based on price vs bands."""
    if upper <= lower:
        return "MIDDLE"
    band_range = upper - lower
    pct = (price - lower) / band_range if band_range > 0 else 0.5
    if pct <= 0.25:
        return "BOTTOM"
    if pct >= 0.75:
        return "TOP"
    return "MIDDLE"


def generate_keltner_chart(ticker: str, period: str = "6mo") -> Tuple[str, str]:
    """
    Generate Keltner-style channel chart (EMA middle, ATR bands).
    Returns (base64_png_string, channel_position).
    """
    stock = yf.Ticker(ticker)
    hist = stock.history(period=period)

    if hist is None or len(hist) < 20:
        # Return a minimal placeholder or raise
        raise ValueError(f"Insufficient history for {ticker} (need at least 20 bars)")

    close = hist["Close"]
    high = hist["High"]
    low = hist["Low"]

    span = 20
    mult = 2.0
    middle = _ema(close, span)
    atr_series = _atr(high, low, close, span=14)
    upper = middle + mult * atr_series
    lower = middle - mult * atr_series

    current_price = float(close.iloc[-1])
    current_lower = float(lower.iloc[-1])
    current_upper = float(upper.iloc[-1])
    channel_pos = _channel_position(current_price, current_lower, current_upper)

    fig, ax = plt.subplots(figsize=(10, 5))
    fig.patch.set_facecolor("#1E1E1E")
    ax.set_facecolor("#1E1E1E")

    ax.plot(close.index, close.values, color="#00C805", linewidth=2, label="Price")
    ax.plot(middle.index, middle.values, color="#FFD700", linewidth=1, alpha=0.9, label="Middle (EMA)")
    ax.plot(upper.index, upper.values, color="#FF006E", linewidth=1, alpha=0.7, linestyle="--", label="Upper")
    ax.plot(lower.index, lower.values, color="#00C805", linewidth=1, alpha=0.7, linestyle="--", label="Lower")

    ax.axhline(y=current_price, color="white", linestyle=":", alpha=0.5)
    ax.set_title(f"{ticker} – Keltner-style channel (position: {channel_pos})", color="white", fontsize=12)
    ax.set_xlabel("Date", color="gray")
    ax.set_ylabel("Price", color="gray")
    ax.tick_params(colors="gray")
    ax.legend(loc="upper left", facecolor="#2D2D2D", edgecolor="gray", labelcolor="white", fontsize=8)
    ax.spines["bottom"].set_color("gray")
    ax.spines["top"].set_color("gray")
    ax.spines["left"].set_color("gray")
    ax.spines["right"].set_color("gray")
    plt.tight_layout()

    buf = io.BytesIO()
    plt.savefig(buf, format="png", dpi=100, bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    b64 = base64.b64encode(buf.read()).decode("utf-8")
    return b64, channel_pos
