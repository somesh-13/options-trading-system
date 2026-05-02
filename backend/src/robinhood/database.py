"""SQLite storage for Robinhood activity rows.

Shares the journal's trades.db so we have a single database file per-app.
"""

import os
import sqlite3
import threading
from pathlib import Path
from typing import Optional

DB_PATH = os.path.join(Path(__file__).parent.parent.parent, "trades.db")

# Thread-local connections: uvicorn runs sync routes in a threadpool, and a
# single shared sqlite3 connection causes Row buffers to be invalidated when
# another thread runs a query mid-access (manifests as `row["col"]` returning
# None for fields that are not NULL in the DB). Each worker thread gets its
# own connection; WAL mode lets them all read/write concurrently.
_local = threading.local()


def get_conn() -> sqlite3.Connection:
    conn: Optional[sqlite3.Connection] = getattr(_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        _local.conn = conn
    return conn


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

    # Analytics report runs: each "Run all" snapshot from the AnalyticsPanel is
    # persisted here so the user can browse and reload historical runs.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS analytics_report_run (
            run_id       INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at   TEXT NOT NULL,
            account      TEXT,
            ticker_count INTEGER,
            payload_json TEXT NOT NULL,
            notes        TEXT
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_analytics_run_created ON analytics_report_run(created_at DESC)"
    )
    conn.commit()


def latest_live_snapshot(account: Optional[str] = None) -> Optional[sqlite3.Row]:
    """Return the most recent successful live snapshot row for `account`
    (or any account if None). Returns None if there are no snapshots.

    When account is None or 'all', returns the single most-recent row across
    all accounts (legacy behaviour, kept for callers that still want one row).
    Use latest_live_snapshots_all() to get one row per account tag.
    """
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


def latest_live_snapshots_all() -> list:
    """Return the most recent successful snapshot row for *each* distinct
    canonical account tag that has been synced. Used to build the merged 'all' view.

    Only returns rows whose account tag is one of the canonical internal names
    (brokerage, roth_ira, traditional_ira, etc.) — raw Robinhood type strings
    like 'margin', 'cash', 'individual' are excluded so stale pre-migration rows
    don't pollute the merge.

    Returns a list of sqlite3.Row objects (one per canonical account tag).
    """
    conn = get_conn()
    # Canonical tags we recognise; raw RH type names are excluded.
    # This prevents double-counting when the DB contains both old-style rows
    # (tagged 'margin'/'cash') and new-style rows (tagged 'brokerage'/'roth_ira').
    _canonical = ("brokerage", "roth_ira", "traditional_ira", "crypto")
    placeholders = ",".join("?" * len(_canonical))
    cur = conn.execute(
        f"""
        SELECT s.*
        FROM robinhood_live_snapshot s
        INNER JOIN (
            SELECT account, MAX(fetched_at) AS max_fetched
            FROM robinhood_live_snapshot
            WHERE error IS NULL
              AND account IS NOT NULL
              AND account != 'all'
              AND account IN ({placeholders})
            GROUP BY account
        ) latest ON s.account = latest.account AND s.fetched_at = latest.max_fetched
        WHERE s.error IS NULL
        ORDER BY s.account
        """,
        _canonical,
    )
    return cur.fetchall()


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
