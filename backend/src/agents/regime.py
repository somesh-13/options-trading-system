"""RegimeAgent — wraps HMM regime detection.

Maps the existing 3-state HMM (Low/Medium/High Vol) plus the average annualized
return of the current regime onto BULL / BEAR / SIDEWAYS / VOLATILE.
"""

from __future__ import annotations

import asyncio

from agents.base import AgentSignal, AnalysisContext, BaseAgent
from data.hmm_regime import fit_regime_model


class RegimeAgent(BaseAgent):
    def __init__(self) -> None:
        super().__init__(
            agent_id="regime",
            name="RegimeAgent",
            domain="HMM volatility regime",
            weight=0.15,
        )

    async def analyze(self, ticker: str, context: AnalysisContext) -> AgentSignal:
        payload = await asyncio.to_thread(fit_regime_model, ticker, 3, 120)

        if payload.get("error"):
            return self._signal(
                ticker=ticker,
                signal_type="MARKET_REGIME",
                confidence=0.1,
                reasoning=f"HMM unavailable: {payload['error']}",
                data_sources=["hmm_regime"],
                metadata={"market_regime": "UNKNOWN", "regime_confidence": 0.0},
            )

        probability = float(payload["probability"])
        labels = payload.get("regime_labels") or []
        current = str(payload["regime"])
        means = payload.get("regime_means") or []

        # Find the index of the current regime to pull its annualized mean return.
        idx = labels.index(current) if current in labels else -1
        mean_ret = float(means[idx]) if 0 <= idx < len(means) else 0.0

        regime = self._map(current, mean_ret)

        reasoning = (
            f"HMM current state {current} (p={probability:.2f}), "
            f"annualized mean {mean_ret:+.2%} → {regime}."
        )

        return self._signal(
            ticker=ticker,
            signal_type="MARKET_REGIME",
            confidence=probability,
            reasoning=reasoning,
            data_sources=["hmm_regime.fit_regime_model"],
            metadata={
                "market_regime": regime,
                "regime_confidence": probability,
                "hmm_state": current,
                "annualized_mean": mean_ret,
            },
        )

    @staticmethod
    def _map(hmm_state: str, mean_return: float) -> str:
        if hmm_state == "High Vol":
            return "VOLATILE"
        if mean_return > 0.10:
            return "BULL"
        if mean_return < -0.10:
            return "BEAR"
        return "SIDEWAYS"
