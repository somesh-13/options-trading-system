"""
SEC EDGAR XBRL companyfacts loader for DCF fundamentals.

Pulls authoritative balance-sheet, income-statement, and cash-flow numbers
straight from the filer's own 10-K / 10-Q XBRL data via data.sec.gov. Free,
no auth, fair-use rate limit (~10 req/s with a User-Agent header).

Used as the *primary* source by `get_ticker_fundamentals()` for the load-bearing
DCF inputs (revenue, op margin, tax rate, capex, debt, cash, shares). yfinance
remains the fallback and the source for everything SEC doesn't expose
(analyst targets, P/E, beta, recommendation, etc.).
"""

from __future__ import annotations

import json
import logging
import math
import os
import pathlib
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

import requests

log = logging.getLogger(__name__)

# Cache directory under backend/.cache/sec/. Resolves relative to this file so
# it works regardless of the working dir uvicorn was launched from.
CACHE_DIR = pathlib.Path(__file__).resolve().parents[2] / ".cache" / "sec"
FACTS_DIR = CACHE_DIR / "facts"
TICKER_MAP_PATH = CACHE_DIR / "company_tickers.json"

TICKER_MAP_TTL_SEC = 7 * 86400         # weekly refresh
FACTS_TTL_SEC = 24 * 3600              # daily refresh
RATE_LIMIT_SLEEP_SEC = 0.11            # SEC fair-use cap is 10 req/s
HTTP_TIMEOUT_SEC = 15

# SEC requires identifying the caller in the User-Agent header.
USER_AGENT = "TradingDashboard/1.0 someshdubey13@gmail.com"

# us-gaap concept-tag candidates. First tag with usable USD entries wins. The
# multi-tag approach handles ASC 606 renames (e.g. Revenues -> RFC*) and minor
# filer-specific variations.
REVENUE_TAGS = [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
]
OP_INCOME_TAGS = ["OperatingIncomeLoss"]
TAX_TAGS = ["IncomeTaxExpenseBenefit"]
PRETAX_TAGS = [
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
    "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
    "IncomeLossBeforeIncomeTaxes",
]
CAPEX_TAGS = [
    "PaymentsToAcquirePropertyPlantAndEquipment",
    "PaymentsToAcquireProductiveAssets",
]
LT_DEBT_TAGS = ["LongTermDebtNoncurrent", "LongTermDebt"]
LT_DEBT_CURRENT_TAGS = ["LongTermDebtCurrent"]
ST_BORROW_TAGS = ["ShortTermBorrowings", "CommercialPaper"]
CASH_TAGS = ["CashAndCashEquivalentsAtCarryingValue"]
RESTRICTED_CASH_TAGS = ["RestrictedCash", "RestrictedCashCurrent"]
# Shares: dei namespace first (most reliable), then us-gaap fallback.
SHARES_TAGS_DEI = ["EntityCommonStockSharesOutstanding"]
SHARES_TAGS_GAAP = ["CommonStockSharesOutstanding"]

# Module state.
_TICKER_CIK_MAP: Optional[Dict[str, str]] = None
_HTTP_LOCK = threading.Lock()
_SESSION: Optional[requests.Session] = None


def _ensure_dirs() -> None:
    FACTS_DIR.mkdir(parents=True, exist_ok=True)


def _session() -> requests.Session:
    global _SESSION
    if _SESSION is None:
        s = requests.Session()
        s.headers.update({
            "User-Agent": USER_AGENT,
            "Accept-Encoding": "gzip, deflate",
            "Host": "data.sec.gov",
        })
        _SESSION = s
    return _SESSION


def _http_get(url: str) -> requests.Response:
    """Rate-limited GET. SEC asks for ≤10 req/s; we sleep 0.11s under the lock."""
    _ensure_dirs()
    with _HTTP_LOCK:
        time.sleep(RATE_LIMIT_SLEEP_SEC)
        # company_tickers.json lives on www.sec.gov, not data.sec.gov, so we
        # override the Host header for that endpoint specifically.
        host = "www.sec.gov" if "://www.sec.gov" in url else "data.sec.gov"
        return _session().get(url, headers={"Host": host}, timeout=HTTP_TIMEOUT_SEC)


def _atomic_write_json(path: pathlib.Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload))
    os.replace(tmp, path)


