"""Option-chain snapshot writer.

Writes a full option chain (all expirations × all strikes × calls+puts) for a
single ticker into `option_chain_snapshot` so detectors can later compute
OI deltas, premium flow, and IV percentiles. Reuses the existing market
provider seam — RH primary, yfinance fallback (or whatever MARKET_PROVIDER
is configured to).

Designed to be called from the daily scheduler cron (16:05 ET) in
`engine/scheduler.py`. CLI entry point at the bottom for manual smoke-tests:

    python -m data.option_snapshots --ticker AAPL
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

# Match the sys.path pattern other backend modules use.
sys.path.append(str(Path(__file__).parent.parent))

from data.market_provider import (  # noqa: E402
    OptionChain,
    OptionContract,
    get_option_chain,
    get_option_expirations,
    get_quote,
)
from journal.database import _get_conn, init_db  # noqa: E402

log = logging.getLogger(__name__)

# Cap on how many expirations we capture per ticker per snapshot. Most flow
# is concentrated in the front 4–6 expirations; capturing every weekly out
# to LEAPS would 10× the row count for marginal signal.
DEFAULT_MAX_EXPIRATIONS = 6


def _mid(bid: Optional[float], ask: Optional[float]) -> Optional[float]:
    if bid is None or ask is None:
        return None
    if bid <= 0 and ask <= 0:
        return None
    return round((bid + ask) / 2.0, 4)


def _insert_chain_rows(
    *,
    snapshot_at: str,
    ticker: str,
    chain: OptionChain,
    spot: Optional[float],
) -> int:
    """Insert one row per contract in this chain. Returns rows written."""
    conn = _get_conn()
    rows: List[tuple] = []
    for side, contracts in (("call", chain.calls), ("put", chain.puts)):
        for c in contracts:
            rows.append((
                snapshot_at,
                ticker.upper(),
                chain.expiration,
                float(c.strike),
                side,
                c.bid,
                c.ask,
                _mid(c.bid, c.ask),
                c.implied_volatility,
                c.open_interest,
                c.volume,
                spot,
            ))
    if not rows:
        return 0
    conn.executemany(
        """INSERT INTO option_chain_snapshot
           (snapshot_at, ticker, expiration, strike, side,
            bid, ask, mid, iv, oi, volume, spot)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        rows,
    )
    conn.commit()
    return len(rows)


def snapshot_chain(
    ticker: str,
    *,
    max_expirations: int = DEFAULT_MAX_EXPIRATIONS,
    snapshot_at: Optional[str] = None,
) -> Tuple[int, Optional[str]]:
    """Snapshot the front N expirations for `ticker`.

    Returns (rows_written, error). On any provider error the function
    returns whatever was already written and surfaces the error string —
    callers (scheduler fan-out) decide whether to retry.
    """
    sym = ticker.upper()
    snapshot_at = snapshot_at or datetime.now(timezone.utc).isoformat()

    # Resolve expirations + spot once.
    try:
        expirations = get_option_expirations(sym) or []
    except Exception as exc:  # noqa: BLE001
        return 0, f"get_option_expirations({sym}) failed: {exc}"

    if not expirations:
        return 0, f"no expirations for {sym}"

    spot: Optional[float] = None
    try:
        q = get_quote(sym)
        spot = q.price
    except Exception:
        # Spot is informational; chain rows are still useful without it.
        spot = None

    total_rows = 0
    last_error: Optional[str] = None
    for exp in expirations[:max_expirations]:
        try:
            chain = get_option_chain(sym, exp)
        except Exception as exc:  # noqa: BLE001
            last_error = f"get_option_chain({sym}, {exp}) failed: {exc}"
            continue
        try:
            total_rows += _insert_chain_rows(
                snapshot_at=snapshot_at,
                ticker=sym,
                chain=chain,
                spot=spot,
            )
        except Exception as exc:  # noqa: BLE001
            last_error = f"insert_chain_rows({sym}, {exp}) failed: {exc}"
            continue

    return total_rows, last_error


def snapshot_watchlist(
    tickers: Iterable[str],
    *,
    throttle_sec: float = 1.5,
    max_expirations: int = DEFAULT_MAX_EXPIRATIONS,
) -> dict:
    """Snapshot a list of tickers, throttled to be polite to the provider.

    Mirrors the throttle pattern in engine/scheduler.py:refresh_ir_for_holdings
    — 1.5s between tickers keeps RH happy and gives the 60s provider cache
    time to populate intermediate calls.

    Returns a summary dict for logging:
        {
          'snapshot_at': iso,
          'tickers': N,
          'rows_total': N,
          'errors': {ticker: msg, ...},
        }
    """
    init_db()  # ensure the table exists on cold start
    snapshot_at = datetime.now(timezone.utc).isoformat()
    tickers = [t.upper() for t in tickers if t]
    # Dedupe while preserving order.
    seen: set = set()
    ordered: List[str] = []
    for t in tickers:
        if t not in seen:
            ordered.append(t)
            seen.add(t)

    rows_total = 0
    errors: dict = {}
    for i, sym in enumerate(ordered):
        rows, err = snapshot_chain(
            sym,
            max_expirations=max_expirations,
            snapshot_at=snapshot_at,
        )
        rows_total += rows
        if err:
            errors[sym] = err
        # Throttle between tickers (skip after the last one).
        if i < len(ordered) - 1:
            time.sleep(throttle_sec)

    return {
        "snapshot_at": snapshot_at,
        "tickers": len(ordered),
        "rows_total": rows_total,
        "errors": errors,
    }


