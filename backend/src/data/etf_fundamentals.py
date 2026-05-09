"""
ETF metadata digest for the trading dashboard.

ETFs don't report XBRL companyfacts the way operating companies do — even when
they have a SEC CIK, the financials section is empty. So we treat ETFs as a
distinct asset class and pull yfinance's `info` + `funds_data` instead.

Returned fields are *ETF-appropriate* (AUM, NAV, expense ratio, holdings,
sector weights) rather than the DCF-oriented fields the operating-company
digest produces.

Cache pattern (10-min in-memory) mirrors `fundamentals.py` so repeat lookups
in a single dashboard render don't refetch.
"""

from __future__ import annotations

import logging
import math
import time
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd

from .market_provider import (
    get_company_info,
    get_etf_profile,
    get_history,
)

log = logging.getLogger(__name__)

_CACHE_TTL_SEC = 600
_digest_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
_isetf_cache: Dict[str, Tuple[float, bool]] = {}


def _coerce_float(d: Dict[str, Any], key: str) -> Optional[float]:
    raw = d.get(key)
    if raw is None:
        return None
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def is_etf(ticker: str) -> bool:
    """Cache-backed quoteType == 'ETF' check via the market provider."""
    key = ticker.upper().strip()
    now = time.time()
    cached = _isetf_cache.get(key)
    if cached and (now - cached[0]) < _CACHE_TTL_SEC:
        return cached[1]
    try:
        info = get_company_info(key)
        qt = (info.quote_type or "").upper()
    except Exception:
        qt = ""
    result = qt == "ETF"
    _isetf_cache[key] = (now, result)
    return result


def _top_holdings_to_list(df: Any, max_rows: int = 10) -> List[Dict[str, Any]]:
    """Convert yfinance funds_data.top_holdings DataFrame to a JSON-friendly list."""
    if df is None or not isinstance(df, pd.DataFrame) or df.empty:
        return []
    out: List[Dict[str, Any]] = []
    sliced = df.head(max_rows)
    for symbol, row in sliced.iterrows():
        try:
            weight = float(row.get("Holding Percent") or 0.0)
        except (TypeError, ValueError):
            weight = 0.0
        out.append({
            "symbol": str(symbol),
            "name": str(row.get("Name") or symbol),
            "weight": round(weight, 6),
        })
    return out


def _sector_weights_clean(d: Any) -> Dict[str, float]:
    """Coerce yfinance sector dict into clean {name: pct} with finite floats."""
    if not isinstance(d, dict):
        return {}
    out: Dict[str, float] = {}
    for k, v in d.items():
        try:
            fv = float(v)
        except (TypeError, ValueError):
            continue
        if math.isfinite(fv) and fv > 0:
            out[str(k)] = round(fv, 6)
    return out


def get_etf_fundamentals(ticker: str) -> Dict[str, Any]:
    """ETF-flavored digest. Returns a dict with `quoteType="ETF"` for callers
    that need to branch. Empty / unknown fields stay None — we don't fabricate.
    """
    key = ticker.upper().strip()
    now = time.time()
    cached = _digest_cache.get(key)
    if cached and (now - cached[0]) < _CACHE_TTL_SEC:
        return cached[1]

    try:
        profile = get_etf_profile(key)
        info: Dict[str, Any] = profile.raw_info or {}
    except Exception:
        profile = None
        info = {}

    # Holdings + sector weights (occasionally absent — provider returns empty)
    top_holdings: List[Dict[str, Any]] = []
    sector_weights: Dict[str, float] = {}
    if profile is not None:
        top_holdings = [
            {"symbol": h.symbol, "name": h.name, "weight": round(h.weight or 0.0, 6)}
            for h in profile.top_holdings
        ]
        sector_weights = _sector_weights_clean(profile.sector_weights)

    # Live price
    current_price: Optional[float] = None
    try:
        bars = get_history(key, period="1d")
        if bars:
            current_price = float(bars[-1].close)
    except Exception:
        pass
    if current_price is None and info.get("regularMarketPrice"):
        try:
            current_price = float(info["regularMarketPrice"])
        except (TypeError, ValueError):
            pass

    result: Dict[str, Any] = {
        "ticker": key,
        "name": info.get("longName") or info.get("shortName") or key,
        "quoteType": "ETF",
        "currency": info.get("currency") or "USD",
        "currentPrice": current_price,
        "fundFamily": info.get("fundFamily"),
        "category": info.get("category"),
        "totalAssets": _coerce_float(info, "totalAssets"),
        "navPrice": _coerce_float(info, "navPrice"),
        # yfinance exposes expense ratios under several keys depending on the
        # vintage of the data. Take the first finite hit.
        "expenseRatio": (
            _coerce_float(info, "annualReportExpenseRatio")
            or _coerce_float(info, "netExpenseRatio")
            or _coerce_float(info, "expenseRatio")
        ),
        "yield": _coerce_float(info, "yield"),
        "beta3Year": _coerce_float(info, "beta3Year"),
        "ytdReturn": _coerce_float(info, "ytdReturn"),
        "threeYearAverageReturn": _coerce_float(info, "threeYearAverageReturn"),
        "fiveYearAverageReturn": _coerce_float(info, "fiveYearAverageReturn"),
        "topHoldings": top_holdings,
        "sectorWeights": sector_weights,
        "asOf": pd.Timestamp.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    _digest_cache[key] = (now, result)
    return result
