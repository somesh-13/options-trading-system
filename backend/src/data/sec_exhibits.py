"""
SEC EDGAR filing-index + exhibit-body fetcher.

Lists recent filings via the submissions API (data.sec.gov/submissions/CIK*.json)
and, for 8-Ks, pulls exhibit 99.1 — the earnings press release attached to most
quarterly-results 8-Ks. Reuses the rate-limited HTTP session and User-Agent from
`sec_edgar.py` so we stay under SEC's 10 req/s fair-use cap.

Bodies are cached on disk under `backend/.cache/sec/exhibits/{accession}/` and
treated as immutable — once a filing is on EDGAR, its exhibits don't change.
"""

from __future__ import annotations

import logging
import pathlib
import re
from typing import Dict, List, Optional, Tuple

from bs4 import BeautifulSoup

from .sec_edgar import CACHE_DIR, get_cik_for_ticker, http_get

log = logging.getLogger(__name__)

EXHIBITS_DIR = CACHE_DIR / "exhibits"

# Matches the legacy ex99-1 / ex991 / exhibit991 conventions used by most
# filers (AAPL, MSFT, AMZN, TSLA, etc.).
EXHIBIT_991_PATTERN = re.compile(r"ex(?:hibit)?[-_]?9{2,3}[._-]?1", re.IGNORECASE)

# Used to exclude structural / XBRL files when falling back to a size heuristic
# for filers that use semantic exhibit names (e.g. NVDA's `q4fy26pr.htm`).
INDEX_FILE_PATTERN = re.compile(r"(^|[-_])index([-_]|\.|$)", re.IGNORECASE)
XBRL_VIEWER_PATTERN = re.compile(r"^R\d+\.htm[l]?$", re.IGNORECASE)

MAX_BODY_CHARS = 2048
HTTP_OK = 200
MIN_EXHIBIT_BYTES = 5_000  # below this it's likely not a real press release


def _exhibit_cache_path(accession_clean: str, exhibit_filename: str) -> pathlib.Path:
    return EXHIBITS_DIR / accession_clean / f"{exhibit_filename}.txt"


def _to_int(val) -> int:
    try:
        return int(val)
    except (TypeError, ValueError):
        return 0


def _pick_exhibit_doc(items: List[Dict], primary_doc_lower: str) -> Optional[str]:
    """Pick the most-likely earnings-release exhibit from an EDGAR directory.

    Strategy:
      1. First filename that matches EXHIBIT_991_PATTERN (legacy ex99-1 naming —
         covers AAPL, MSFT, TSLA, AMZN, and the broader S&P 500).
      2. Fallback: largest .htm/.html that isn't the primary doc, isn't an
         index/header file, and isn't an XBRL R*.htm viewer artifact. Catches
         filers that use semantic names (e.g. NVDA `q4fy26pr.htm`).
    """
    htm_items: List[Dict] = []
    for it in items:
        name = (it.get("name") or "").strip()
        if not name:
            continue
        lower = name.lower()
        if not lower.endswith((".htm", ".html", ".txt")):
            continue
        # Strategy 1: regex match on conventional naming.
        if EXHIBIT_991_PATTERN.search(name):
            return name
        htm_items.append({"name": name, "size": _to_int(it.get("size")), "lower": lower})

    # Strategy 2: largest .htm/.html that isn't structural.
    candidates = [
        it for it in htm_items
        if it["lower"] != primary_doc_lower
        and not INDEX_FILE_PATTERN.search(it["name"])
        and not XBRL_VIEWER_PATTERN.match(it["name"])
        and it["size"] >= MIN_EXHIBIT_BYTES
        and it["lower"].endswith((".htm", ".html"))  # exclude .txt full-filings
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda c: c["size"], reverse=True)
    return candidates[0]["name"]


def _clean_html(html: str) -> str:
    """Strip HTML, collapse whitespace. Returns plain text."""
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style"]):
        tag.decompose()
    text = soup.get_text(separator=" ")
    return re.sub(r"\s+", " ", text).strip()


def fetch_recent_filings(
    ticker: str,
    forms: Tuple[str, ...] = ("10-K", "10-Q", "8-K"),
    limit: int = 20,
) -> List[Dict]:
    """List recent filings for a ticker via EDGAR submissions API.

    Each row carries enough info to construct an Archives URL and look up
    exhibits: `accession`, `_accession_clean` (no dashes), `_cik_num` (no
    leading zeros), `primary_doc`, plus `form`, `filing_date`, `link`, `title`.
    """
    cik = get_cik_for_ticker(ticker)
    if cik is None:
        return []

    url = f"https://data.sec.gov/submissions/CIK{cik}.json"
    try:
        r = http_get(url)
    except Exception as exc:
        log.warning("submissions request failed for %s: %s", ticker, exc)
        return []
    if r.status_code != HTTP_OK:
        log.warning("submissions %s for %s", r.status_code, ticker)
        return []
    try:
        payload = r.json()
    except Exception as exc:
        log.warning("submissions JSON decode failed for %s: %s", ticker, exc)
        return []

    recent = (payload.get("filings") or {}).get("recent") or {}
    accessions: List[str] = recent.get("accessionNumber") or []
    forms_list: List[str] = recent.get("form") or []
    dates: List[str] = recent.get("filingDate") or []
    primaries: List[str] = recent.get("primaryDocument") or []

    cik_num = str(int(cik))  # strip leading zeros for archive URLs
    out: List[Dict] = []
    n = min(len(accessions), len(forms_list), len(dates), len(primaries))
    for i in range(n):
        form = forms_list[i]
        if form not in forms:
            continue
        accession = accessions[i]
        accession_clean = accession.replace("-", "")
        primary_doc = primaries[i] or ""
        link = (
            f"https://www.sec.gov/Archives/edgar/data/{cik_num}/{accession_clean}/{primary_doc}"
            if primary_doc
            else f"https://www.sec.gov/Archives/edgar/data/{cik_num}/{accession_clean}/"
        )
        out.append(
            {
                "ticker": ticker.upper(),
                "form": form,
                "filing_date": dates[i],
                "accession": accession,
                "primary_doc": primary_doc,
                "link": link,
                "title": f"{form} filed {dates[i]}",
                "type": form,
                "_cik_num": cik_num,
                "_accession_clean": accession_clean,
            }
        )
        if len(out) >= limit:
            break
    return out


