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

        CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
        CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
        CREATE INDEX IF NOT EXISTS idx_trades_signal_source ON trades(signal_source);
        CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
        CREATE INDEX IF NOT EXISTS idx_engine_log_event_type ON engine_log(event_type);
        CREATE INDEX IF NOT EXISTS idx_engine_log_timestamp ON engine_log(timestamp);
    """)
    conn.commit()


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
    for key in ("signal_data", "details"):
        if key in d and d[key] is not None:
            try:
                d[key] = json.loads(d[key])
            except (json.JSONDecodeError, TypeError):
                pass
    return d
