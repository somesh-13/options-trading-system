"""VolatilityAgent — wraps the existing IV vs HV mispricing computation.

Delegates to ``data.market_data.detect_mispricing`` and maps its
``iv_hv_ratio`` to an IV regime (LOW / NORMAL / HIGH) using the same
thresholds already baked into the rule-based signal system (0.8 / 1.3).
"""

from __future__ import annotations

import asyncio
from typing import Tuple

from agents.base import AgentSignal, AnalysisContext, BaseAgent
from data.market_data import detect_mispricing


class VolatilityAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__(
            agent_id="volatility",
            name="VolatilityAgent",
            domain="IV vs HV",
            weight=0.25,
        )

    async def analyze(self, ticker: str, context: AnalysisContext) -> AgentSignal:
        data = await asyncio.to_thread(detect_mispricing, ticker)

        ratio: float = float(data["iv_hv_ratio"])
        regime, confidence = self._classify(ratio)

        reasoning = (
            f"IV/HV = {ratio:.2f}. Regime {regime} "
            f"(IV {data['implied_vol_atm']:.2%} vs HV {data['historical_vol']:.2%})."
        )

        return self._signal(
            ticker=ticker,
            signal_type="IV_REGIME",
            confidence=confidence,
            reasoning=reasoning,
            data_sources=["market_data.detect_mispricing"],
            metadata={
                "iv_regime": regime,
                "iv_hv_ratio": ratio,
                "implied_vol_atm": float(data["implied_vol_atm"]),
                "historical_vol": float(data["historical_vol"]),
                "spot_price": float(data["spot_price"]),
                "atm_strike": float(data["atm_strike"]),
            },
        )

    @staticmethod
    def _classify(ratio: float) -> Tuple[str, float]:
        """Map IV/HV ratio to (regime, confidence).

        Thresholds mirror the existing rule engine:
        - ratio < 0.8  → LOW  (IV cheap, favors long premium)
        - ratio > 1.3  → HIGH (IV rich, favors short premium)
        - otherwise    → NORMAL

        Confidence scales with distance from the 1.0 parity line, capped at 1.0.
        """
        if ratio < 0.8:
            regime = "LOW"
            confidence = min(1.0, (0.8 - ratio) / 0.4 + 0.5)
        elif ratio > 1.3:
            regime = "HIGH"
            confidence = min(1.0, (ratio - 1.3) / 0.5 + 0.5)
        else:
            regime = "NORMAL"
            confidence = 0.3 + (1 - abs(ratio - 1.0) / 0.3) * 0.2
        return regime, float(confidence)
