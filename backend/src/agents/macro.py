"""MacroAgent — VIX + yield-curve macro stance.

Roadmap §3.3 suggests wrapping Gemini for Fed / VIX / yield-curve analysis.
We start with a deterministic, free-data version (yfinance ^VIX + ^TNX/^IRX
yield-curve slope); a Gemini narrative layer can be added later without
changing the agent contract.
"""

from __future__ import annotations

import asyncio
from typing import Optional

from agents.base import AgentSignal, AnalysisContext, BaseAgent
from data.market_provider import get_history


class MacroAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__(
            agent_id="macro",
            name="MacroAgent",
            domain="VIX + yield curve",
            weight=0.10,
        )

    async def analyze(self, ticker: str, context: AnalysisContext) -> AgentSignal:
        payload = await asyncio.to_thread(self._compute)

        vix = payload["vix"]
        slope = payload["yield_slope"]
        stance = self._stance(vix, slope)
        confidence = payload["confidence"]

        reasoning = (
            f"VIX={vix:.1f}; 10Y-3M slope={slope:+.2f}pp → {stance}."
            if vix is not None and slope is not None
            else "Macro data unavailable; defaulting to NEUTRAL."
        )

        return self._signal(
            ticker=ticker,
            signal_type="MACRO_STANCE",
            confidence=confidence,
            reasoning=reasoning,
            data_sources=["yfinance:^VIX", "yfinance:^TNX", "yfinance:^IRX"],
            metadata={
                "macro_stance": stance,
                "vix": vix,
                "yield_slope_pp": slope,
            },
        )

    @staticmethod
    def _compute() -> dict:
        vix = MacroAgent._latest("^VIX")
        tnx = MacroAgent._latest("^TNX")  # 10Y yield (in tenths of a percent)
        irx = MacroAgent._latest("^IRX")  # 3M T-bill

        slope: Optional[float] = None
        if tnx is not None and irx is not None:
            slope = float(tnx) - float(irx)

        confidence = 0.7 if vix is not None and slope is not None else 0.3
        return {"vix": vix, "yield_slope": slope, "confidence": confidence}

    @staticmethod
    def _latest(symbol: str) -> Optional[float]:
        try:
            bars = get_history(symbol, period="5d")
            if not bars:
                return None
            return float(bars[-1].close)
        except Exception:
            return None

    @staticmethod
    def _stance(vix: Optional[float], slope: Optional[float]) -> str:
        if vix is None or slope is None:
            return "NEUTRAL"
        if vix >= 25 or slope < -0.5:
            return "RISK_OFF"
        if vix <= 15 and slope > 0:
            return "RISK_ON"
        return "NEUTRAL"
