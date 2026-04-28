"""ConfluenceEngine — the orchestration core.

Runs all agents via ``asyncio.gather``, computes a weighted consensus score,
and emits a ``ConfluenceResult``. Trades fire only when score ≥ threshold.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence

from pydantic import BaseModel, Field

from agents.base import AgentSignal, AnalysisContext, BaseAgent

log = logging.getLogger(__name__)


class ConfluenceResult(BaseModel):
    ticker: str
    confluence_score: float = Field(..., ge=0.0, le=1.0)
    recommended_strategy: Optional[str]
    agent_signals: List[AgentSignal]
    reasoning: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class ConfluenceEngine:
    def __init__(
        self,
        agents: Sequence[BaseAgent],
        threshold: float = 0.65,
    ) -> None:
        if not agents:
            raise ValueError("ConfluenceEngine requires at least one agent")
        self.agents: List[BaseAgent] = list(agents)
        self.threshold: float = float(threshold)

    async def analyze(self, ticker: str) -> ConfluenceResult:
        ticker = ticker.upper().strip()
        context = self._build_context(ticker)

        tasks = [self._safe_run(agent, ticker, context) for agent in self.agents]
        signals: List[AgentSignal] = await asyncio.gather(*tasks)

        score = self._weighted_score(signals)
        by_id: Dict[str, AgentSignal] = {s.agent_id: s for s in signals}
        iv_regime = by_id.get("volatility", None)
        technical = by_id.get("technical", None)

        iv_regime_val = (iv_regime.metadata.get("iv_regime") if iv_regime else None)
        keltner_val = (technical.metadata.get("keltner_position") if technical else None)

        strategy = self._recommend_strategy(iv_regime_val, keltner_val, score)
        return ConfluenceResult(
            ticker=ticker,
            confluence_score=round(score, 4),
            recommended_strategy=strategy if score >= self.threshold else None,
            agent_signals=signals,
            reasoning=self._build_reasoning(signals, score, strategy),
        )

    def _build_context(self, ticker: str) -> AnalysisContext:
        """Construct per-request context, hydrating memory via the P5 memory layer."""
        memory_summary = ""
        memory_count = 0
        avg_quality = 0.0
        per_agent: Dict[str, Dict[str, Any]] = {}

        try:
            from agents.memory import summarize_for_context

            for agent in self.agents:
                packet = summarize_for_context(agent.agent_id, ticker, limit=5)
                if packet["count"]:
                    per_agent[agent.agent_id] = packet
            if per_agent:
                memory_count = sum(p["count"] for p in per_agent.values())
                avg_quality = round(
                    sum(p["avg_quality"] * p["count"] for p in per_agent.values())
                    / max(memory_count, 1),
                    4,
                )
                memory_summary = "\n".join(
                    f"[{agent_id}]\n{packet['summary']}" for agent_id, packet in per_agent.items()
                )
        except Exception:  # noqa: BLE001 — memory is best-effort
            log.exception("memory hydration failed")

        ctx = AnalysisContext(ticker=ticker)
        ctx.memory_summary = memory_summary
        ctx.memory_count = memory_count
        ctx.avg_quality = avg_quality
        ctx.extras["memory_by_agent"] = per_agent
        return ctx

    async def _safe_run(
        self, agent: BaseAgent, ticker: str, context: AnalysisContext
    ) -> AgentSignal:
        try:
            return await agent.analyze(ticker, context)
        except Exception as exc:  # noqa: BLE001 — agent errors must not break confluence
            log.exception("Agent %s failed for %s", agent.agent_id, ticker)
            return AgentSignal(
                agent_id=agent.agent_id,
                ticker=ticker,
                signal_type="ERROR",
                confidence=0.0,
                reasoning=f"{type(exc).__name__}: {exc}",
                data_sources=[],
                metadata={"error": True},
            )

    def _weighted_score(self, signals: Sequence[AgentSignal]) -> float:
        by_id = {s.agent_id: s for s in signals}
        total = 0.0
        weight_sum = 0.0
        for agent in self.agents:
            sig = by_id.get(agent.agent_id)
            if sig is None or sig.signal_type == "ERROR":
                continue
            total += sig.confidence * agent.weight
            weight_sum += agent.weight
        if weight_sum == 0:
            return 0.0
        return total / weight_sum

    @staticmethod
    def _recommend_strategy(
        iv_regime: Optional[str],
        keltner: Optional[str],
        score: float,
    ) -> str:
        if iv_regime == "LOW" and keltner == "BOTTOM":
            return "BUY_LEAP"
        if iv_regime == "HIGH" and keltner == "BOTTOM":
            return "SELL_CSP"
        if iv_regime == "HIGH" and keltner == "TOP":
            return "SELL_COVERED_CALL"
        return "HOLD"

    def _build_reasoning(
        self,
        signals: Sequence[AgentSignal],
        score: float,
        strategy: str,
    ) -> str:
        bits = [f"[{s.agent_id}] {s.reasoning}" for s in signals]
        prefix = (
            f"Confluence {score:.2f} (threshold {self.threshold:.2f}) → "
            f"{strategy if score >= self.threshold else 'no trade'}. "
        )
        return prefix + " | ".join(bits)


def build_default_engine() -> ConfluenceEngine:
    """Construct a ConfluenceEngine with all six specialized agents."""
    from agents.earnings import EarningsAgent
    from agents.macro import MacroAgent
    from agents.regime import RegimeAgent
    from agents.sentiment import SentimentAgent
    from agents.technical import TechnicalAgent
    from agents.volatility import VolatilityAgent

    return ConfluenceEngine(
        agents=[
            VolatilityAgent(),
            TechnicalAgent(),
            SentimentAgent(),
            EarningsAgent(),
            RegimeAgent(),
            MacroAgent(),
        ],
        threshold=0.65,
    )
