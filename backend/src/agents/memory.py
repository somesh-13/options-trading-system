"""P5 — Per-agent quality-weighted memory layer.

Each analyze() call writes an ``agent_memory`` row. When a signal resolves
(P3's outcome tracker), the quality_score of the corresponding memories is
updated from the outcome: WIN→1.0, EXPIRED/PARTIAL→0.5, LOSS→0.0.

Retrieval ranks entries by ``quality_score * recency_decay`` where
recency_decay = max(0.1, 1 - days_ago / 90).

The ConfluenceEngine injects a formatted memory summary into
``AnalysisContext.memory_summary`` so agents can reference prior signals.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Low-level helpers (wrap journal.database so tests can monkey-patch)
# ---------------------------------------------------------------------------


def _conn() -> sqlite3.Connection:
    from journal.database import _get_conn

    return _get_conn()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def store_memory(
    *,
    agent_id: str,
    ticker: str,
    memory_type: str,
    content: Dict[str, Any],
    signal_id: Optional[str] = None,
    quality_score: float = 0.5,
) -> int:
    """Insert one memory row. Returns rowid."""
    conn = _conn()
    cur = conn.execute(
        """INSERT INTO agent_memory
           (agent_id, ticker, memory_type, content, timestamp, quality_score, signal_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (
            agent_id,
            ticker.upper(),
            memory_type,
            json.dumps(content),
            datetime.now(timezone.utc).isoformat(),
            float(quality_score),
            signal_id,
        ),
    )
    conn.commit()
    return cur.lastrowid


def retrieve_memory(
    agent_id: str,
    ticker: str,
    limit: int = 10,
    max_age_days: int = 90,
) -> List[Dict[str, Any]]:
    """Quality-weighted retrieval: `quality_score * max(0.1, 1 - days_ago/90)`."""
    conn = _conn()
    rows = conn.execute(
        """SELECT memory_id, agent_id, ticker, memory_type, content, timestamp, quality_score, signal_id
           FROM agent_memory
           WHERE agent_id = ? AND ticker = ?
             AND datetime(timestamp) >= datetime('now', ? || ' days')""",
        (agent_id, ticker.upper(), f"-{int(max_age_days)}"),
    ).fetchall()

    now = datetime.now(timezone.utc)
    scored: List[Dict[str, Any]] = []
    for r in rows:
        ts = _parse_ts(r["timestamp"])
        days_ago = max(0, (now - ts).days) if ts else max_age_days
        recency = max(0.1, 1 - days_ago / max_age_days) if max_age_days > 0 else 1.0
        score = float(r["quality_score"] or 0.0) * recency
        scored.append(
            {
                "memory_id": r["memory_id"],
                "agent_id": r["agent_id"],
                "ticker": r["ticker"],
                "memory_type": r["memory_type"],
                "content": _maybe_json(r["content"]),
                "timestamp": r["timestamp"],
                "quality_score": float(r["quality_score"] or 0.0),
                "signal_id": r["signal_id"],
                "days_ago": days_ago,
                "retrieval_score": round(score, 4),
            }
        )

    scored.sort(key=lambda m: m["retrieval_score"], reverse=True)
    return scored[:limit]


def update_quality_on_outcome(signal_id: str, outcome: str) -> int:
    """Map a P3 outcome to a quality score and apply it to all memories for this signal."""
    mapping = {"WIN": 1.0, "PARTIAL": 0.5, "LOSS": 0.0, "EXPIRED": 0.5, "OPEN": None}
    q = mapping.get(outcome.upper())
    if q is None:
        return 0
    conn = _conn()
    cur = conn.execute(
        "UPDATE agent_memory SET quality_score = ? WHERE signal_id = ?",
        (float(q), signal_id),
    )
    conn.commit()
    return cur.rowcount


def prune_memory(max_age_days: int = 90, row_cap_per_agent_ticker: int = 100) -> int:
    """Drop rows older than ``max_age_days`` then cap each (agent_id, ticker) partition.

    Eviction inside a partition is by ``quality_score ASC, timestamp ASC`` so we
    shed noise (low-quality, old) before value (high-quality, recent).

    Returns the number of rows deleted.
    """
    conn = _conn()
    # Prune by age.
    cur = conn.execute(
        "DELETE FROM agent_memory WHERE datetime(timestamp) < datetime('now', ? || ' days')",
        (f"-{int(max_age_days)}",),
    )
    deleted = cur.rowcount

    # Cap per partition.
    partitions = conn.execute(
        """SELECT agent_id, ticker, COUNT(*) AS n
           FROM agent_memory
           GROUP BY agent_id, ticker
           HAVING n > ?""",
        (int(row_cap_per_agent_ticker),),
    ).fetchall()

    for row in partitions:
        over = row["n"] - row_cap_per_agent_ticker
        evicted = conn.execute(
            """DELETE FROM agent_memory
               WHERE memory_id IN (
                   SELECT memory_id FROM agent_memory
                   WHERE agent_id = ? AND ticker = ?
                   ORDER BY quality_score ASC, timestamp ASC
                   LIMIT ?
               )""",
            (row["agent_id"], row["ticker"], int(over)),
        )
        deleted += evicted.rowcount

    conn.commit()
    return deleted


def summarize_for_context(agent_id: str, ticker: str, limit: int = 5) -> Dict[str, Any]:
    """Return a compact memory packet suitable for ``AnalysisContext.memory_summary``."""
    memories = retrieve_memory(agent_id, ticker, limit=limit)
    if not memories:
        return {"summary": "", "count": 0, "avg_quality": 0.0, "entries": []}
    avg_quality = sum(m["quality_score"] for m in memories) / len(memories)
    bullets = []
    for m in memories:
        c = m["content"] if isinstance(m["content"], dict) else {"raw": m["content"]}
        preview = ", ".join(f"{k}={_short(v)}" for k, v in list(c.items())[:4])
        bullets.append(f"- {m['days_ago']}d ago (q={m['quality_score']:.2f}): {preview}")
    return {
        "summary": "\n".join(bullets),
        "count": len(memories),
        "avg_quality": round(avg_quality, 4),
        "entries": memories,
    }


def memory_overview(ticker: str) -> Dict[str, Any]:
    """Endpoint-friendly summary: per-agent count, avg quality, latest entry."""
    conn = _conn()
    rows = conn.execute(
        """SELECT agent_id,
                  COUNT(*) AS n,
                  AVG(quality_score) AS avg_q,
                  MAX(timestamp) AS latest_ts
           FROM agent_memory
           WHERE ticker = ?
           GROUP BY agent_id
           ORDER BY agent_id""",
        (ticker.upper(),),
    ).fetchall()
    return {
        "ticker": ticker.upper(),
        "agents": [
            {
                "agent_id": r["agent_id"],
                "count": r["n"],
                "avg_quality": round(r["avg_q"] or 0.0, 4),
                "latest_entry": r["latest_ts"],
            }
            for r in rows
        ],
    }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_ts(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def _maybe_json(blob: Optional[str]) -> Any:
    if not blob:
        return {}
    try:
        return json.loads(blob)
    except (json.JSONDecodeError, TypeError):
        return {"raw": blob}


def _short(v: Any) -> str:
    s = str(v)
    return s if len(s) <= 32 else s[:29] + "..."
