"""SQLite storage for Robinhood activity rows.

Shares the journal's trades.db so we have a single database file per-app.
"""

import os
import sqlite3
from pathlib import Path
from typing import Optional

DB_PATH = os.path.join(Path(__file__).parent.parent.parent, "trades.db")

_conn: Optional[sqlite3.Connection] = None


def get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
    return _conn


def ensure_schema() -> None:
    conn = get_conn()
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS robinhood_activity (
            row_hash      TEXT PRIMARY KEY,
            activity_date TEXT NOT NULL,
            process_date  TEXT,
            settle_date   TEXT,
            instrument    TEXT,
            description   TEXT,
            trans_code    TEXT NOT NULL,
            quantity      REAL,
            price         REAL,
            amount        REAL,
            source_file   TEXT,
            account       TEXT,
            ingested_at   TEXT DEFAULT (datetime('now'))
        )
        """
    )
    # Migration: add `account` column to pre-existing tables.
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(robinhood_activity)").fetchall()}
    if "account" not in existing:
        conn.execute("ALTER TABLE robinhood_activity ADD COLUMN account TEXT")

    # Indexes (must come after ALTER TABLE so idx_rh_account resolves).
    conn.executescript(
        """
        CREATE INDEX IF NOT EXISTS idx_rh_instrument    ON robinhood_activity(instrument);
        CREATE INDEX IF NOT EXISTS idx_rh_trans_code    ON robinhood_activity(trans_code);
        CREATE INDEX IF NOT EXISTS idx_rh_activity_date ON robinhood_activity(activity_date);
        CREATE INDEX IF NOT EXISTS idx_rh_account       ON robinhood_activity(account);
        """
    )

    # Live snapshots from the Robinhood API live alongside the CSV-derived
    # activity table. One row per sync; the latest row per (account) is the
    # current view. Activity log remains the source of truth for backtests.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS robinhood_live_snapshot (
            snapshot_id   INTEGER PRIMARY KEY AUTOINCREMENT,
            fetched_at    TEXT NOT NULL,
            account       TEXT,
            payload_json  TEXT NOT NULL,
            stale         INTEGER DEFAULT 0,
            error         TEXT
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_rh_snap_fetched ON robinhood_live_snapshot(fetched_at DESC)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_rh_snap_account ON robinhood_live_snapshot(account)"
    )
    conn.commit()


def latest_live_snapshot(account: Optional[str] = None) -> Optional[sqlite3.Row]:
    """Return the most recent successful live snapshot row for `account`
    (or any account if None). Returns None if there are no snapshots."""
    conn = get_conn()
    if account and account != "all":
        cur = conn.execute(
            """
            SELECT * FROM robinhood_live_snapshot
            WHERE account = ? AND error IS NULL
            ORDER BY fetched_at DESC LIMIT 1
            """,
            (account,),
        )
    else:
        cur = conn.execute(
            """
            SELECT * FROM robinhood_live_snapshot
            WHERE error IS NULL
            ORDER BY fetched_at DESC LIMIT 1
            """
        )
    return cur.fetchone()


def write_live_snapshot(
    fetched_at: str,
    account: Optional[str],
    payload_json: str,
    stale: bool = False,
    error: Optional[str] = None,
) -> int:
    """Insert a snapshot row. Returns the snapshot_id."""
    conn = get_conn()
    cur = conn.execute(
        """
        INSERT INTO robinhood_live_snapshot
            (fetched_at, account, payload_json, stale, error)
        VALUES (?, ?, ?, ?, ?)
        """,
        (fetched_at, account, payload_json, 1 if stale else 0, error),
    )
    conn.commit()
    return int(cur.lastrowid or 0)
