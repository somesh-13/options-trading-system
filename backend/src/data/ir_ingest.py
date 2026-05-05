"""Stitch the IR pipeline together: scrape → upsert → classify.

This is the only place the three layers (data.ir_scraper, robinhood.database,
data.ir_classifier) meet. Both the API endpoints (`/api/ir/...`) and the
scheduler job (`refresh_ir_for_holdings`) import `refresh_ir_for_ticker`
from here so the behaviour stays identical regardless of trigger.
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

from data.ir_classifier import classify_ir_item  # type: ignore
from data.ir_scraper import aggregate_ir_data  # type: ignore
from robinhood import database as rh_db

log = logging.getLogger(__name__)


def _hash(ticker: str, source: str, link: Optional[str], title: str) -> str:
    blob = f"{ticker}|{source}|{link or ''}|{title}".encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def _yahoo_published_iso(epoch: object) -> Optional[str]:
    """Yahoo's `providerPublishTime` is a unix epoch (int). EDGAR's `<updated>`
    is already an ISO string and goes through unchanged."""
    if not epoch:
        return None
    if isinstance(epoch, str):
        return epoch
    try:
        return datetime.fromtimestamp(int(epoch), tz=timezone.utc).strftime(
            "%Y-%m-%dT%H:%M:%SZ"
        )
    except (TypeError, ValueError, OSError):
        return None


def _normalize_news(ticker: str, news: List[dict]) -> List[dict]:
    """Convert Yahoo news rows to the ir_filing schema shape."""
    rows = []
    for n in news or []:
        title = (n.get("title") or "").strip()
        if not title:
            continue
        link = n.get("link")
        rows.append({
            "item_hash": _hash(ticker, "yahoo_news", link, title),
            "ticker": ticker,
            "source": "yahoo_news",
            "item_type": n.get("type") or "STORY",
            "title": title,
            "publisher": n.get("publisher"),
            "link": link,
            "published_at": _yahoo_published_iso(n.get("published")),
            "body_excerpt": (n.get("summary") or "")[:2048] or None,
            "raw_json": json.dumps(n, default=str),
        })
    return rows


def _normalize_filings(ticker: str, filings: List[dict]) -> List[dict]:
    """Convert SEC EDGAR filings rows to the ir_filing schema shape."""
    rows = []
    for f in filings or []:
        title = (f.get("title") or "").strip()
        if not title:
            continue
        link = f.get("link")
        rows.append({
            "item_hash": _hash(ticker, "sec_edgar", link, title),
            "ticker": ticker,
            "source": "sec_edgar",
            "item_type": f.get("type") or "SEC_FILING",
            "title": title,
            "publisher": "SEC EDGAR",
            "link": link,
            "published_at": (f.get("date") or None) or None,
            "body_excerpt": None,
            "raw_json": json.dumps(f, default=str),
        })
    return rows


def refresh_ir_for_ticker(
    ticker: str,
    force_reclassify: bool = False,
) -> Dict[str, object]:
    """Full pipeline for a single ticker: scrape, upsert, classify.

    Returns a dict with `new_items`, `classified`, `total`, and `errors`.
    Never raises — exceptions are caught and surfaced through `errors` so
    one bad ticker can't take down the whole cron run.
    """
    ticker = ticker.upper().strip()
    errors: List[str] = []
    new_items = 0

    try:
        bundle = aggregate_ir_data(ticker)
    except Exception as e:  # pragma: no cover — scraper is best-effort
        log.exception("aggregate_ir_data failed for %s", ticker)
        errors.append(f"scrape: {e}")
        bundle = {"news": [], "filings": []}

    rows = _normalize_news(ticker, bundle.get("news") or []) + _normalize_filings(
        ticker, bundle.get("filings") or []
    )
    for row in rows:
        try:
            if rh_db.upsert_ir_filing(row):
                new_items += 1
        except Exception as e:  # pragma: no cover — sqlite shouldn't fail mid-loop
            log.exception("upsert_ir_filing failed for %s/%s", ticker, row["title"][:60])
            errors.append(f"upsert: {e}")

    # Classification pass. Either every NULL row, or every row when force.
    if force_reclassify:
        candidates = rh_db.get_ir_filings(ticker, limit=200)
    else:
        candidates = rh_db.get_unclassified_ir_filings(ticker=ticker, limit=200)

    classified = 0
    for row in candidates:
        title = row["title"] or ""
        body = row["body_excerpt"] or ""
        try:
            verdict = classify_ir_item(ticker, title, body)
            rh_db.update_ir_classification(
                item_hash=row["item_hash"],
                thesis=verdict["thesis"],
                confidence=verdict["confidence"],
                rationale=verdict["rationale"],
                classifier=verdict["classifier"],
            )
            classified += 1
        except Exception as e:
            log.exception("classify failed for %s/%s", ticker, title[:60])
            errors.append(f"classify: {e}")

    counts = rh_db.count_ir_thesis(ticker)
    return {
        "ticker": ticker,
        "new_items": new_items,
        "classified": classified,
        "total": int(counts.get("TOTAL", 0)),
        "errors": errors,
    }


def held_tickers_from_snapshots() -> List[str]:
    """Tickers the user actually holds across any RH account.

    Reads the latest live snapshot per account, unions the equity + option
    underlying tickers, and returns a sorted list. Empty list when no
    snapshots exist (caller should fall back to a watchlist).
    """
    seen = set()
    try:
        from robinhood.portfolio import (  # type: ignore
            compute_live_holdings,
            compute_live_options,
        )

        for h in compute_live_holdings("all") or []:
            if h.symbol:
                seen.add(h.symbol.upper())
        for o in compute_live_options("all") or []:
            if o.underlying:
                seen.add(o.underlying.upper())
    except Exception:
        log.exception("Failed to resolve held tickers from live snapshots")
        return []
    return sorted(seen)
