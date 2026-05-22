"""Macro news aggregator.

Pulls global headlines from GDELT 2.0 + curated RSS feeds, deduplicates by
URL, sorts by recency, and serves the home dashboard's world-affairs panel.

Categories: conflict, health, economy, politics.

Sources are fetched in parallel (ThreadPoolExecutor) and the merged result is
cached in-process for 5 min so repeated page loads don't hammer upstream.
"""
from __future__ import annotations

import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Iterable, Optional, Tuple
from urllib.parse import urlencode
from xml.etree import ElementTree as ET

import requests

log = logging.getLogger(__name__)

USER_AGENT = "VegaEdge/1.0 (+macro-news)"
HTTP_TIMEOUT = 8

CATEGORIES: tuple[str, ...] = ("conflict", "health", "economy", "politics")

# GDELT 2.0 doc API.
# Theme codes: https://blog.gdeltproject.org/gdelt-2-0-our-global-world-in-realtime/
GDELT_QUERIES: dict[str, str] = {
    "conflict": "(theme:KILL OR theme:ARMEDCONFLICT OR theme:MIL_WEAPONS_NUCLEAR_BOMB OR theme:CONFLICT) sourcelang:eng",
    "health": "(theme:HEALTH_PANDEMIC OR theme:INFECT OR theme:MEDICAL_DISEASE) sourcelang:eng",
    "economy": "(theme:ECON_INFLATION OR theme:ECON_INTEREST_RATES OR theme:ECON_RECESSION OR theme:ECON_CENTRALBANKS) sourcelang:eng",
    "politics": "(theme:GOV_ELECTIONS OR theme:LEADER OR theme:LEGISLATION OR theme:DIPLOMACY) sourcelang:eng",
}
GDELT_API = "https://api.gdeltproject.org/api/v2/doc/doc"

# (category, source label, url)
RSS_SOURCES: list[Tuple[str, str, str]] = [
    ("conflict", "BBC World", "https://feeds.bbci.co.uk/news/world/rss.xml"),
    ("politics", "AP Top News", "https://feeds.apnews.com/apnews/topnews"),
    ("health", "WHO Outbreaks", "https://www.who.int/feeds/entity/csr/don/en/rss.xml"),
    ("economy", "BBC Business", "https://feeds.bbci.co.uk/news/business/rss.xml"),
]

_RSS_NS = {
    "atom": "http://www.w3.org/2005/Atom",
    "dc": "http://purl.org/dc/elements/1.1/",
}

CACHE_TTL = 300


@dataclass(frozen=True)
class Article:
    title: str
    url: str
    source: str
    published_at: Optional[str]
    category: str
    image_url: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


def _parse_gdelt_date(ts: str) -> Optional[str]:
    if not ts:
        return None
    try:
        return datetime.strptime(ts, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc).isoformat()
    except ValueError:
        return None


def _parse_rfc822(s: str) -> Optional[str]:
    if not s:
        return None
    try:
        dt = parsedate_to_datetime(s)
    except (TypeError, ValueError):
        return None
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _parse_iso(s: str) -> Optional[str]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).isoformat()
    except ValueError:
        return None


def _gdelt_fetch(category: str, limit: int = 15) -> list[Article]:
    q = GDELT_QUERIES.get(category)
    if not q:
        return []
    params = {
        "query": q,
        "mode": "ArtList",
        "format": "json",
        "maxrecords": limit,
        "sort": "DateDesc",
        "timespan": "1d",
    }
    url = f"{GDELT_API}?{urlencode(params)}"
    try:
        r = requests.get(url, timeout=HTTP_TIMEOUT, headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
        body = r.json()
    except (requests.RequestException, ValueError) as e:
        log.warning("gdelt fetch failed [%s]: %s", category, e)
        return []
    out: list[Article] = []
    for art in body.get("articles", []) or []:
        title = (art.get("title") or "").strip()
        link = (art.get("url") or "").strip()
        if not title or not link:
            continue
        out.append(
            Article(
                title=title,
                url=link,
                source=art.get("domain") or "GDELT",
                published_at=_parse_gdelt_date(art.get("seendate") or ""),
                category=category,
                image_url=art.get("socialimage") or None,
            )
        )
    return out


def _rss_fetch(category: str, source: str, url: str, limit: int = 10) -> list[Article]:
    try:
        r = requests.get(url, timeout=HTTP_TIMEOUT, headers={"User-Agent": USER_AGENT})
        r.raise_for_status()
        root = ET.fromstring(r.content)
    except (requests.RequestException, ET.ParseError) as e:
        log.warning("rss fetch failed [%s]: %s", url, e)
        return []
    out: list[Article] = []
    # RSS 2.0
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        if not title or not link:
            continue
        pub = (
            item.findtext("pubDate")
            or item.findtext("dc:date", namespaces=_RSS_NS)
            or ""
        )
        out.append(
            Article(
                title=title,
                url=link,
                source=source,
                published_at=_parse_rfc822(pub),
                category=category,
            )
        )
        if len(out) >= limit:
            break
    if out:
        return out
    # Atom fallback
    for entry in root.iter("{http://www.w3.org/2005/Atom}entry"):
        title_el = entry.find("atom:title", namespaces=_RSS_NS)
        link_el = entry.find("atom:link", namespaces=_RSS_NS)
        href = link_el.get("href") if link_el is not None else None
        title = (title_el.text or "").strip() if title_el is not None and title_el.text else ""
        if not title or not href:
            continue
        out.append(
            Article(
                title=title,
                url=href,
                source=source,
                published_at=_parse_iso(entry.findtext("atom:updated", namespaces=_RSS_NS) or ""),
                category=category,
            )
        )
        if len(out) >= limit:
            break
    return out


_CACHE_LOCK = threading.Lock()
_CACHE: dict[tuple, tuple[float, list[Article]]] = {}


def _fetch_all(cats: tuple[str, ...]) -> list[Article]:
    merged: list[Article] = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        futures = []
        for c in cats:
            futures.append(ex.submit(_gdelt_fetch, c, 15))
        for c, src, url in RSS_SOURCES:
            if c in cats:
                futures.append(ex.submit(_rss_fetch, c, src, url, 10))
        for fut in as_completed(futures):
            try:
                merged.extend(fut.result(timeout=HTTP_TIMEOUT + 2))
            except Exception as e:
                log.warning("macro-news task error: %s", e)
    return merged


def aggregate(categories: Iterable[str], limit: int = 30) -> dict:
    cats = tuple(c for c in categories if c in CATEGORIES) or CATEGORIES
    cache_key = (cats, limit)
    now = time.time()
    with _CACHE_LOCK:
        hit = _CACHE.get(cache_key)
        if hit and now - hit[0] < CACHE_TTL:
            return _serialize(hit[1], cached=True)

    raw = _fetch_all(cats)

    seen: set[str] = set()
    deduped: list[Article] = []
    for a in raw:
        if a.url in seen:
            continue
        seen.add(a.url)
        deduped.append(a)

    # Dated first (desc by timestamp), undated trailing.
    deduped.sort(key=lambda a: (1 if a.published_at else 0, a.published_at or ""), reverse=True)
    deduped = deduped[:limit]

    with _CACHE_LOCK:
        _CACHE[cache_key] = (now, deduped)
    return _serialize(deduped, cached=False)


def _serialize(articles: list[Article], cached: bool) -> dict:
    by_cat: dict[str, int] = {}
    for a in articles:
        by_cat[a.category] = by_cat.get(a.category, 0) + 1
    return {
        "articles": [a.to_dict() for a in articles],
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "by_category": by_cat,
        "cached": cached,
    }