# ---------------------------------------------------------------------------
# Read helpers for the /flow page + detectors
# ---------------------------------------------------------------------------

def latest_snapshot_age_hours() -> Optional[float]:
    """Return age in hours of the newest `option_chain_snapshot` row globally.

    `None` when the table is empty. Used by the boot-time hydrate check and
    the `/api/flow/snapshot/run` response.
    """
    conn = _get_conn()
    row = conn.execute(
        "SELECT MAX(snapshot_at) AS latest FROM option_chain_snapshot"
    ).fetchone()
    latest = row["latest"] if row else None
    if not latest:
        return None
    try:
        ts = datetime.fromisoformat(latest)
    except ValueError:
        return None
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - ts).total_seconds() / 3600.0


def latest_snapshot_ticker_count() -> int:
    """Count distinct tickers in the most recent snapshot batch.

    Boot hydrate uses this to detect a degenerate single-ticker manual run
    (e.g. `python -m data.option_snapshots --ticker AAPL`) and re-hydrate
    even when that row is technically fresh by age.
    """
    conn = _get_conn()
    row = conn.execute(
        "SELECT MAX(snapshot_at) AS latest FROM option_chain_snapshot"
    ).fetchone()
    latest = row["latest"] if row else None
    if not latest:
        return 0
    row = conn.execute(
        "SELECT COUNT(DISTINCT ticker) AS n FROM option_chain_snapshot WHERE snapshot_at = ?",
        (latest,),
    ).fetchone()
    return int(row["n"]) if row else 0


def _latest_two_snapshot_timestamps(ticker: str) -> List[str]:
    """Return the two most recent distinct `snapshot_at` timestamps for ticker.

    Detectors compare today vs prior — we don't care about intraday cadence;
    we just want the latest two snapshots regardless of clock time.
    """
    conn = _get_conn()
    rows = conn.execute(
        """SELECT snapshot_at FROM option_chain_snapshot
           WHERE ticker = ?
           GROUP BY snapshot_at
           ORDER BY snapshot_at DESC
           LIMIT 2""",
        (ticker.upper(),),
    ).fetchall()
    return [r["snapshot_at"] for r in rows]


def get_latest_chain(ticker: str) -> List[dict]:
    """Return all contracts from the most recent snapshot for ticker."""
    ts_list = _latest_two_snapshot_timestamps(ticker)
    if not ts_list:
        return []
    conn = _get_conn()
    rows = conn.execute(
        """SELECT * FROM option_chain_snapshot
           WHERE ticker = ? AND snapshot_at = ?
           ORDER BY expiration, side, strike""",
        (ticker.upper(), ts_list[0]),
    ).fetchall()
    return [dict(r) for r in rows]


def get_prior_chain(ticker: str) -> List[dict]:
    """Return all contracts from the second-most-recent snapshot. Used for
    OI-buildup deltas. Empty list when ≤1 snapshot exists."""
    ts_list = _latest_two_snapshot_timestamps(ticker)
    if len(ts_list) < 2:
        return []
    conn = _get_conn()
    rows = conn.execute(
        """SELECT * FROM option_chain_snapshot
           WHERE ticker = ? AND snapshot_at = ?
           ORDER BY expiration, side, strike""",
        (ticker.upper(), ts_list[1]),
    ).fetchall()
    return [dict(r) for r in rows]


def get_atm_iv_history(ticker: str, *, limit: int = 30) -> List[dict]:
    """Return per-snapshot ATM IV (across the front expiration) for IV-rank
    detection. Each row: ``{snapshot_at, expiration, atm_iv, spot}``."""
    conn = _get_conn()
    # ATM = strike closest to spot per snapshot. Computed in SQL via abs(diff)
    # ranking inside each (snapshot_at) partition. Restricted to the front
    # expiration (MIN(expiration) per snapshot) so we get a comparable series.
    rows = conn.execute(
        """SELECT s.snapshot_at, s.expiration, s.iv AS atm_iv, s.spot
           FROM option_chain_snapshot s
           JOIN (
             SELECT snapshot_at, MIN(expiration) AS expiration
             FROM option_chain_snapshot
             WHERE ticker = ? AND iv IS NOT NULL AND spot IS NOT NULL
             GROUP BY snapshot_at
           ) f USING (snapshot_at, expiration)
           WHERE s.ticker = ? AND s.iv IS NOT NULL AND s.spot IS NOT NULL
           GROUP BY s.snapshot_at
           HAVING ABS(s.strike - s.spot) = MIN(ABS(s.strike - s.spot))
           ORDER BY s.snapshot_at DESC
           LIMIT ?""",
        (ticker.upper(), ticker.upper(), int(limit)),
    ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# CLI for manual smoke-tests:  python -m data.option_snapshots --ticker AAPL
# ---------------------------------------------------------------------------

def _main() -> int:
    parser = argparse.ArgumentParser(description="Snapshot an option chain into trades.db")
    parser.add_argument("--ticker", required=True, help="Symbol to snapshot (case-insensitive)")
    parser.add_argument("--max-expirations", type=int, default=DEFAULT_MAX_EXPIRATIONS)
    args = parser.parse_args()

    init_db()
    rows, err = snapshot_chain(args.ticker, max_expirations=args.max_expirations)
    print(f"snapshot_chain({args.ticker.upper()}) → rows={rows}, error={err!r}")
    return 0 if rows > 0 else 1


if __name__ == "__main__":
    sys.exit(_main())
