"""APScheduler wrapper — first in-process scheduler for VegaEdge.

Registers:
- 16:00 ET daily → resolve open signal outcomes against Alpaca
- 11:00 / 15:00 ET weekdays → invoke the existing vegaedge_daily_alerts_v2 script
- 03:00 UTC daily → prune agent memory (populated in P5)

The scheduler starts lazily; call ``start_scheduler()`` from app startup.
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

log = logging.getLogger(__name__)

# Repo root used to locate vegaedge_daily_alerts_v2.py (sibling of `backend/`).
_REPO_ROOT = Path(__file__).resolve().parents[3]
_ALERT_SCRIPT = _REPO_ROOT / "vegaedge_daily_alerts_v2.py"

_scheduler: Optional[AsyncIOScheduler] = None


def get_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = AsyncIOScheduler(timezone="America/New_York")
    return _scheduler


def start_scheduler() -> AsyncIOScheduler:
    """Start the scheduler and register all recurring jobs (idempotent)."""
    sched = get_scheduler()
    if sched.running:
        return sched

    sched.add_job(
        resolve_open_signals,
        trigger=CronTrigger(day_of_week="mon-fri", hour=16, minute=0),
        id="resolve_outcomes_4pm_et",
        replace_existing=True,
    )
    sched.add_job(
        run_daily_alerts,
        trigger=CronTrigger(day_of_week="mon-fri", hour=11, minute=0),
        id="daily_alerts_11am_et",
        replace_existing=True,
    )
    sched.add_job(
        run_daily_alerts,
        trigger=CronTrigger(day_of_week="mon-fri", hour=15, minute=0),
        id="daily_alerts_3pm_et",
        replace_existing=True,
    )
    # Memory pruning hook — populated in P5, safe no-op until then.
    sched.add_job(
        prune_agent_memory,
        trigger=CronTrigger(hour=3, minute=0, timezone="UTC"),
        id="prune_agent_memory",
        replace_existing=True,
    )

    # Recommendation watchlist scan → POSTs to remote Claude agent.
    # No-op when REMOTE_AGENT_WEBHOOK_URL/TOKEN aren't set.
    sched.add_job(
        run_recommend_scan,
        trigger=CronTrigger(
            day_of_week="mon-fri",
            hour="9-16",
            minute="*/30",
        ),
        id="recommend_watchlist_scan",
        replace_existing=True,
    )

    # IR feed refresh: 3x weekday (10:15 / 14:15 / 18:15 ET). Per-ticker fan-out
    # over the user's held positions; one Gemini classify per new item.
    sched.add_job(
        refresh_ir_for_holdings,
        trigger=CronTrigger(day_of_week="mon-fri", hour="10,14,18", minute=15),
        id="ir_refresh_holdings",
        replace_existing=True,
    )

    sched.start()
    log.info("Scheduler started with jobs: %s", [j.id for j in sched.get_jobs()])
    return sched


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None and _scheduler.running:
        _scheduler.shutdown(wait=False)
    _scheduler = None


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------


def resolve_open_signals() -> int:
    """Resolve outcomes for every open signal using current Alpaca prices.

    A signal is considered resolved when its linked option has expired or we
    observe a hard breach. Unresolved rows stay ``OPEN`` for tomorrow's pass.
    Returns the number of rows updated.
    """
    from journal.database import get_open_signals, init_db, log_signal_outcome

    init_db()
    rows = get_open_signals()
    updated = 0
    for row in rows:
        try:
            updated += _resolve_one(row, log_signal_outcome)
        except Exception:
            log.exception("Failed to resolve signal %s", row.get("signal_id"))
    log.info("resolve_open_signals: %d/%d rows updated", updated, len(rows))
    return updated


def _resolve_one(row: dict, logger) -> int:
    """Best-effort resolution for a single signal. Falls back to OPEN on any error."""
    signal_id = row["signal_id"]
    entry_price = float(row.get("premium") or 0.0) or 1.0  # placeholder when no premium captured

    expiry = row.get("expiry")
    expired = False
    if expiry:
        try:
            expired = datetime.fromisoformat(expiry).date() < datetime.now(timezone.utc).date()
        except Exception:
            expired = False

    outcome = "EXPIRED" if expired else "OPEN"
    if expired:
        logger(
            signal_id=signal_id,
            entry_price=entry_price,
            exit_price=0.0,
            pnl=-entry_price * 100.0,
            pnl_pct=-1.0,
            outcome="EXPIRED",
            exit_reason="EXPIRY",
        )
    else:
        logger(
            signal_id=signal_id,
            entry_price=entry_price,
            exit_price=None,
            pnl=None,
            pnl_pct=None,
            outcome="OPEN",
            exit_reason=None,
        )

    # P5 — propagate the outcome to agent_memory quality scores.
    try:
        from agents.memory import update_quality_on_outcome

        update_quality_on_outcome(signal_id, outcome)
    except Exception:
        log.exception("update_quality_on_outcome failed for %s", signal_id)

    return 1 if expired else 0


def run_daily_alerts() -> int:
    """Fire the legacy WhatsApp alert script as a subprocess."""
    if not _ALERT_SCRIPT.exists():
        log.warning("Alert script missing at %s", _ALERT_SCRIPT)
        return -1
    env = os.environ.copy()
    try:
        proc = subprocess.run(
            [sys.executable, str(_ALERT_SCRIPT)],
            cwd=str(_REPO_ROOT),
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )
        if proc.returncode != 0:
            log.warning("Alert script exited %s: %s", proc.returncode, proc.stderr[:500])
        return proc.returncode
    except Exception:
        log.exception("Alert subprocess failed")
        return -1


def prune_agent_memory() -> int:
    """P5 hook — no-op until the memory layer lands."""
    try:
        from agents.memory import prune_memory  # type: ignore
    except ImportError:
        return 0
    return prune_memory()  # type: ignore[no-any-return]


def run_recommend_scan() -> dict:
    """Synchronous wrapper around the async dispatcher so APScheduler can run it.

    Safe to invoke when the webhook isn't configured — `scan_and_dispatch`
    short-circuits and returns ``{"configured": False}``.
    """
    import asyncio as _asyncio

    from recommend.webhook import scan_and_dispatch

    try:
        # If a loop is already running (e.g. inside FastAPI), schedule on it.
        loop = _asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        future = _asyncio.run_coroutine_threadsafe(scan_and_dispatch(), loop)
        return future.result(timeout=120)
    return _asyncio.run(scan_and_dispatch())


# Static fallback when the user has no live snapshot yet (e.g. fresh install).
# Mirrors the small VegaEdge watchlist used elsewhere in the project.
_IR_FALLBACK_WATCHLIST = ("HOOD", "CIFR", "WULF", "PYPL", "GRAB")


def refresh_ir_for_holdings() -> dict:
    """Per-ticker fan-out of the IR refresh pipeline.

    Pulls the union of all tickers across the user's live RH snapshots
    (equities + option underlyings, all accounts). Falls back to a small
    watchlist when no snapshot exists. Throttles to ~1 ticker / 1.5 s to
    stay well under SEC EDGAR's 10 req/s ceiling and Yahoo's soft caps.
    Per-ticker failures are logged but never raise — one bad ticker
    cannot take down the whole job.
    """
    import time as _time

    from data.ir_ingest import held_tickers_from_snapshots, refresh_ir_for_ticker

    tickers = held_tickers_from_snapshots() or list(_IR_FALLBACK_WATCHLIST)
    log.info("refresh_ir_for_holdings: %d tickers", len(tickers))
    summary = {"tickers": len(tickers), "new_items": 0, "classified": 0, "errors": 0}
    for i, t in enumerate(tickers):
        try:
            r = refresh_ir_for_ticker(t)
            summary["new_items"] += int(r.get("new_items", 0))
            summary["classified"] += int(r.get("classified", 0))
            summary["errors"] += len(r.get("errors", []))
        except Exception:
            log.exception("refresh_ir_for_ticker(%s) failed", t)
            summary["errors"] += 1
        if i + 1 < len(tickers):
            _time.sleep(1.5)
    log.info("refresh_ir_for_holdings done: %s", summary)
    return summary