def fetch_exhibit_991_text(filing: Dict) -> Optional[str]:
    """Return cleaned exhibit-99.1 body for an 8-K filing, or None.

    Looks up `index.json` for the filing's directory listing, regex-matches
    against entries named ex99-1.htm / exhibit99_1.html / ex-99.1.txt, fetches
    the matched file, strips HTML, truncates to MAX_BODY_CHARS. Disk-cached
    indefinitely — filings are immutable on EDGAR.
    """
    body = _fetch_or_cache_exhibit_body(filing)
    return body[:MAX_BODY_CHARS] if body else None


def fetch_exhibit_991_full_text(filing: Dict) -> Optional[str]:
    """Like ``fetch_exhibit_991_text`` but returns the entire press release.

    Earnings extraction (data.earnings_extract) needs the full text to find
    income-statement tables that live ~5–15K chars into the document. The
    summary/IR feed still uses the truncated form.
    """
    return _fetch_or_cache_exhibit_body(filing)


def _fetch_or_cache_exhibit_body(filing: Dict) -> Optional[str]:
    """Shared cache+fetch core for the ``_text`` and ``_full_text`` accessors."""
    cik_num = filing.get("_cik_num")
    accession_clean = filing.get("_accession_clean")
    if not cik_num or not accession_clean:
        return None

    # First-pass: serve from cache if any exhibit body is already on disk for
    # this accession. We don't know the exhibit filename yet on a cache hit,
    # so glob the accession dir.
    accession_cache_dir = EXHIBITS_DIR / accession_clean
    if accession_cache_dir.exists():
        for path in accession_cache_dir.iterdir():
            if path.suffix == ".txt":
                try:
                    return path.read_text() or None
                except Exception:
                    pass

    index_url = (
        f"https://www.sec.gov/Archives/edgar/data/{cik_num}/{accession_clean}/index.json"
    )
    try:
        r = http_get(index_url)
    except Exception as exc:
        log.warning("exhibit index request failed for %s: %s", accession_clean, exc)
        return None
    if r.status_code != HTTP_OK:
        return None
    try:
        index = r.json()
    except Exception:
        return None

    items = ((index.get("directory") or {}).get("item")) or []
    primary_doc = (filing.get("primary_doc") or "").lower()

    exhibit_doc: Optional[str] = _pick_exhibit_doc(items, primary_doc)
    if not exhibit_doc:
        return None

    exhibit_url = (
        f"https://www.sec.gov/Archives/edgar/data/{cik_num}/{accession_clean}/{exhibit_doc}"
    )
    try:
        r = http_get(exhibit_url)
    except Exception as exc:
        log.warning("exhibit fetch failed for %s/%s: %s", accession_clean, exhibit_doc, exc)
        return None
    if r.status_code != HTTP_OK:
        return None

    text = _clean_html(r.text)
    if not text:
        return None

    cache_path = _exhibit_cache_path(accession_clean, exhibit_doc)
    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(text)
    except Exception as exc:
        log.warning("exhibit cache write failed for %s: %s", cache_path, exc)

    return text


def scrape_filings_with_bodies(
    ticker: str,
    forms: Tuple[str, ...] = ("10-K", "10-Q", "8-K"),
    limit: int = 10,
) -> List[Dict]:
    """List recent filings and, for 8-Ks, attach exhibit-99.1 body_excerpt.

    Drop-in shape for `ir_scraper.scrape_sec_filings`: each row has `title`,
    `date`, `link`, `type`, plus optional `body_excerpt` populated for 8-Ks
    that carry an exhibit 99.1.
    """
    rows = fetch_recent_filings(ticker, forms=forms, limit=limit)
    out: List[Dict] = []
    for row in rows:
        body: Optional[str] = None
        if row["form"] == "8-K":
            try:
                body = fetch_exhibit_991_text(row)
            except Exception as exc:
                log.warning("exhibit fetch error %s/%s: %s", ticker, row.get("accession"), exc)
                body = None
        out.append(
            {
                "title": row["title"],
                "date": row["filing_date"],
                "link": row["link"],
                "type": row["form"],
                "accession": row.get("accession"),
                "body_excerpt": body,
            }
        )
    return out


def fetch_filing_body_by_accession(ticker: str, accession: str) -> Optional[str]:
    """Locate one filing by its accession number and return its exhibit body.

    Used by the AI-summary route, which gets `accession` from the frontend
    (taken from the listings response) and needs the cleaned body to pass
    to the LLM. Looks back up to ~50 recent filings; widen if needed.
    """
    rows = fetch_recent_filings(ticker, forms=("10-K", "10-Q", "8-K"), limit=50)
    target_clean = accession.replace("-", "")
    for row in rows:
        accn = (row.get("accession") or "").replace("-", "")
        if accn == target_clean:
            try:
                return fetch_exhibit_991_text(row)
            except Exception as exc:
                log.warning("exhibit fetch error %s/%s: %s", ticker, accession, exc)
                return None
    return None
