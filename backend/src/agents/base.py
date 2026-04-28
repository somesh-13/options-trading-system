"""Base contracts for the multi-agent system.

- ``BaseAgent``: abstract async interface every specialized agent implements.
- ``AgentSignal``: typed output each agent produces per ``analyze()`` call.
- ``AnalysisContext``: per-request context the ConfluenceEngine passes in,
  including optional memory summaries injected by the P5 memory layer.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class AgentSignal(BaseModel):
    """Typed output from a single agent's analysis of a ticker."""

    agent_id: str = Field(..., description="Stable identifier of the emitting agent")
    ticker: str = Field(..., description="Symbol analyzed")
    signal_type: str = Field(
        ...,
        description='Categorical signal name, e.g. "IV_REGIME", "KELTNER_POSITION"',
    )
    confidence: float = Field(
        ..., ge=0.0, le=1.0, description="Agent's self-reported confidence in [0, 1]"
    )
    reasoning: str = Field(..., description="Short natural-language rationale")
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    data_sources: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="Agent-specific structured outputs (iv_hv_ratio, keltner_position, etc.)",
    )


@dataclass
class AnalysisContext:
    """Per-request context passed to ``BaseAgent.analyze()``.

    The ConfluenceEngine constructs one of these per ticker per run. P5 populates
    ``memory_summary`` via quality-weighted retrieval; until P5 lands it is empty.
    """

    ticker: str
    memory_summary: str = ""
    memory_count: int = 0
    avg_quality: float = 0.0
    extras: Dict[str, Any] = field(default_factory=dict)


class BaseAgent(ABC):
    """Abstract base class for a specialized analysis agent.

    Subclasses override :meth:`analyze` to wrap a single data source and emit a
    typed :class:`AgentSignal`. ``weight`` is the contribution factor the
    ConfluenceEngine applies when computing the weighted consensus score.
    """

    agent_id: str
    name: str
    domain: str
    weight: float

    def __init__(
        self,
        agent_id: str,
        name: str,
        domain: str,
        weight: float,
    ) -> None:
        if not 0.0 <= weight <= 1.0:
            raise ValueError(f"weight must be in [0, 1], got {weight}")
        self.agent_id = agent_id
        self.name = name
        self.domain = domain
        self.weight = weight

    @abstractmethod
    async def analyze(self, ticker: str, context: AnalysisContext) -> AgentSignal:
        """Run domain-specific analysis for ``ticker`` and return a typed signal."""

    def _signal(
        self,
        ticker: str,
        signal_type: str,
        confidence: float,
        reasoning: str,
        *,
        data_sources: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> AgentSignal:
        """Helper for subclasses to construct an AgentSignal with agent_id pre-filled."""
        return AgentSignal(
            agent_id=self.agent_id,
            ticker=ticker,
            signal_type=signal_type,
            confidence=confidence,
            reasoning=reasoning,
            data_sources=list(data_sources or []),
            metadata=dict(metadata or {}),
        )
