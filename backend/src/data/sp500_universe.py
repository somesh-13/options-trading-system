"""
S&P 500 ticker list, sourced from Wikipedia.

Wikipedia is the canonical free reference for the S&P 500 constituents (the
official S&P license-protected list isn't available without a paid feed).
The list is disk-cached for 7 days; the index changes only a few times a year
so weekly is plenty fresh.

Wikipedia uses Class B share notation `BRK.B`; SEC uses `BRK-B`. We normalize
to the SEC form on the way out so callers can hand tickers straight to
`get_cik_for_ticker`.
"""

from __future__ import annotations

import json
import logging
import pathlib
import time
from typing import List, Optional

import requests
from bs4 import BeautifulSoup

from .sec_edgar import CACHE_DIR

log = logging.getLogger(__name__)

UNIVERSE_DIR = CACHE_DIR / "universe"
SP500_CACHE_PATH = UNIVERSE_DIR / "sp500.json"
SP500_TTL_SEC = 7 * 86400

# Common index + sector ETFs to cache-warm alongside the S&P 500.
# Override or extend via the ETF_WATCHLIST_EXTRA env var (comma-separated).
ETF_WATCHLIST = (
    "QQQ", "SPY", "IWM", "DIA",      # broad indices
    "IGV", "XLK", "XLF", "XLE",      # sector
    "VTI", "VOO", "VEA", "VWO",      # broad / international
)

WIKI_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
WIKI_USER_AGENT = "TradingDashboard/1.0 someshdubey13@gmail.com"
HTTP_TIMEOUT_SEC = 20


def _normalize_ticker(t: str) -> str:
    """Wikipedia 'BRK.B' -> SEC 'BRK-B'."""
    return t.strip().upper().replace(".", "-")


def _scrape_wikipedia() -> List[str]:
    headers = {"User-Agent": WIKI_USER_AGENT}
    resp = requests.get(WIKI_URL, headers=headers, timeout=HTTP_TIMEOUT_SEC)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    # The constituents table has id="constituents". Each row's first <td>
    # carries the ticker (linked).
    table = soup.find("table", id="constituents")
    if table is None:
        # Fallback: first wikitable on the page is historically the right one.
        table = soup.find("table", class_="wikitable")
    if table is None:
        raise RuntimeError("S&P 500 constituents table not found on Wikipedia")

    tickers: List[str] = []
    for row in table.find_all("tr")[1:]:
        cell = row.find("td")
        if cell is None:
            continue
        raw = cell.get_text(strip=True)
        if not raw:
            continue
        tickers.append(_normalize_ticker(raw))

    if len(tickers) < 400:  # sanity — we should always pull ~500
        raise RuntimeError(f"S&P 500 scrape returned only {len(tickers)} tickers")
    return tickers


def get_sp500(force_refresh: bool = False) -> List[str]:
    """Return current S&P 500 ticker list (SEC form, e.g. BRK-B). Disk-cached.

    On scrape failure with a stale cache present, the stale cache is served.
    """
    UNIVERSE_DIR.mkdir(parents=True, exist_ok=True)

    if not force_refresh and SP500_CACHE_PATH.exists():
        age = time.time() - SP500_CACHE_PATH.stat().st_mtime
        if age < SP500_TTL_SEC:
            try:
                payload = json.loads(SP500_CACHE_PATH.read_text())
                tickers = payload.get("tickers")
                if isinstance(tickers, list) and len(tickers) >= 400:
                    return tickers
            except Exception:
                pass  # fall through to refresh

    try:
        tickers = _scrape_wikipedia()
    except Exception as exc:
        log.warning("Wikipedia S&P 500 scrape failed: %s", exc)
        if SP500_CACHE_PATH.exists():
            try:
                payload = json.loads(SP500_CACHE_PATH.read_text())
                stale = payload.get("tickers") or []
                if stale:
                    log.warning("Serving stale S&P 500 cache (%d tickers)", len(stale))
                    return stale
            except Exception:
                pass
        return []

    payload = {"tickers": tickers, "fetched_at": time.time(), "source": WIKI_URL}
    tmp = SP500_CACHE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload))
    tmp.replace(SP500_CACHE_PATH)
    return tickers


def get_etf_watchlist() -> List[str]:
    """ETF watchlist for the overnight sync. ETF_WATCHLIST_EXTRA env var
    (comma-separated tickers) is appended; duplicates are dedup'd."""
    import os as _os
    extras_raw = _os.getenv("ETF_WATCHLIST_EXTRA", "")
    extras = [t.strip().upper() for t in extras_raw.split(",") if t.strip()]
    seen = set()
    out: List[str] = []
    for t in [*ETF_WATCHLIST, *extras]:
        if t and t not in seen:
            seen.add(t)
            out.append(t)
    return out


def get_universe_status() -> dict:
    """Lightweight status for the API: count + age of cache."""
    if not SP500_CACHE_PATH.exists():
        return {"present": False, "tickers": 0, "age_sec": None}
    try:
        payload = json.loads(SP500_CACHE_PATH.read_text())
        n = len(payload.get("tickers") or [])
    except Exception:
        n = 0
    age = time.time() - SP500_CACHE_PATH.stat().st_mtime
    return {"present": True, "tickers": n, "age_sec": int(age)}
