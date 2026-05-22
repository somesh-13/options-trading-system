"""FINRA Consolidated Short Interest history.

FINRA publishes bi-monthly settlement-date snapshots of short interest for
NMS-listed (NYSE / Nasdaq) securities — same data brokerages use. Free, no
auth, JSON. We cache per-ticker results on disk for 24h to avoid hammering
the API.

Endpoint: POST https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest
Filter:   compareFilters[symbolCode = TICKER]
Returns:  list of dicts with symbolCode, settlementDate, currentShortPositionQuantity,
          previousShortPositionQuantity, changePercent, daysToCoverQuantity,
          averageDailyVolumeQuantity, marketClassCode, issueName.
"""

from __future__ import annotations

import json
import logging
import os
import pathlib
import time
from typing import Any, Dict, List, Optional

import requests

log = logging.getLogger(__name__)

API_URL = "https://api.finra.org/data/group/otcMarket/name/consolidatedShortInterest"
CACHE_DIR = pathlib.Path(__file__).resolve().parents[2] / ".cache" / "finra"
CACHE_TTL_SEC = 24 * 60 * 60  # bi-monthly data; daily refresh is plenty
HTTP_TIMEOUT_SEC = 30
DEFAULT_LIMIT = 100  # caller-facing default — how many rows we return after sort
# FINRA does not honor sort by settlementDate when the partition key isn't
# pinned, so a small `limit` clips off recent records on big-history tickers
# (AAPL etc.). Pull the full window in one shot, sort client-side, then trim.
FETCH_LIMIT = 5000


def _atomic_write_json(path: pathlib.Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload))
    os.replace(tmp, path)


def _cache_path(ticker: str) -> pathlib.Path:
    return CACHE_DIR / f"{ticker.upper()}.json"


def _fetch_remote(ticker: str) -> List[Dict[str, Any]]:
    """Hit FINRA's public API. Returns [] on any non-200 / network failure
    rather than raising — this is enrichment data, not load-bearing."""
    body = {
        "limit": FETCH_LIMIT,
        "compareFilters": [
            {"compareType": "EQUAL", "fieldName": "symbolCode", "fieldValue": ticker.upper()}
        ],
    }
    try:
        resp = requests.post(
            API_URL,
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            json=body,
            timeout=HTTP_TIMEOUT_SEC,
        )
    except requests.RequestException as exc:
        log.warning("FINRA short interest fetch failed for %s: %s", ticker, exc)
        return []

    if resp.status_code == 204:
        return []  # no records (e.g. ticker isn't NMS-listed)
    if resp.status_code != 200:
        log.warning(
            "FINRA short interest non-200 for %s: %s %s",
            ticker, resp.status_code, resp.text[:200],
        )
        return []

    try:
        rows = resp.json()
    except ValueError:
        return []
    return rows if isinstance(rows, list) else []


def _normalize(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Project FINRA's verbose schema down to a JSON-clean list, sorted newest first."""
    out: List[Dict[str, Any]] = []
    for r in rows:
        sd = r.get("settlementDate")
        if not sd:
            continue
        out.append({
            "settlementDate": sd,                         # "YYYY-MM-DD"
            "shortInterest": r.get("currentShortPositionQuantity"),
            "previousShortInterest": r.get("previousShortPositionQuantity"),
            "changePercent": r.get("changePercent"),      # period-over-period %, decimal points (e.g. 4.51)
            "daysToCover": r.get("daysToCoverQuantity"),
            "avgDailyVolume": r.get("averageDailyVolumeQuantity"),
            "market": r.get("marketClassCode"),           # NYSE / NASDAQ
        })
    out.sort(key=lambda r: r["settlementDate"], reverse=True)
    return out


def get_short_interest_history(
    ticker: str,
    limit: int = DEFAULT_LIMIT,
    force_refresh: bool = False,
) -> List[Dict[str, Any]]:
    """Return up to `limit` most-recent FINRA bi-monthly short-interest records.

    Disk-cached for 24h per ticker. Returns [] when the ticker is OTC-only
    (not in the NMS dataset) or when FINRA is unreachable.
    """
    ticker = ticker.upper()
    cache_path = _cache_path(ticker)

    if not force_refresh and cache_path.exists():
        age = time.time() - cache_path.stat().st_mtime
        if age < CACHE_TTL_SEC:
            try:
                cached = json.loads(cache_path.read_text())
                if isinstance(cached, dict) and "history" in cached:
                    return cached["history"][:limit]
            except (json.JSONDecodeError, OSError):
                pass  # fall through to refetch

    rows = _fetch_remote(ticker)
    history = _normalize(rows)

    try:
        _atomic_write_json(cache_path, {"_ts": time.time(), "ticker": ticker, "history": history})
    except OSError as exc:
        log.warning("FINRA cache write failed for %s: %s", ticker, exc)

    return history[:limit]


def get_latest_short_interest(ticker: str) -> Optional[Dict[str, Any]]:
    """Convenience: most-recent FINRA settlement record, or None."""
    history = get_short_interest_history(ticker, limit=1)
    return history[0] if history else None
