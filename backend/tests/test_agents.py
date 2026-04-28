"""P1 integration tests for the multi-agent orchestrator.

Uses stub agents so tests run offline — no yfinance, no HMM, no NLP.
Verifies weighted-score math, strategy selection, and fault isolation.
"""

import asyncio
from typing import Dict

import pytest

from agents.base import AgentSignal, AnalysisContext, BaseAgent
from agents.confluence import ConfluenceEngine


class _StubAgent(BaseAgent):
    def __init__(
        self,
        agent_id: str,
        weight: float,
        confidence: float,
        signal_type: str = "STUB",
        metadata: Dict | None = None,
        raises: Exception | None = None,
    ) -> None:
        super().__init__(agent_id=agent_id, name=agent_id, domain="test", weight=weight)
        self._confidence = confidence
        self._signal_type = signal_type
        self._metadata = metadata or {}
        self._raises = raises

    async def analyze(self, ticker: str, context: AnalysisContext) -> AgentSignal:
        if self._raises is not None:
            raise self._raises
        return self._signal(
            ticker=ticker,
            signal_type=self._signal_type,
            confidence=self._confidence,
            reasoning=f"stub {self.agent_id}",
            metadata=self._metadata,
        )


@pytest.mark.asyncio
async def test_weighted_score_matches_manual_calculation():
    # weights 0.5 * conf 0.8 + 0.5 * conf 0.4 = 0.6
    engine = ConfluenceEngine(
        agents=[
            _StubAgent("a", weight=0.5, confidence=0.8),
            _StubAgent("b", weight=0.5, confidence=0.4),
        ],
        threshold=0.65,
    )
    result = await engine.analyze("NVDA")
    assert result.confluence_score == pytest.approx(0.6, abs=1e-6)
    assert result.recommended_strategy is None  # below threshold


@pytest.mark.asyncio
async def test_threshold_gating():
    engine = ConfluenceEngine(
        agents=[_StubAgent("a", weight=1.0, confidence=0.9)],
        threshold=0.65,
    )
    result = await engine.analyze("NVDA")
    assert result.confluence_score == pytest.approx(0.9, abs=1e-6)
    assert result.recommended_strategy == "HOLD"  # no iv_regime/keltner → HOLD


@pytest.mark.asyncio
async def test_strategy_selection_buy_leap():
    engine = ConfluenceEngine(
        agents=[
            _StubAgent(
                "volatility", weight=0.5, confidence=0.9,
                metadata={"iv_regime": "LOW"},
            ),
            _StubAgent(
                "technical", weight=0.5, confidence=0.9,
                metadata={"keltner_position": "BOTTOM"},
            ),
        ],
        threshold=0.65,
    )
    result = await engine.analyze("HOOD")
    assert result.recommended_strategy == "BUY_LEAP"


@pytest.mark.asyncio
async def test_strategy_selection_sell_csp():
    engine = ConfluenceEngine(
        agents=[
            _StubAgent("volatility", weight=0.5, confidence=0.9,
                       metadata={"iv_regime": "HIGH"}),
            _StubAgent("technical", weight=0.5, confidence=0.9,
                       metadata={"keltner_position": "BOTTOM"}),
        ],
        threshold=0.65,
    )
    result = await engine.analyze("CIFR")
    assert result.recommended_strategy == "SELL_CSP"


@pytest.mark.asyncio
async def test_strategy_selection_sell_covered_call():
    engine = ConfluenceEngine(
        agents=[
            _StubAgent("volatility", weight=0.5, confidence=0.9,
                       metadata={"iv_regime": "HIGH"}),
            _StubAgent("technical", weight=0.5, confidence=0.9,
                       metadata={"keltner_position": "TOP"}),
        ],
        threshold=0.65,
    )
    result = await engine.analyze("WULF")
    assert result.recommended_strategy == "SELL_COVERED_CALL"


@pytest.mark.asyncio
async def test_failing_agent_does_not_break_engine():
    engine = ConfluenceEngine(
        agents=[
            _StubAgent("volatility", weight=0.5, confidence=0.9,
                       metadata={"iv_regime": "LOW"}),
            _StubAgent("technical", weight=0.5, confidence=0.0,
                       raises=RuntimeError("boom")),
        ],
        threshold=0.0,
    )
    result = await engine.analyze("PYPL")
    assert len(result.agent_signals) == 2
    error_sigs = [s for s in result.agent_signals if s.signal_type == "ERROR"]
    assert len(error_sigs) == 1
    # Failing agent excluded from both numerator and denominator, so score is the survivor's conf.
    assert result.confluence_score == pytest.approx(0.9, abs=1e-6)


@pytest.mark.asyncio
async def test_zero_agents_rejected():
    with pytest.raises(ValueError):
        ConfluenceEngine(agents=[], threshold=0.65)


def test_base_agent_weight_validated():
    with pytest.raises(ValueError):
        _StubAgent("x", weight=1.5, confidence=0.5)