def _load_ticker_cik_map() -> Dict[str, str]:
    """ticker (uppercase) -> 10-digit zero-padded CIK string."""
    global _TICKER_CIK_MAP
    if _TICKER_CIK_MAP is not None:
        return _TICKER_CIK_MAP

    _ensure_dirs()
    age = (time.time() - TICKER_MAP_PATH.stat().st_mtime) if TICKER_MAP_PATH.exists() else 1e12
    if not TICKER_MAP_PATH.exists() or age > TICKER_MAP_TTL_SEC:
        try:
            r = _http_get("https://www.sec.gov/files/company_tickers.json")
            r.raise_for_status()
            _atomic_write_json(TICKER_MAP_PATH, r.json())
        except Exception as exc:
            log.warning("SEC ticker map refresh failed: %s", exc)
            if not TICKER_MAP_PATH.exists():
                _TICKER_CIK_MAP = {}
                return _TICKER_CIK_MAP

    try:
        raw = json.loads(TICKER_MAP_PATH.read_text())
    except Exception as exc:
        log.warning("SEC ticker map parse failed: %s", exc)
        _TICKER_CIK_MAP = {}
        return _TICKER_CIK_MAP

    out: Dict[str, str] = {}
    for row in raw.values():
        try:
            ticker = str(row["ticker"]).upper()
            cik = str(row["cik_str"]).zfill(10)
            out[ticker] = cik
        except (KeyError, TypeError):
            continue
    _TICKER_CIK_MAP = out
    return out


def get_cik_for_ticker(ticker: str) -> Optional[str]:
    return _load_ticker_cik_map().get(ticker.upper())


def fetch_company_facts(cik: str) -> Optional[dict]:
    """Disk-cached (24h) companyfacts JSON for a CIK. None on 404 / network error."""
    _ensure_dirs()
    cache_path = FACTS_DIR / f"CIK{cik}.json"

    if cache_path.exists():
        age = time.time() - cache_path.stat().st_mtime
        if age < FACTS_TTL_SEC:
            try:
                payload = json.loads(cache_path.read_text())
                if isinstance(payload, dict) and payload.get("_no_filer"):
                    return None
                return payload
            except Exception:
                pass  # fall through to refresh

    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
    try:
        r = _http_get(url)
    except Exception as exc:
        log.warning("SEC companyfacts request failed for CIK %s: %s", cik, exc)
        # Stale-while-error: serve last cached copy if present.
        if cache_path.exists():
            try:
                return json.loads(cache_path.read_text())
            except Exception:
                return None
        return None

    if r.status_code == 404:
        _atomic_write_json(cache_path, {"_no_filer": True, "_ts": time.time()})
        return None
    if r.status_code != 200:
        log.warning("SEC companyfacts %s for CIK %s", r.status_code, cik)
        if cache_path.exists():
            try:
                return json.loads(cache_path.read_text())
            except Exception:
                return None
        return None

    try:
        payload = r.json()
    except Exception as exc:
        log.warning("SEC companyfacts JSON decode failed for CIK %s: %s", cik, exc)
        return None
    _atomic_write_json(cache_path, payload)
    return payload


# ---------------------------------------------------------------------------
# Concept extraction helpers
# ---------------------------------------------------------------------------

def _facts_section(facts: dict, namespace: str) -> Dict[str, Any]:
    return (facts.get("facts") or {}).get(namespace) or {}


def _units_for(facts: dict, namespace: str, candidates: List[str]) -> Optional[Tuple[str, List[dict]]]:
    """First (concept_name, entries-array) where entries-array is non-empty USD/shares units."""
    section = _facts_section(facts, namespace)
    for tag in candidates:
        node = section.get(tag)
        if not node:
            continue
        units = node.get("units") or {}
        # Prefer USD; for share counts the unit key is 'shares'.
        for unit_key in ("USD", "USD/shares", "shares"):
            arr = units.get(unit_key)
            if arr:
                return tag, arr
    return None


def _normalize_filing_entries(entries: List[dict]) -> List[dict]:
    """Keep 10-K and 10-Q only; on duplicate (end, form, fp), keep latest filed."""
    keep: Dict[Tuple[str, str, str], dict] = {}
    for e in entries:
        form = e.get("form")
        if form not in ("10-K", "10-Q", "10-K/A", "10-Q/A"):
            continue
        end = e.get("end")
        fp = e.get("fp")
        if not end:
            continue
        key = (end, form, fp or "")
        existing = keep.get(key)
        if existing is None or (e.get("filed", "") > existing.get("filed", "")):
            keep[key] = e
    return sorted(keep.values(), key=lambda x: (x.get("end", ""), x.get("filed", "")))


