"""SQLite persistence for notifications. Reuses the journal trades.db file."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

# Reuse the journal connection helper so we don't open two connections to the
# same DB.
from journal.database import _get_conn  # type: ignore


def init_db() -> None:
    """Create the notifications table on first use. Idempotent."""
    conn = _get_conn()
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            alert_type TEXT NOT NULL,
            severity TEXT NOT NULL DEFAULT 'info',
            title TEXT NOT NULL,
            body TEXT,
            metadata TEXT,
            created_at TEXT NOT NULL,
            dismissed_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_notifications_active
            ON notifications(dismissed_at, ticker, alert_type);
        """
    )
    conn.commit()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def has_active(ticker: str, alert_type: str) -> bool:
    """Whether an undismissed notification already exists for this (ticker, type)."""
    init_db()
    conn = _get_conn()
    row = conn.execute(
        """
        SELECT 1 FROM notifications
         WHERE ticker = ? AND alert_type = ? AND dismissed_at IS NULL
         LIMIT 1
        """,
        (ticker.upper(), alert_type),
    ).fetchone()
    return row is not None


def insert(
    ticker: str,
    alert_type: str,
    title: str,
    body: Optional[str] = None,
    severity: str = "info",
    metadata: Optional[Dict[str, Any]] = None,
) -> int:
    """Insert a new notification and return its row id."""
    init_db()
    conn = _get_conn()
    cur = conn.execute(
        """
        INSERT INTO notifications
            (ticker, alert_type, severity, title, body, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            ticker.upper(),
            alert_type,
            severity,
            title,
            body,
            json.dumps(metadata) if metadata else None,
            _now_iso(),
        ),
    )
    conn.commit()
    return int(cur.lastrowid or 0)


def list_active() -> List[Dict[str, Any]]:
    """Return undismissed notifications, newest-first."""
    init_db()
    conn = _get_conn()
    rows = conn.execute(
        """
        SELECT id, ticker, alert_type, severity, title, body, metadata, created_at
          FROM notifications
         WHERE dismissed_at IS NULL
         ORDER BY datetime(created_at) DESC
        """
    ).fetchall()
    out: List[Dict[str, Any]] = []
    for r in rows:
        meta = None
        if r["metadata"]:
            try:
                meta = json.loads(r["metadata"])
            except Exception:
                meta = None
        out.append({
            "id": r["id"],
            "ticker": r["ticker"],
            "alert_type": r["alert_type"],
            "severity": r["severity"],
            "title": r["title"],
            "body": r["body"],
            "metadata": meta,
            "created_at": r["created_at"],
        })
    return out


def dismiss(notification_id: int) -> bool:
    """Mark a notification as dismissed. Returns True if a row was updated."""
    init_db()
    conn = _get_conn()
    cur = conn.execute(
        "UPDATE notifications SET dismissed_at = ? WHERE id = ? AND dismissed_at IS NULL",
        (_now_iso(), notification_id),
    )
    conn.commit()
    return cur.rowcount > 0


def dismiss_all() -> int:
    """Mark every active notification as dismissed. Returns number affected."""
    init_db()
    conn = _get_conn()
    cur = conn.execute(
        "UPDATE notifications SET dismissed_at = ? WHERE dismissed_at IS NULL",
        (_now_iso(),),
    )
    conn.commit()
    return cur.rowcount
