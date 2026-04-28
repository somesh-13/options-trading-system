"""P5 tests — memory storage, quality-weighted retrieval, pruning."""

import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

BACKEND_SRC = Path(__file__).resolve().parent.parent / "src"
if str(BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(BACKEND_SRC))


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    from journal import database

    db = tmp_path / "trades.db"
    monkeypatch.setattr(database, "DB_PATH", str(db))
    monkeypatch.setattr(database, "_conn", None)
    database.init_db()
    yield database
    conn = database._conn
    if conn is not None:
        conn.close()
    monkeypatch.setattr(database, "_conn", None)


def _seed_signal(database, signal_id: str, ticker: str = "NVDA") -> None:
    database.log_agent_signal(
        signal_id=signal_id,
        ticker=ticker,
        timestamp=datetime.now(timezone.utc).isoformat(),
        agent_id="volatility",
        signal_type="IV_REGIME",
        confidence=0.8,
        confluence_score=0.72,
    )


def test_store_and_retrieve(fresh_db):
    from agents import memory

    sid = str(uuid.uuid4())
    _seed_signal(fresh_db, sid)
    memory.store_memory(
        agent_id="volatility",
        ticker="NVDA",
        memory_type="SIGNAL",
        content={"iv_regime": "LOW", "iv_hv_ratio": 0.65},
        signal_id=sid,
    )
    out = memory.retrieve_memory("volatility", "NVDA", limit=5)
    assert len(out) == 1
    assert out[0]["content"]["iv_regime"] == "LOW"
    assert out[0]["retrieval_score"] > 0


def test_quality_weighted_ranking(fresh_db):
    from agents import memory

    # Three memories: one high-quality recent, one mid, one low.
    for q in (0.9, 0.5, 0.1):
        memory.store_memory(
            agent_id="technical",
            ticker="HOOD",
            memory_type="SIGNAL",
            content={"quality_was": q},
            quality_score=q,
        )
    out = memory.retrieve_memory("technical", "HOOD", limit=3)
    assert [round(m["quality_score"], 1) for m in out] == [0.9, 0.5, 0.1]


def test_update_quality_on_outcome(fresh_db):
    from agents import memory

    sid = str(uuid.uuid4())
    _seed_signal(fresh_db, sid, ticker="CIFR")
    memory.store_memory(
        agent_id="volatility",
        ticker="CIFR",
        memory_type="SIGNAL",
        content={"x": 1},
        signal_id=sid,
        quality_score=0.5,
    )
    affected = memory.update_quality_on_outcome(sid, "WIN")
    assert affected == 1
    out = memory.retrieve_memory("volatility", "CIFR", limit=1)
    assert out[0]["quality_score"] == 1.0


def test_prune_row_cap(fresh_db):
    from agents import memory

    # Insert 105 rows; cap is 100. The 5 lowest-quality should be evicted.
    for i in range(105):
        memory.store_memory(
            agent_id="regime",
            ticker="WULF",
            memory_type="REGIME",
            content={"i": i},
            quality_score=i / 105.0,  # low-i → low quality
        )
    deleted = memory.prune_memory(max_age_days=365, row_cap_per_agent_ticker=100)
    assert deleted == 5
    remaining = memory.retrieve_memory("regime", "WULF", limit=200)
    # Lowest qualities evicted → remaining floor should be > 0 (i.e. i >= 5)
    qualities = sorted(m["quality_score"] for m in remaining)
    assert qualities[0] >= 5 / 105.0 - 1e-9


def test_summarize_for_context_formats_bullets(fresh_db):
    from agents import memory

    memory.store_memory(
        agent_id="volatility",
        ticker="NVDA",
        memory_type="SIGNAL",
        content={"iv_regime": "HIGH", "iv_hv_ratio": 1.45},
        quality_score=0.9,
    )
    packet = memory.summarize_for_context("volatility", "NVDA", limit=3)
    assert packet["count"] == 1
    assert "iv_regime=HIGH" in packet["summary"]
    assert packet["avg_quality"] == 0.9


def test_memory_overview_endpoint_shape(fresh_db):
    from agents import memory

    memory.store_memory(agent_id="volatility", ticker="NVDA", memory_type="SIGNAL", content={}, quality_score=0.6)
    memory.store_memory(agent_id="technical", ticker="NVDA", memory_type="SIGNAL", content={}, quality_score=0.8)
    overview = memory.memory_overview("NVDA")
    assert overview["ticker"] == "NVDA"
    assert {a["agent_id"] for a in overview["agents"]} == {"volatility", "technical"}
