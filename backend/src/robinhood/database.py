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
    conn.commit()