def _ttm_flow(entries: List[dict]) -> Optional[Tuple[float, str]]:
    """
    Sum a flow metric (revenue, capex, etc.) over the trailing twelve months.

    Strategy (in order of preference):
      1. Latest 10-K (annual, fp=FY) covering the most recent FY end -> use as TTM.
      2. Most recent 10-K + (current-year 10-Qs) - (same-quarter prior-year 10-Qs).
      3. Sum of last 4 quarterly Q1+Q2+Q3+Q4 (last is implied by FY-9M=Q4).

    Returns (value, source_label) or None.
    """
    cleaned = _normalize_filing_entries(entries)
    if not cleaned:
        return None

    # Sort newest-first.
    cleaned_desc = sorted(cleaned, key=lambda x: x.get("end", ""), reverse=True)

    # Path 1: latest 10-K.
    latest_10k = next((e for e in cleaned_desc if e.get("form", "").startswith("10-K") and e.get("fp") == "FY"), None)
    latest_10q = next((e for e in cleaned_desc if e.get("form", "").startswith("10-Q")), None)

    if latest_10k and (latest_10q is None or latest_10q.get("end", "") <= latest_10k.get("end", "")):
        return float(latest_10k["val"]), "sec_edgar:10-K"

    # Path 2: 10-K + YTD-current - YTD-prior.
    if latest_10k and latest_10q:
        end_q = latest_10q.get("end", "")
        # Find prior-year same-quarter (fp matches; year is one less).
        prior_q = next(
            (e for e in cleaned_desc
             if e.get("form", "").startswith("10-Q")
             and e.get("fp") == latest_10q.get("fp")
             and (e.get("end") or "")[:4] == str(int(end_q[:4]) - 1)),
            None,
        )
        if prior_q is not None:
            try:
                ttm = float(latest_10k["val"]) + float(latest_10q["val"]) - float(prior_q["val"])
                return ttm, "sec_edgar:10-K+YTD"
            except (KeyError, TypeError, ValueError):
                pass

    # Path 3: sum the last 4 quarterly entries that are *quarterly* (not YTD).
    # The XBRL fp field is "Q1"/"Q2"/"Q3"/"FY"; YTD spans appear with longer
    # start-end gaps, so we filter to entries whose start..end is roughly 1 quarter.
    def _is_qtr(e: dict) -> bool:
        s, en = e.get("start"), e.get("end")
        if not s or not en:
            return False
        try:
            from datetime import date
            ds = date.fromisoformat(s)
            de = date.fromisoformat(en)
            days = (de - ds).days
            return 80 <= days <= 100
        except Exception:
            return False

    quarterly = [e for e in cleaned_desc if _is_qtr(e)]
    if len(quarterly) >= 4:
        total = sum(float(e["val"]) for e in quarterly[:4])
        return total, "sec_edgar:4Q"

    # Last resort: latest single 10-Q (likely a quarterly value, not TTM).
    if latest_10q is not None:
        try:
            return float(latest_10q["val"]) * 4.0, "sec_edgar:annualized"
        except (KeyError, TypeError, ValueError):
            return None

    return None


def _latest_stock(entries: List[dict]) -> Optional[Tuple[float, str]]:
    """Latest reported value for a stock-style metric (debt, cash, shares)."""
    cleaned = _normalize_filing_entries(entries)
    if not cleaned:
        return None
    cleaned_desc = sorted(cleaned, key=lambda x: (x.get("end", ""), x.get("filed", "")), reverse=True)
    e = cleaned_desc[0]
    try:
        return float(e["val"]), f"sec_edgar:{e.get('form', '?')}@{e.get('end', '')}"
    except (KeyError, TypeError, ValueError):
        return None


def _annual_history(entries: List[dict]) -> List[Tuple[str, float]]:
    """Year, FY-revenue pairs (oldest first), for revenue CAGR display."""
    cleaned = _normalize_filing_entries(entries)
    out: List[Tuple[str, float]] = []
    for e in cleaned:
        if e.get("form", "").startswith("10-K") and e.get("fp") == "FY":
            try:
                year = (e.get("end") or "")[:4]
                if year:
                    out.append((year, float(e["val"])))
            except (KeyError, TypeError, ValueError):
                continue
    # Dedup on year; keep latest filed.
    by_year: Dict[str, float] = {}
    for y, v in out:
        by_year[y] = v
    return sorted(by_year.items())


def _sum_flows(values: List[Optional[Tuple[float, str]]]) -> Optional[float]:
    finite = [v for v, _ in (x for x in values if x is not None) if v is not None and math.isfinite(v)]
    return sum(finite) if finite else None


def _sum_optional(*vals: Optional[float]) -> Optional[float]:
    finite = [v for v in vals if v is not None and math.isfinite(v)]
    return sum(finite) if finite else None


