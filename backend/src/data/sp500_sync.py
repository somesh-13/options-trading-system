"""
Overnight cache-warmer for the S&P 500 SEC EDGAR data.

Per ticker:
  1. Resolve CIK via the cached ticker map.
  2. Pull companyfacts JSON (24h disk cache → daily-fresh on second pass).
  3. List recent filings via submissions API.
  4. For each 8-K, fetch + cache exhibit 99.1 body.
  5. Pre-compute the extracted fundamentals digest (cheap, in-memory only).

After this runs, every `/api/sec/companyfacts/{ticker}` and
`/api/sec/filings/{ticker}` request for an S&P 500 name lands on a warm cache.
Status is persisted to `backend/.cache/sec/sync_status.json` so the API
endpoint can report progress and the next run is resumable.

Run as a script:
    python -m data.sp500_sync           # full sync, all 503 tickers
    python -m data.sp500_sync --limit 10 # smoke test on first 10
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import pathlib
import sys
import threading
import time
from typing import Any, Dict, List, Optional

from .sec_edgar import (
    CACHE_DIR,
    extract_sec_fundamentals,
    fetch_company_facts,
    get_cik_for_ticker,
)
from .sec_exhibits import scrape_filings_with_bodies
from .sp500_universe import get_etf_watchlist, get_sp500

log = logging.getLogger(__name__)

STATUS_PATH = CACHE_DIR / "sync_status.json"
STATUS_LOCK = threading.Lock()

# How many recent filings per ticker to fetch (covers ~1.5 years of activity).
FILINGS_PER_TICKER = 15

# A running sync sets this so two simultaneous starts can't kick the same job.
_RUNNING = threading.Event()


def _read_status() -> Dict[str, Any]:
    if not STATUS_PATH.exists():
        return {}
    try:
        return json.loads(STATUS_PATH.read_text())
    except Exception:
        return {}


def _write_status(status: Dict[str, Any]) -> None:
    with STATUS_LOCK:
        STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
        tmp = STATUS_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(status))
        tmp.replace(STATUS_PATH)


def get_sync_status() -> Dict[str, Any]:
    """Public read of the status file. Adds a `running` flag from the lock."""
    status = _read_status()
    status["running"] = _RUNNING.is_set()
    return status


def is_running() -> bool:
    return _RUNNING.is_set()


def _sync_one(ticker: str) -> Dict[str, Any]:
    """Warm the cache for a single ticker. Routes ETFs to yfinance and operating
    companies to SEC EDGAR. Errors are captured, not raised."""
    started = time.time()

    # ETF detection runs first so we don't waste an SEC roundtrip on funds.
    try:
        from .etf_fundamentals import get_etf_fundamentals, is_etf  # type: ignore
        ticker_is_etf = is_etf(ticker)
    except Exception as exc:
        log.warning("is_etf check failed for %s: %s", ticker, exc)
        ticker_is_etf = False

    if ticker_is_etf:
        out: Dict[str, Any] = {
            "ticker": ticker,
            "kind": "etf",
            "facts_ok": False,
            "filings_count": 0,
            "bodies_count": 0,
            "errors": [],
        }
        try:
            digest = get_etf_fundamentals(ticker)
            # facts_ok = "useful data was returned" (AUM at minimum).
            out["facts_ok"] = bool(digest.get("totalAssets"))
            out["holdings_count"] = len(digest.get("topHoldings") or [])
            out["sectors_count"] = len(digest.get("sectorWeights") or {})
        except Exception as exc:
            out["errors"].append(f"etf: {exc}")
        out["elapsed_sec"] = round(time.time() - started, 2)
        return out

    # Operating-company path (unchanged).
    out = {
        "ticker": ticker,
        "kind": "stock",
        "cik": None,
        "facts_ok": False,
        "filings_count": 0,
        "bodies_count": 0,
        "errors": [],
    }

    cik = get_cik_for_ticker(ticker)
    if cik is None:
        out["errors"].append("no_cik")
        out["elapsed_sec"] = round(time.time() - started, 2)
        return out
    out["cik"] = cik

    try:
        facts = fetch_company_facts(cik)
        out["facts_ok"] = bool(facts)
    except Exception as exc:
        out["errors"].append(f"facts: {exc}")

    try:
        filings = scrape_filings_with_bodies(ticker, limit=FILINGS_PER_TICKER)
        out["filings_count"] = len(filings)
        out["bodies_count"] = sum(1 for f in filings if f.get("body_excerpt"))
    except Exception as exc:
        out["errors"].append(f"filings: {exc}")

    # Pre-extract Income / Balance / Cash Flow + Ratios for both periods. The
    # underlying companyfacts JSON is already cached, so each call is just an
    # in-memory parse + disk write (~50ms per call).
    try:
        from data.sec_statements import (
            get_income_statement,
            get_balance_sheet,
            get_cash_flow,
        )
        from data.financial_ratios import get_ratios

        statements_complete = 0
        for period in ("annual", "quarterly"):
            for fn in (get_income_statement, get_balance_sheet, get_cash_flow):
                r = fn(ticker, period)  # type: ignore[arg-type]
                if r.get("rows"):
                    statements_complete += 1
            r_ratios = get_ratios(ticker, period)  # type: ignore[arg-type]
            if r_ratios.get("rows"):
                statements_complete += 1
        out["statements_ok"] = statements_complete >= 4  # ≥ 1 of 4 per period
        out["statements_complete"] = statements_complete
    except Exception as exc:
        out["errors"].append(f"statements: {exc}")
        out["statements_ok"] = False

    out["elapsed_sec"] = round(time.time() - started, 2)
    return out


def _resolve_universe(
    include_sp500: bool,
    include_portfolio: bool,
    force_refresh_universe: bool,
    include_etfs: bool = True,
) -> List[str]:
    """Build the dedup'd ticker list. Portfolio holdings are placed first so
    that, if a `limit` truncates the run, the user's own positions are
    guaranteed to be covered before the broader index. ETFs are appended last
    (they're fast — yfinance only — so order matters less)."""
    portfolio: List[str] = []
    if include_portfolio:
        try:
            from .ir_ingest import held_tickers_from_snapshots  # type: ignore
            portfolio = held_tickers_from_snapshots() or []
        except Exception as exc:
            log.warning("held_tickers_from_snapshots failed: %s", exc)

    sp500: List[str] = []
    if include_sp500:
        sp500 = get_sp500(force_refresh=force_refresh_universe) or []

    etfs: List[str] = []
    if include_etfs:
        etfs = get_etf_watchlist()

    seen = set()
    merged: List[str] = []
    for t in [*portfolio, *sp500, *etfs]:
        # SEC normalizes class shares with dashes (BRK-B). Snapshots and other
        # sources sometimes use dots — coerce here so get_cik_for_ticker hits.
        u = (t or "").upper().strip().replace(".", "-")
        if u and u not in seen:
            seen.add(u)
            merged.append(u)
    return merged


def sync_sp500(
    limit: Optional[int] = None,
    force_refresh_universe: bool = False,
    include_portfolio: bool = True,
    include_sp500: bool = True,
    include_etfs: bool = True,
) -> Dict[str, Any]:
    """Cache-warm SEC EDGAR data for portfolio + S&P 500 + ETF watchlist.

    Portfolio holdings are processed first so they're always covered even
    when `limit` truncates a run. ETFs route to yfinance (no SEC fetch).
    Idempotent: cache hits are no-ops. Returns a summary dict; full
    per-ticker results live in the status file.
    """
    if _RUNNING.is_set():
        return {"started": False, "reason": "already_running"}

    _RUNNING.set()
    try:
        tickers = _resolve_universe(
            include_sp500=include_sp500,
            include_portfolio=include_portfolio,
            force_refresh_universe=force_refresh_universe,
            include_etfs=include_etfs,
        )
        if limit is not None:
            tickers = tickers[: max(0, int(limit))]
        if not tickers:
            return {"started": False, "reason": "no_tickers"}

        # Re-derive what came from each source so the status surfaces both counts.
        portfolio_set = set()
        if include_portfolio:
            try:
                from .ir_ingest import held_tickers_from_snapshots  # type: ignore
                portfolio_set = set(held_tickers_from_snapshots() or [])
            except Exception:
                portfolio_set = set()

        run_started = time.time()
        status: Dict[str, Any] = {
            "started_at": run_started,
            "completed_at": None,
            "tickers_total": len(tickers),
            "portfolio_total": sum(1 for t in tickers if t in portfolio_set),
            "sp500_total": sum(1 for t in tickers if t not in portfolio_set),
            "tickers_processed": 0,
            "tickers_with_facts": 0,
            "tickers_with_bodies": 0,
            "tickers_failed": [],
            "current_ticker": None,
            "results": [],
        }
        _write_status(status)

        for i, t in enumerate(tickers):
            status["current_ticker"] = t
            _write_status(status)

            result = _sync_one(t)
            status["results"].append(result)
            status["tickers_processed"] = i + 1
            if result["facts_ok"]:
                status["tickers_with_facts"] += 1
            if result["bodies_count"]:
                status["tickers_with_bodies"] += 1
            if result["errors"]:
                status["tickers_failed"].append(t)

            # Persist progress every 5 tickers — frequent enough for the UI,
            # cheap given how small the JSON is.
            if (i + 1) % 5 == 0 or (i + 1) == len(tickers):
                _write_status(status)

        status["current_ticker"] = None
        status["completed_at"] = time.time()
        status["total_elapsed_sec"] = round(status["completed_at"] - run_started, 2)
        _write_status(status)

        return {
            "started": True,
            "tickers_total": status["tickers_total"],
            "tickers_with_facts": status["tickers_with_facts"],
            "tickers_with_bodies": status["tickers_with_bodies"],
            "tickers_failed": len(status["tickers_failed"]),
            "elapsed_sec": status["total_elapsed_sec"],
        }
    finally:
        _RUNNING.clear()


def kick_off_in_thread(limit: Optional[int] = None) -> Dict[str, Any]:
    """Launch sync_sp500 in a daemon thread so an HTTP caller doesn't block.

    Returns immediately. Caller should poll `get_sync_status()` for progress.
    """
    if _RUNNING.is_set():
        return {"started": False, "reason": "already_running"}

    def _runner():
        try:
            sync_sp500(limit=limit)
        except Exception:
            log.exception("sync_sp500 background thread crashed")

    t = threading.Thread(target=_runner, name="sp500_sync", daemon=True)
    t.start()
    return {"started": True, "in_thread": True}


def _cli() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    parser = argparse.ArgumentParser(description="Sync SEC EDGAR data for the S&P 500.")
    parser.add_argument("--limit", type=int, default=None, help="Process only the first N tickers.")
    parser.add_argument("--refresh-universe", action="store_true", help="Force re-fetch the S&P 500 list from Wikipedia.")
    args = parser.parse_args()

    summary = sync_sp500(limit=args.limit, force_refresh_universe=args.refresh_universe)
    print(json.dumps(summary, indent=2))
    return 0 if summary.get("started") else 1


if __name__ == "__main__":
    # Allow running as `python -m data.sp500_sync` from backend/src/.
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
    sys.exit(_cli())
