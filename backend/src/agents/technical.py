"""TechnicalAgent — wraps Keltner channel position + RSI.

Reuses ``vegaedge.chart_generator._channel_position`` logic (EMA-20, ATR-20,
multiplier=2.0) to classify price as BOTTOM / MIDDLE / TOP, and adds a 14-day
RSI for trend direction.
"""

from __future__ import annotations

import asyncio
from typing import Tuple

import numpy as np
import pandas as pd

from agents.base import AgentSignal, AnalysisContext, BaseAgent
from data.market_provider import get_history, history_to_dataframe


class TechnicalAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__(
            agent_id="technical",
            name="TechnicalAgent",
            domain="Keltner + RSI",
            weight=0.20,
        )

    async def analyze(self, ticker: str, context: AnalysisContext) -> AgentSignal:
        payload = await asyncio.to_thread(self._compute, ticker)
        position = payload["keltner_position"]
        rsi = payload["rsi"]

        confidence = self._confidence(position, rsi)
        trend = "UP" if rsi > 55 else "DOWN" if rsi < 45 else "FLAT"

        reasoning = (
            f"Price at Keltner {position}; RSI(14)={rsi:.1f} ({trend}); "
            f"price {payload['price']:.2f} vs band [{payload['lower']:.2f}, {payload['upper']:.2f}]."
        )

        return self._signal(
            ticker=ticker,
            signal_type="KELTNER_POSITION",
            confidence=confidence,
            reasoning=reasoning,
            data_sources=["yfinance.history(6mo)"],
            metadata={
                "keltner_position": position,
                "trend_direction": trend,
                "rsi": rsi,
                "price": payload["price"],
                "upper_band": payload["upper"],
                "lower_band": payload["lower"],
                "ema_20": payload["ema"],
            },
        )

    @staticmethod
    def _compute(ticker: str) -> dict:
        bars = get_history(ticker, period="6mo")
        if not bars or len(bars) < 25:
            raise ValueError(f"Insufficient data for {ticker}")
        hist = history_to_dataframe(bars)

        close = hist["Close"]
        high = hist["High"]
        low = hist["Low"]
        ema = close.ewm(span=20, adjust=False).mean()

        tr1 = (high - low).abs()
        tr2 = (high - close.shift(1)).abs()
        tr3 = (low - close.shift(1)).abs()
        tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
        atr = tr.ewm(span=20, adjust=False).mean()

        upper = ema + 2.0 * atr
        lower = ema - 2.0 * atr

        price = float(close.iloc[-1])
        upper_v = float(upper.iloc[-1])
        lower_v = float(lower.iloc[-1])
        ema_v = float(ema.iloc[-1])

        position = TechnicalAgent._channel_position(price, lower_v, upper_v)
        rsi = TechnicalAgent._rsi(close, period=14)

        return {
            "keltner_position": position,
            "rsi": rsi,
            "price": price,
            "upper": upper_v,
            "lower": lower_v,
            "ema": ema_v,
        }

    @staticmethod
    def _channel_position(price: float, lower: float, upper: float) -> str:
        if upper <= lower:
            return "MIDDLE"
        pct = (price - lower) / (upper - lower)
        if pct <= 0.25:
            return "BOTTOM"
        if pct >= 0.75:
            return "TOP"
        return "MIDDLE"

    @staticmethod
    def _rsi(close: pd.Series, period: int = 14) -> float:
        delta = close.diff().dropna()
        gain = delta.where(delta > 0, 0.0)
        loss = (-delta).where(delta < 0, 0.0)
        avg_gain = gain.ewm(alpha=1.0 / period, adjust=False).mean()
        avg_loss = loss.ewm(alpha=1.0 / period, adjust=False).mean()
        rs = avg_gain / avg_loss.replace(0, np.nan)
        rsi_series = 100 - (100 / (1 + rs))
        value = rsi_series.iloc[-1]
        if pd.isna(value):
            return 50.0
        return float(value)

    @staticmethod
    def _confidence(position: str, rsi: float) -> float:
        base = 0.5 if position == "MIDDLE" else 0.75
        extreme = (rsi < 30) or (rsi > 70)
        return min(1.0, base + (0.15 if extreme else 0.0))