def extract_sec_fundamentals(ticker: str) -> Optional[Dict[str, Any]]:
    """
    Pull SEC-derived fundamentals for `ticker`. Returns None for foreign filers
    (no CIK in company_tickers.json) or when SEC is unreachable on first run.
    """
    cik = get_cik_for_ticker(ticker)
    if cik is None:
        return None
    facts = fetch_company_facts(cik)
    if not facts:
        return None

    # Revenue (TTM)
    revenue: Optional[float] = None
    revenue_source: Optional[str] = None
    rev_node = _units_for(facts, "us-gaap", REVENUE_TAGS)
    if rev_node:
        ttm = _ttm_flow(rev_node[1])
        if ttm:
            revenue, revenue_source = ttm

    # Revenue history (annual)
    revenue_history: List[Dict[str, Any]] = []
    if rev_node:
        revenue_history = [{"year": y, "revenue": v} for y, v in _annual_history(rev_node[1])]

    # Operating income (TTM) -> operating margin
    op_income: Optional[float] = None
    op_node = _units_for(facts, "us-gaap", OP_INCOME_TAGS)
    if op_node:
        opi = _ttm_flow(op_node[1])
        if opi:
            op_income = opi[0]
    operating_margin: Optional[float] = None
    if op_income is not None and revenue and revenue > 0:
        operating_margin = op_income / revenue

    # Tax rate = tax expense (TTM) / pretax income (TTM). Skip if pretax <= 0.
    tax_rate: Optional[float] = None
    tax_node = _units_for(facts, "us-gaap", TAX_TAGS)
    pretax_node = _units_for(facts, "us-gaap", PRETAX_TAGS)
    if tax_node and pretax_node:
        t_ttm = _ttm_flow(tax_node[1])
        p_ttm = _ttm_flow(pretax_node[1])
        if t_ttm and p_ttm and p_ttm[0] > 0:
            try:
                tax_rate = max(0.0, min(0.40, t_ttm[0] / p_ttm[0]))
            except ZeroDivisionError:
                tax_rate = None

    # Capex (TTM, absolute value)
    capex: Optional[float] = None
    capex_node = _units_for(facts, "us-gaap", CAPEX_TAGS)
    if capex_node:
        cap = _ttm_flow(capex_node[1])
        if cap:
            capex = abs(cap[0])

    # Debt (latest reported; sum LT noncurrent + LT current + short-term borrowings)
    lt_node = _units_for(facts, "us-gaap", LT_DEBT_TAGS)
    ltc_node = _units_for(facts, "us-gaap", LT_DEBT_CURRENT_TAGS)
    st_node = _units_for(facts, "us-gaap", ST_BORROW_TAGS)
    lt_val = _latest_stock(lt_node[1])[0] if lt_node and _latest_stock(lt_node[1]) else None
    ltc_val = _latest_stock(ltc_node[1])[0] if ltc_node and _latest_stock(ltc_node[1]) else None
    st_val = _latest_stock(st_node[1])[0] if st_node and _latest_stock(st_node[1]) else None
    total_debt = _sum_optional(lt_val, ltc_val, st_val)

    # Cash (latest; cash + restricted cash if reported)
    cash_node = _units_for(facts, "us-gaap", CASH_TAGS)
    rc_node = _units_for(facts, "us-gaap", RESTRICTED_CASH_TAGS)
    cash_val = _latest_stock(cash_node[1])[0] if cash_node and _latest_stock(cash_node[1]) else None
    rc_val = _latest_stock(rc_node[1])[0] if rc_node and _latest_stock(rc_node[1]) else None
    total_cash = _sum_optional(cash_val, rc_val)

    net_debt: Optional[float] = None
    if total_debt is not None:
        net_debt = total_debt - (total_cash or 0.0)

    # Shares outstanding — dei first, us-gaap fallback.
    shares: Optional[float] = None
    shares_source: Optional[str] = None
    dei_shares = _units_for(facts, "dei", SHARES_TAGS_DEI)
    if dei_shares:
        latest = _latest_stock(dei_shares[1])
        if latest:
            shares = latest[0]
            shares_source = latest[1]
    if shares is None:
        gaap_shares = _units_for(facts, "us-gaap", SHARES_TAGS_GAAP)
        if gaap_shares:
            latest = _latest_stock(gaap_shares[1])
            if latest:
                shares = latest[0]
                shares_source = latest[1]

    # As-of filing date — pick the freshest end across the load-bearing nodes.
    as_of_filing: Optional[str] = None
    for node in (rev_node, lt_node, dei_shares):
        if not node:
            continue
        cleaned = _normalize_filing_entries(node[1])
        if not cleaned:
            continue
        end = max((e.get("end", "") for e in cleaned), default="")
        if end and end > (as_of_filing or ""):
            as_of_filing = end

    # Only return a result if at least one load-bearing field came through;
    # an all-empty payload is no better than a None and confuses the fallback.
    has_any = any(v is not None for v in (revenue, total_debt, total_cash, shares, capex, op_income))
    if not has_any:
        return None

    out: Dict[str, Any] = {
        "revenue": revenue,
        "revenueSource": revenue_source,
        "revenueHistory": revenue_history,
        "operatingIncome": op_income,
        "operatingMargin": operating_margin,
        "taxRate": tax_rate,
        "capex": capex,
        "totalDebt": total_debt,
        "totalCash": total_cash,
        "netDebt": net_debt,
        "sharesOutstanding": shares,
        "sharesSource": shares_source,
        "asOfFiling": as_of_filing,
    }
    return out
