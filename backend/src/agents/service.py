"""Singleton engine + per-ticker result cache shared across API handlers.

The API layer calls ``get_service()`` which lazily builds the default engine
once per process. Each successful ``analyze(ticker)`` result is cached by
ticker so ``/api/agents/confluence/{ticker}`` can return the last one
without re-running six agents.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from agents.base import AgentSignal
from agents.confluence import ConfluenceEngine, ConfluenceResult, build_default_engine


@dataclass
class AgentHealth:
    agent_id: str
    last_signal: Optional[AgentSignal] = None
    last_latency_ms: float = 0.0
    last_error: Optional[str] = None


@dataclass
class AgentService:
    engine: ConfluenceEngine
    cache: Dict[str, ConfluenceResult] = field(default_factory=dict)
    health: Dict[str, AgentHealth] = field(default_factory=dict)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def __post_init__(self) -> None:
        for agent in self.engine.agents:
            self.health[agent.agent_id] = AgentHealth(agent_id=agent.agent_id)

    async def analyze(self, ticker: str) -> ConfluenceResult:
        async with self._lock:
            start = time.perf_counter()
            result = await self.engine.analyze(ticker)
            elapsed = (time.perf_counter() - start) * 1000

            for sig in result.agent_signals:
                hp = self.health.setdefault(sig.agent_id, AgentHealth(agent_id=sig.agent_id))
                hp.last_signal = sig
                hp.last_latency_ms = round(elapsed, 2)
                hp.last_error = sig.reasoning if sig.signal_type == "ERROR" else None

            self.cache[ticker.upper()] = result
            _persist_signals(result)
            return result

    def cached(self, ticker: str) -> Optional[ConfluenceResult]:
        return self.cache.get(ticker.upper())

    def status(self) -> List[dict]:
        return [
            {
                "agent_id": hp.agent_id,
                "last_signal": hp.last_signal.model_dump() if hp.last_signal else None,
                "last_latency_ms": hp.last_latency_ms,
                "last_error": hp.last_error,
            }
            for hp in self.health.values()
        ]


def _persist_signals(result: ConfluenceResult) -> None:
    """Write one row per agent signal to agent_signals (P3) + agent_memory (P5)."""
    import logging
    import uuid

    try:
        from journal.database import init_db, log_agent_signal
    except Exception:
        return  # journal module unavailable; don't block the engine

    try:
        init_db()
    except Exception:
        logging.getLogger(__name__).exception("init_db failed before persisting signals")
        return

    # Pull shared facts once so every row is self-describing.
    by_id = {s.agent_id: s for s in result.agent_signals}
    vol = by_id.get("volatility")
    tech = by_id.get("technical")
    regime = by_id.get("regime")
    iv_hv = float(vol.metadata.get("iv_hv_ratio")) if vol else None
    keltner = tech.metadata.get("keltner_position") if tech else None
    regime_val = regime.metadata.get("market_regime") if regime else None
    timestamp = result.timestamp.isoformat()

    # Best-effort memory write — ignore if the P5 layer isn't importable.
    try:
        from agents.memory import store_memory
    except Exception:
        store_memory = None  # type: ignore[assignment]

    for sig in result.agent_signals:
        signal_id = str(uuid.uuid4())
        try:
            log_agent_signal(
                signal_id=signal_id,
                ticker=result.ticker,
                timestamp=timestamp,
                agent_id=sig.agent_id,
                signal_type=sig.signal_type,
                confidence=sig.confidence,
                confluence_score=result.confluence_score,
                iv_hv_ratio=iv_hv,
                keltner_position=keltner,
                regime=regime_val,
                recommended_strategy=result.recommended_strategy,
                metadata=sig.metadata,
            )
        except Exception:
            logging.getLogger(__name__).exception("Failed to persist signal %s", sig.agent_id)
            continue

        if store_memory is not None:
            try:
                store_memory(
                    agent_id=sig.agent_id,
                    ticker=result.ticker,
                    memory_type="SIGNAL",
                    content={
                        "signal_type": sig.signal_type,
                        "confidence": sig.confidence,
                        "confluence_score": result.confluence_score,
                        "reasoning": sig.reasoning,
                        **sig.metadata,
                    },
                    signal_id=signal_id,
                    quality_score=0.5,  # updated later by P3's resolve_open_signals
                )
            except Exception:
                logging.getLogger(__name__).exception("store_memory failed for %s", sig.agent_id)


_service: Optional[AgentService] = None


def get_service() -> AgentService:
    global _service
    if _service is None:
        _service = AgentService(engine=build_default_engine())
    return _service
