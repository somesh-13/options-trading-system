"""P3 tests: signal-history persistence, outcome resolution, win-rate buckets."""

import os
import sys
import uuid
from pathlib import Path

import pytest

BACKEND_SRC = Path(__file__).resolve().parent.parent / "src"
if str(BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(BACKEND_SRC))


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    """Point the journal database at a fresh SQLite file per test."""
    from journal import database

    db_file = tmp_path / "trades.db"
    monkeypatch.setattr(database, "DB_PATH", str(db_file))
    monkeypatch.setattr(database, "_conn", None)
    database.init_db()
    yield database
    conn = database._conn
    if conn is not None:
        conn.close()
    monkeypatch.setattr(database, "_conn", None)


def test_log_and_query_agent_signal(fresh_db):
    sid = fresh_db.log_agent_signal(
        signal_id=str(uuid.uuid4()),
        ticker="NVDA",
        timestamp="2026-04-13T12:00:00",
        agent_id="volatility",
        signal_type="IV_REGIME",
        confidence=0.85,
        confluence_score=0.72,
        iv_hv_ratio=0.65,
        keltner_position="BOTTOM",
        regime="BULL",
        recommended_strategy="BUY_LEAP",
        metadata={"note": "test"},
    )
    rows = fresh_db.get_signal_history(ticker="NVDA", days=30)
    assert len(rows) == 1
    assert rows[0]["signal_id"] == sid
    assert rows[0]["metadata"]["note"] == "test"
    assert rows[0]["recommended_strategy"] == "BUY_LEAP"


def test_win_rate_buckets_aggregate(fresh_db):
    # Three signals across buckets; two resolved as WIN, one LOSS, one OPEN.
    def _log(score, outcome):
        sid = str(uuid.uuid4())
        fresh_db.log_agent_signal(
            signal_id=sid,
            ticker="HOOD",
            timestamp="2026-04-13T12:00:00",
            agent_id="confluence",
            signal_type="AGGREGATE",
            confidence=0.9,
            confluence_score=score,
            recommended_strategy="SELL_CSP",
        )
        if outcome is not None:
            fresh_db.log_signal_outcome(
                signal_id=sid,
                entry_price=2.0,
                exit_price=0.5 if outcome == "WIN" else 3.5,
                pnl=150 if outcome == "WIN" else -150,
                pnl_pct=0.75 if outcome == "WIN" else -0.75,
                outcome=outcome,
            )

    _log(0.80, "WIN")
    _log(0.70, "WIN")
    _log(0.55, "LOSS")
    _log(0.40, None)  # unresolved

    buckets = fresh_db.get_win_rate_by_bucket()
    assert buckets["high"]["wins"] == 2
    assert buckets["high"]["resolved"] == 2
    assert buckets["high"]["win_rate"] == 1.0
    assert buckets["mid"]["wins"] == 0
    assert buckets["mid"]["resolved"] == 1
    assert buckets["mid"]["win_rate"] == 0.0
    # Low bucket has the OPEN signal only, so resolved == 0 and win_rate is None.
    assert buckets["low"]["resolved"] == 0
    assert buckets["low"]["win_rate"] is None


def test_outcome_log_is_idempotent(fresh_db):
    sid = fresh_db.log_agent_signal(
        signal_id=str(uuid.uuid4()),
        ticker="CIFR",
        timestamp="2026-04-13T12:00:00",
        agent_id="volatility",
        signal_type="IV_REGIME",
        confidence=0.7,
        confluence_score=0.8,
    )
    fresh_db.log_signal_outcome(signal_id=sid, entry_price=1.0, exit_price=2.0, pnl=100, pnl_pct=1.0, outcome="WIN")
    # Overwrite with a loss — should replace, not duplicate.
    fresh_db.log_signal_outcome(signal_id=sid, entry_price=1.0, exit_price=0.5, pnl=-50, pnl_pct=-0.5, outcome="LOSS")
    rows = fresh_db.get_signal_history(ticker="CIFR", days=30)
    assert len(rows) == 1
    assert rows[0]["outcome"] == "LOSS"
    assert rows[0]["pnl"] == -50


def test_resolve_open_signals_marks_expired(fresh_db, monkeypatch):
    # Seed a signal with an expiry in the past.
    sid = str(uuid.uuid4())
    fresh_db.log_agent_signal(
        signal_id=sid,
        ticker="WULF",
        timestamp="2026-04-13T12:00:00",
        agent_id="volatility",
        signal_type="IV_REGIME",
        confidence=0.9,
        confluence_score=0.8,
        recommended_strategy="BUY_LEAP",
        strike=10.0,
        expiry="2020-01-01",
        premium=1.25,
    )
    # Stub out the init_db call the scheduler makes to ensure it hits our tmp DB.
    from engine import scheduler

    monkeypatch.setattr(scheduler, "get_open_signals", fresh_db.get_open_signals, raising=False)

    updated = scheduler.resolve_open_signals()
    assert updated == 1
    rows = fresh_db.get_signal_history(ticker="WULF", days=365 * 10)
    assert rows[0]["outcome"] == "EXPIRED"
    assert rows[0]["exit_reason"] == "EXPIRY"
