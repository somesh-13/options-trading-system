"""SQLite database for trade journal and engine activity logging."""

import sqlite3
import json
import os
from datetime import datetime, timezone
from typing import Optional
from pathlib import Path

DB_PATH = os.path.join(Path(__file__).parent.parent.parent, "trades.db")

_conn: Optional[sqlite3.Connection] = None


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA foreign_keys=ON")
    return _conn


def init_db():
    """Create tables if they don't exist."""
    conn = _get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT,
            timestamp TEXT NOT NULL,
            symbol TEXT NOT NULL,
            asset_class TEXT NOT NULL DEFAULT 'option',
            side TEXT NOT NULL,
            qty INTEGER NOT NULL,
            order_type TEXT NOT NULL DEFAULT 'limit',
            limit_price REAL,
            filled_price REAL,
            filled_qty INTEGER DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'submitted',
            signal_source TEXT NOT NULL DEFAULT 'manual',
            signal_data TEXT,
            related_trade_id INTEGER,
            realized_pnl REAL,
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (related_trade_id) REFERENCES trades(id)
        );

        CREATE TABLE IF NOT EXISTS engine_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            event_type TEXT NOT NULL,
            ticker TEXT,
            details TEXT,
            trade_id INTEGER,
            FOREIGN KEY (trade_id) REFERENCES trades(id)
        );

        -- P3: per-agent signal history (one row per ConfluenceEngine.analyze())
        CREATE TABLE IF NOT EXISTS agent_signals (
            signal_id TEXT PRIMARY KEY,
            ticker TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            agent_id TEXT NOT NULL,
            signal_type TEXT NOT NULL,
            confidence REAL NOT NULL,
            iv_hv_ratio REAL,
            keltner_position TEXT,
            regime TEXT,
            recommended_strategy TEXT,
            strike REAL,
            expiry TEXT,
            premium REAL,
            confluence_score REAL NOT NULL,
            metadata TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        -- P5: per-agent memory with quality score (updated from outcomes)
        CREATE TABLE IF NOT EXISTS agent_memory (
            memory_id INTEGER PRIMARY KEY AUTOINCREMENT,
            agent_id TEXT NOT NULL,
            ticker TEXT NOT NULL,
            memory_type TEXT NOT NULL CHECK(memory_type IN ('SIGNAL','REGIME','EARNINGS_OUTCOME','IV_PERCENTILE')),
            content TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            quality_score REAL DEFAULT 0.5,
            signal_id TEXT REFERENCES agent_signals(signal_id)
        );

        -- P3: outcome tracker (resolves at 4 PM ET)
        CREATE TABLE IF NOT EXISTS signal_outcomes (
            outcome_id INTEGER PRIMARY KEY AUTOINCREMENT,
            signal_id TEXT NOT NULL REFERENCES agent_signals(signal_id),
            outcome_timestamp TEXT NOT NULL,
            entry_price REAL NOT NULL,
            exit_price REAL,
            pnl REAL,
            pnl_pct REAL,
            outcome TEXT CHECK(outcome IN ('WIN','LOSS','OPEN','EXPIRED')),
            exit_reason TEXT CHECK(exit_reason IN ('EXPIRY','STOP_LOSS','TAKE_PROFIT','MANUAL'))
        );

        CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
        CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
        CREATE INDEX IF NOT EXISTS idx_trades_signal_source ON trades(signal_source);
        CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
        CREATE INDEX IF NOT EXISTS idx_engine_log_event_type ON engine_log(event_type);
        CREATE INDEX IF NOT EXISTS idx_engine_log_timestamp ON engine_log(timestamp);
        CREATE INDEX IF NOT EXISTS idx_agent_signals_ticker_ts ON agent_signals(ticker, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_agent_signals_confluence ON agent_signals(confluence_score DESC);
        CREATE INDEX IF NOT EXISTS idx_outcomes_signal_id ON signal_outcomes(signal_id);
        CREATE INDEX IF NOT EXISTS idx_outcomes_outcome ON signal_outcomes(outcome);
        CREATE INDEX IF NOT EXISTS idx_memory_agent_ticker_ts ON agent_memory(agent_id, ticker, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_memory_signal_id ON agent_memory(signal_id);

        -- Flow: full option-chain snapshot per scheduled run. The /flow page
        -- and the OI-buildup/premium-flow detectors compare today's row to
        -- the prior day's row keyed on (ticker, expiration, strike, side).
        CREATE TABLE IF NOT EXISTS option_chain_snapshot (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            snapshot_at TEXT NOT NULL,        -- ISO timestamp
            ticker TEXT NOT NULL,
            expiration TEXT NOT NULL,         -- YYYY-MM-DD
            strike REAL NOT NULL,
            side TEXT NOT NULL,               -- 'call' | 'put'
            bid REAL, ask REAL, mid REAL,
            iv REAL,
            oi INTEGER, volume INTEGER,
            spot REAL                         -- underlying price at snapshot time
        );

        CREATE INDEX IF NOT EXISTS idx_ocs_ticker_at ON option_chain_snapshot(ticker, snapshot_at);
        CREATE INDEX IF NOT EXISTS idx_ocs_at ON option_chain_snapshot(snapshot_at);
        CREATE INDEX IF NOT EXISTS idx_ocs_contract ON option_chain_snapshot(ticker, expiration, strike, side, snapshot_at);
    """)
    conn.commit()


# =============================================
# P3 — Signal History + Outcome Tracker
# =============================================


def log_agent_signal(
    *,
    signal_id: str,
    ticker: str,
    timestamp: str,
    agent_id: str,
    signal_type: str,
    confidence: float,
    confluence_score: float,
    iv_hv_ratio: Optional[float] = None,
    keltner_position: Optional[str] = None,
    regime: Optional[str] = None,
    recommended_strategy: Optional[str] = None,
    strike: Optional[float] = None,
    expiry: Optional[str] = None,
    premium: Optional[float] = None,
    metadata: Optional[dict] = None,
) -> str:
    """Insert one row of the per-agent signal history. Returns signal_id."""
    conn = _get_conn()
    conn.execute(
        """INSERT OR REPLACE INTO agent_signals
           (signal_id, ticker, timestamp, agent_id, signal_type, confidence,
            iv_hv_ratio, keltner_position, regime, recommended_strategy,
            strike, expiry, premium, confluence_score, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            signal_id, ticker, timestamp, agent_id, signal_type, float(confidence),
            iv_hv_ratio, keltner_position, regime, recommended_strategy,
            strike, expiry, premium, float(confluence_score),
            json.dumps(metadata) if metadata else None,
        ),
    )
    conn.commit()
    return signal_id


def get_signal_history(
    ticker: Optional[str] = None,
    days: int = 30,
    min_confluence: Optional[float] = None,
    limit: int = 500,
) -> list[dict]:
    """Return signal rows filtered by ticker and date window."""
    conn = _get_conn()
    clauses = ["datetime(timestamp) >= datetime('now', ? || ' days')"]
    params: list = [f"-{int(days)}"]
    if ticker:
        clauses.append("ticker = ?")
        params.append(ticker.upper())
    if min_confluence is not None:
        clauses.append("confluence_score >= ?")
        params.append(float(min_confluence))
    where = " AND ".join(clauses)
    params.append(limit)
    rows = conn.execute(
        f"""SELECT s.*, o.pnl, o.pnl_pct, o.outcome, o.exit_reason
            FROM agent_signals s
            LEFT JOIN signal_outcomes o ON o.signal_id = s.signal_id
            WHERE {where}
            ORDER BY s.timestamp DESC
            LIMIT ?""",
        params,
    ).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_open_signals() -> list[dict]:
    """Return signals without a resolved outcome — candidates for the 4 PM cron."""
    conn = _get_conn()
    rows = conn.execute(
        """SELECT s.* FROM agent_signals s
           LEFT JOIN signal_outcomes o ON o.signal_id = s.signal_id
           WHERE o.signal_id IS NULL OR o.outcome = 'OPEN'
           ORDER BY s.timestamp ASC"""
    ).fetchall()
    return [_row_to_dict(r) for r in rows]


def log_signal_outcome(
    *,
    signal_id: str,
    entry_price: float,
    exit_price: Optional[float],
    pnl: Optional[float],
    pnl_pct: Optional[float],
    outcome: str,
    exit_reason: Optional[str] = None,
) -> int:
    """Insert/replace an outcome row for a signal_id."""
    conn = _get_conn()
    # Idempotent: delete any prior outcome for this signal before inserting.
    conn.execute("DELETE FROM signal_outcomes WHERE signal_id = ?", (signal_id,))
    cur = conn.execute(
        """INSERT INTO signal_outcomes
           (signal_id, outcome_timestamp, entry_price, exit_price, pnl, pnl_pct, outcome, exit_reason)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            signal_id,
            datetime.now(timezone.utc).isoformat(),
            float(entry_price),
            float(exit_price) if exit_price is not None else None,
            float(pnl) if pnl is not None else None,
            float(pnl_pct) if pnl_pct is not None else None,
            outcome,
            exit_reason,
        ),
    )
    conn.commit()
    return cur.lastrowid


def get_win_rate_by_bucket() -> dict:
    """Return win rate across the three confluence buckets (<0.50, 0.50-0.65, ≥0.65).

    Counts a row as a WIN only when a resolved outcome is WIN; OPEN rows are
    excluded from the denominator.
    """
    conn = _get_conn()
    rows = conn.execute(
        """SELECT
              CASE
                WHEN confluence_score < 0.50 THEN 'low'
                WHEN confluence_score < 0.65 THEN 'mid'
                ELSE 'high'
              END AS bucket,
              COUNT(*) AS total,
              SUM(CASE WHEN o.outcome = 'WIN' THEN 1 ELSE 0 END) AS wins,
              SUM(CASE WHEN o.outcome IN ('WIN','LOSS','EXPIRED') THEN 1 ELSE 0 END) AS resolved,
              AVG(o.pnl) AS avg_pnl
           FROM agent_signals s
           LEFT JOIN signal_outcomes o ON o.signal_id = s.signal_id
           GROUP BY bucket"""
    ).fetchall()
    out = {"low": {}, "mid": {}, "high": {}}
    for r in rows:
        resolved = r["resolved"] or 0
        wins = r["wins"] or 0
        out[r["bucket"]] = {
            "total": r["total"],
            "resolved": resolved,
            "wins": wins,
            "win_rate": round(wins / resolved, 4) if resolved else None,
            "avg_pnl": round(r["avg_pnl"], 2) if r["avg_pnl"] is not None else None,
        }
    return out


def get_signal_performance() -> dict:
    """Aggregate performance: totals, win rate by bucket, Sharpe by strategy."""
    conn = _get_conn()
    total = conn.execute("SELECT COUNT(*) AS n FROM agent_signals").fetchone()["n"]
    strat_rows = conn.execute(
        """SELECT recommended_strategy,
                  COUNT(*) AS total,
                  AVG(o.pnl) AS avg_pnl,
                  SUM(CASE WHEN o.outcome = 'WIN' THEN 1 ELSE 0 END) AS wins,
                  SUM(CASE WHEN o.outcome IN ('WIN','LOSS','EXPIRED') THEN 1 ELSE 0 END) AS resolved
           FROM agent_signals s
           LEFT JOIN signal_outcomes o ON o.signal_id = s.signal_id
           WHERE recommended_strategy IS NOT NULL
           GROUP BY recommended_strategy"""
    ).fetchall()

    # Simple per-strategy Sharpe using pnl samples (daily-like).
    strategies = []
    for r in strat_rows:
        pnl_rows = conn.execute(
            """SELECT o.pnl FROM agent_signals s
               JOIN signal_outcomes o ON o.signal_id = s.signal_id
               WHERE s.recommended_strategy = ? AND o.pnl IS NOT NULL""",
            (r["recommended_strategy"],),
        ).fetchall()
        pnls = [row["pnl"] for row in pnl_rows]
        if len(pnls) >= 2:
            mean = sum(pnls) / len(pnls)
            var = sum((x - mean) ** 2 for x in pnls) / (len(pnls) - 1)
            std = var ** 0.5
            sharpe = round(mean / std, 3) if std else None
        else:
            sharpe = None
        resolved = r["resolved"] or 0
        wins = r["wins"] or 0
        strategies.append(
            {
                "strategy": r["recommended_strategy"],
                "total": r["total"],
                "resolved": resolved,
                "wins": wins,
                "win_rate": round(wins / resolved, 4) if resolved else None,
                "avg_pnl": round(r["avg_pnl"], 2) if r["avg_pnl"] is not None else None,
                "sharpe": sharpe,
            }
        )

    return {
        "total_signals": total,
        "buckets": get_win_rate_by_bucket(),
        "strategies": strategies,
    }


def log_trade(
    order_id: str,
    symbol: str,
    side: str,
    qty: int,
    order_type: str = "limit",
    limit_price: Optional[float] = None,
    asset_class: str = "option",
    signal_source: str = "manual",
    signal_data: Optional[dict] = None,
    status: str = "submitted",
) -> int:
    """Insert a new trade record. Returns the trade id."""
    conn = _get_conn()
    now = datetime.now(timezone.utc).isoformat()
    cur = conn.execute(
        """INSERT INTO trades
           (order_id, timestamp, symbol, asset_class, side, qty, order_type,
            limit_price, status, signal_source, signal_data, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            order_id, now, symbol, asset_class, side, qty, order_type,
            limit_price, status, signal_source,
            json.dumps(signal_data) if signal_data else None,
            now, now,
        ),
    )
    conn.commit()
    return cur.lastrowid


def update_trade_status(
    trade_id: int,
    status: str,
    filled_price: Optional[float] = None,
    filled_qty: Optional[int] = None,
    realized_pnl: Optional[float] = None,
    related_trade_id: Optional[int] = None,
    notes: Optional[str] = None,
):
    """Update an existing trade record."""
    conn = _get_conn()
    now = datetime.now(timezone.utc).isoformat()
    fields = ["status = ?", "updated_at = ?"]
    values: list = [status, now]

    if filled_price is not None:
        fields.append("filled_price = ?")
        values.append(filled_price)
    if filled_qty is not None:
        fields.append("filled_qty = ?")
        values.append(filled_qty)
    if realized_pnl is not None:
        fields.append("realized_pnl = ?")
        values.append(realized_pnl)
    if related_trade_id is not None:
        fields.append("related_trade_id = ?")
        values.append(related_trade_id)
    if notes is not None:
        fields.append("notes = ?")
        values.append(notes)

    values.append(trade_id)
    conn.execute(f"UPDATE trades SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()


def update_trade_by_order_id(
    order_id: str,
    status: str,
    filled_price: Optional[float] = None,
    filled_qty: Optional[int] = None,
):
    """Update trade by Alpaca order_id."""
    conn = _get_conn()
    now = datetime.now(timezone.utc).isoformat()
    fields = ["status = ?", "updated_at = ?"]
    values: list = [status, now]

    if filled_price is not None:
        fields.append("filled_price = ?")
        values.append(filled_price)
    if filled_qty is not None:
        fields.append("filled_qty = ?")
        values.append(filled_qty)

    values.append(order_id)
    conn.execute(f"UPDATE trades SET {', '.join(fields)} WHERE order_id = ?", values)
    conn.commit()


def get_trade(trade_id: int) -> Optional[dict]:
    """Get a single trade by id."""
    conn = _get_conn()
    row = conn.execute("SELECT * FROM trades WHERE id = ?", (trade_id,)).fetchone()
    if row is None:
        return None
    return _row_to_dict(row)


def get_trades(
    symbol: Optional[str] = None,
    status: Optional[str] = None,
    signal_source: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    """Query trades with filters."""
    conn = _get_conn()
    conditions = []
    params: list = []

    if symbol:
        conditions.append("symbol LIKE ?")
        params.append(f"%{symbol}%")
    if status:
        conditions.append("status = ?")
        params.append(status)
    if signal_source:
        conditions.append("signal_source = ?")
        params.append(signal_source)
    if date_from:
        conditions.append("timestamp >= ?")
        params.append(date_from)
    if date_to:
        conditions.append("timestamp <= ?")
        params.append(date_to)

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params.extend([limit, offset])

    rows = conn.execute(
        f"SELECT * FROM trades {where} ORDER BY timestamp DESC LIMIT ? OFFSET ?",
        params,
    ).fetchall()
    return [_row_to_dict(r) for r in rows]


def get_pnl_summary() -> dict:
    """Aggregate P&L summary across all trades."""
    conn = _get_conn()
    row = conn.execute("""
        SELECT
            COUNT(*) as total_trades,
            COUNT(CASE WHEN realized_pnl IS NOT NULL AND realized_pnl > 0 THEN 1 END) as winning_trades,
            COUNT(CASE WHEN realized_pnl IS NOT NULL AND realized_pnl < 0 THEN 1 END) as losing_trades,
            COUNT(CASE WHEN realized_pnl IS NOT NULL AND realized_pnl = 0 THEN 1 END) as breakeven_trades,
            COALESCE(SUM(realized_pnl), 0) as total_pnl,
            COALESCE(AVG(CASE WHEN realized_pnl > 0 THEN realized_pnl END), 0) as avg_win,
            COALESCE(AVG(CASE WHEN realized_pnl < 0 THEN realized_pnl END), 0) as avg_loss,
            COALESCE(MAX(realized_pnl), 0) as best_trade,
            COALESCE(MIN(realized_pnl), 0) as worst_trade,
            COALESCE(SUM(CASE WHEN realized_pnl > 0 THEN realized_pnl END), 0) as gross_profit,
            COALESCE(ABS(SUM(CASE WHEN realized_pnl < 0 THEN realized_pnl END)), 0) as gross_loss
        FROM trades
    """).fetchone()

    total = row["total_trades"]
    winners = row["winning_trades"]
    losers = row["losing_trades"]
    gross_profit = row["gross_profit"]
    gross_loss = row["gross_loss"]

    win_rate = (winners / (winners + losers) * 100) if (winners + losers) > 0 else 0
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else float("inf") if gross_profit > 0 else 0

    return {
        "total_trades": total,
        "winning_trades": winners,
        "losing_trades": losers,
        "breakeven_trades": row["breakeven_trades"],
        "total_pnl": round(row["total_pnl"], 2),
        "avg_win": round(row["avg_win"], 2),
        "avg_loss": round(row["avg_loss"], 2),
        "best_trade": round(row["best_trade"], 2),
        "worst_trade": round(row["worst_trade"], 2),
        "win_rate": round(win_rate, 2),
        "profit_factor": round(profit_factor, 2) if profit_factor != float("inf") else "inf",
        "gross_profit": round(gross_profit, 2),
        "gross_loss": round(gross_loss, 2),
    }


def get_trade_stats_by_signal() -> list[dict]:
    """P&L breakdown by signal source."""
    conn = _get_conn()
    rows = conn.execute("""
        SELECT
            signal_source,
            COUNT(*) as total_trades,
            COUNT(CASE WHEN realized_pnl > 0 THEN 1 END) as winners,
            COUNT(CASE WHEN realized_pnl < 0 THEN 1 END) as losers,
            COALESCE(SUM(realized_pnl), 0) as total_pnl,
            COALESCE(AVG(realized_pnl), 0) as avg_pnl
        FROM trades
        GROUP BY signal_source
        ORDER BY total_pnl DESC
    """).fetchall()

    results = []
    for r in rows:
        total = r["winners"] + r["losers"]
        win_rate = (r["winners"] / total * 100) if total > 0 else 0
        results.append({
            "signal_source": r["signal_source"],
            "total_trades": r["total_trades"],
            "winners": r["winners"],
            "losers": r["losers"],
            "total_pnl": round(r["total_pnl"], 2),
            "avg_pnl": round(r["avg_pnl"], 2),
            "win_rate": round(win_rate, 2),
        })
    return results


def log_engine_event(
    event_type: str,
    ticker: Optional[str] = None,
    details: Optional[dict] = None,
    trade_id: Optional[int] = None,
) -> int:
    """Insert an engine activity log entry."""
    conn = _get_conn()
    now = datetime.now(timezone.utc).isoformat()
    cur = conn.execute(
        "INSERT INTO engine_log (timestamp, event_type, ticker, details, trade_id) VALUES (?, ?, ?, ?, ?)",
        (now, event_type, ticker, json.dumps(details) if details else None, trade_id),
    )
    conn.commit()
    return cur.lastrowid


def get_engine_logs(
    event_type: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict]:
    """Query engine activity logs."""
    conn = _get_conn()
    if event_type:
        rows = conn.execute(
            "SELECT * FROM engine_log WHERE event_type = ? ORDER BY timestamp DESC LIMIT ? OFFSET ?",
            (event_type, limit, offset),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM engine_log ORDER BY timestamp DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def _row_to_dict(row: sqlite3.Row) -> dict:
    """Convert a sqlite3.Row to a dict, parsing JSON fields."""
    d = dict(row)
    for key in ("signal_data", "details", "metadata"):
        if key in d and d[key] is not None:
            try:
                d[key] = json.loads(d[key])
            except (json.JSONDecodeError, TypeError):
                pass
    return d
