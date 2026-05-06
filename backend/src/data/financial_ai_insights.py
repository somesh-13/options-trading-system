"""Gemini-backed insights for an already-extracted financial statement.

Different role from ``filing_ai_summary``:

  - ``filing_ai_summary`` summarises the narrative text of ONE filing (8-K / 10-K
    Exhibit 99.1). Source is unstructured prose; output is evidence-grounded
    bullets with verbatim quotes.
  - ``financial_ai_insights`` (this module) summarises the STRUCTURED income
    statement (or any rows-by-period grid). Source is JSON values from
    ``sec_statements``; output is trend-aware commentary keyed strictly to
    the numbers — no speculation about causes, no quotes from filings.

Cache: keyed by SHA-256 of the canonical JSON (`years` + `rows[].key|values`).
A 10-K/A restatement changes the values → hash changes → regeneration on next
request. Frequency restate is rare so the cache is effectively permanent for
99% of tickers.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import pathlib
import time
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)

# Each Gemini model has its own per-project free-tier daily quota, so
# different features target different models to avoid stomping each other:
#   earnings_llm_extract → 2.5-flash-lite (pinned; legacy)
#   filing_ai_summary    → 2.5-flash-lite (pinned; legacy)
#   financial_insights   → flash-latest   (new; separate quota bucket)
# `gemini-flash-latest` is the canonical "current Flash" alias and was
# verified to have an independent free-tier bucket from the pinned 2.5
# variants. Override with FINANCIAL_INSIGHTS_MODEL env var on paid plans.
_DEFAULT_MODEL = os.getenv("FINANCIAL_INSIGHTS_MODEL", "gemini-flash-latest")

_CACHE_DIR = pathlib.Path(__file__).resolve().parents[2] / ".cache" / "sec" / "insights"


_SYSTEM_PROMPT = """You are a financial-data analyst. You are given the STRUCTURED rows of a single financial statement (income statement, balance sheet, cash flow, or ratios) over multiple historical periods, and your job is to produce concise commentary GROUNDED STRICTLY IN THE NUMBERS PROVIDED.

Hard rules:
- Do not invent reasons or causes. The narrative text of the underlying filings is NOT in your input — only the numbers. If a metric moves, describe the move; do not speculate on why.
- Every claim must be verifiable from the provided data. If a metric is null in a period, do not infer its value.
- Use the issuer's reported numbers as-is — do not convert units. Money values are in MILLIONS USD unless otherwise noted in the input. EPS values are per-share USD (raw, not millions). Margins/ratios are decimals (0.32 = 32%).
- Periods are listed MOST-RECENT FIRST. The first column is the latest period.
- When stating year-over-year changes, prefer absolute % moves (e.g. "+19% YoY"). For multi-year compound growth, use CAGR with explicit period count.
- Mark unusual gaps in the period sequence under `data_quality_notes` (e.g. "Dec '21 missing — issuer's first 10-K was Dec '22").
- A negative metric stays described as negative (do not say "loss" if the field is plain numerical; just describe the sign).

Length:
- 4–6 summary_bullets — top-line trends an executive should know
- ≤4 data_quality_notes (gaps, sign-flips, suspicious zeros, restated-looking values)

Per-metric trends: provide a one-line trend description for revenue, gross_profit, operating_income (or operating_profit), and ebitda when the corresponding row is present. If a row is absent, omit that trend object entirely (don't fabricate).

If the data is too sparse to draw conclusions (≤2 non-null periods for revenue), set summary_bullets to a single bullet noting that and leave per-metric trends empty."""


_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "summary_bullets": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 1,
            "maxItems": 6,
        },
        "trends": {
            "type": "object",
            "properties": {
                "revenue": {"type": "string", "nullable": True},
                "gross_profit": {"type": "string", "nullable": True},
                "operating": {"type": "string", "nullable": True},
                "ebitda": {"type": "string", "nullable": True},
                "net_income": {"type": "string", "nullable": True},
            },
            "required": ["revenue", "gross_profit", "operating", "ebitda", "net_income"],
        },
        "data_quality_notes": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 4,
        },
        "missing_periods": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
    "required": ["summary_bullets", "trends", "data_quality_notes", "missing_periods"],
}


def _canonical_payload(statement_data: Dict[str, Any]) -> Dict[str, Any]:
    """Reduce a statement response to the value-bearing fields we hash on.

    Frontend-only metadata (asOf, source label, generated_at) is excluded so
    a re-extract that doesn't change values doesn't bust the cache.
    """
    return {
        "years": statement_data.get("years", []),
        "rows": [
            {"key": r.get("key"), "values": r.get("values", [])}
            for r in statement_data.get("rows", [])
        ],
    }


def _hash_for(payload: Dict[str, Any]) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:16]


def _cache_path(cache_key: str) -> pathlib.Path:
    return _CACHE_DIR / f"{cache_key}.json"


def _read_cache(cache_key: str) -> Optional[Dict[str, Any]]:
    p = _cache_path(cache_key)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except Exception:
        return None


def _write_cache(cache_key: str, payload: Dict[str, Any]) -> None:
    try:
        _CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _cache_path(cache_key).write_text(json.dumps(payload))
    except Exception as exc:
        log.warning("insights cache write failed for %s: %s", cache_key, exc)


def _format_table_for_prompt(statement_data: Dict[str, Any]) -> str:
    """Render the statement as a compact text table — easier for the model to
    reason over than a JSON dump, and uses far fewer tokens."""
    years: List[str] = statement_data.get("years", [])
    rows: List[Dict[str, Any]] = statement_data.get("rows", [])
    if not years or not rows:
        return "(empty)"

    label_w = max(len(r.get("label", r.get("key", ""))) for r in rows)
    label_w = min(label_w, 38)

    def fmt_v(v: Any, fmt: Optional[str]) -> str:
        if v is None:
            return "—"
        try:
            n = float(v)
        except (TypeError, ValueError):
            return str(v)
        if fmt == "pct":
            return f"{n*100:.1f}%"
        if fmt == "per_share":
            return f"{n:.2f}"
        if fmt == "x":
            return f"{n:.2f}x"
        if fmt == "days":
            return f"{n:.0f}d"
        # money in millions (backend convention)
        if abs(n) >= 1000:
            return f"{n:,.0f}"
        return f"{n:.1f}"

    header = f"{'Metric':<{label_w}}  " + "  ".join(f"{y:>10}" for y in years)
    lines = [header, "-" * len(header)]
    for r in rows:
        label = (r.get("label") or r.get("key") or "?")[:label_w]
        cells = "  ".join(f"{fmt_v(v, r.get('format')):>10}" for v in r.get("values", []))
        lines.append(f"{label:<{label_w}}  {cells}")
    return "\n".join(lines)


def generate_financial_insights(
    ticker: str,
    statement: str,
    period: str,
    statement_data: Dict[str, Any],
    *,
    force: bool = False,
) -> Optional[Dict[str, Any]]:
    """Produce trend-aware AI commentary for a structured statement.

    Returns the parsed response dict, or None when the API key is missing /
    SDK isn't installed / call fails. Callers should treat None as a soft
    failure and surface "AI insights unavailable" in the UI.
    """
    rows = statement_data.get("rows") or []
    years = statement_data.get("years") or []
    if not rows or not years:
        return None

    canonical = _canonical_payload(statement_data)
    h = _hash_for(canonical)
    cache_key = f"{ticker.upper()}-{statement}-{period}-{h}"

    if not force:
        cached = _read_cache(cache_key)
        if cached is not None:
            return cached

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        log.info("financial-insights: GEMINI_API_KEY absent; skipping for %s", cache_key)
        return None

    try:
        from google import genai
        from google.genai import types
    except ImportError:
        log.warning("google-genai not installed; financial insights unavailable")
        return None

    table_text = _format_table_for_prompt(statement_data)
    user_text = (
        f"Ticker: {ticker.upper()}\n"
        f"Statement: {statement}\n"
        f"Frequency: {period}\n"
        f"Currency: {statement_data.get('currency', 'USD')}\n"
        f"Money unit: {statement_data.get('unit', 'M')} (millions)\n\n"
        f"Periods (most-recent first): {', '.join(years)}\n\n"
        f"Data:\n{table_text}\n"
    )

    started = time.time()
    try:
        client = genai.Client(api_key=api_key)
        resp = client.models.generate_content(
            model=_DEFAULT_MODEL,
            contents=user_text,
            config=types.GenerateContentConfig(
                system_instruction=_SYSTEM_PROMPT,
                response_mime_type="application/json",
                response_schema=_RESPONSE_SCHEMA,
                temperature=0.0,
            ),
        )
        raw = (getattr(resp, "text", "") or "").strip()
        if not raw:
            log.warning("financial-insights: empty response for %s", cache_key)
            return None
        parsed = json.loads(raw)
    except Exception:
        log.exception("financial-insights: Gemini call failed for %s", cache_key)
        return None

    parsed["_model"] = _DEFAULT_MODEL
    parsed["_ticker"] = ticker.upper()
    parsed["_statement"] = statement
    parsed["_period"] = period
    parsed["_data_hash"] = h
    parsed["_periods_covered"] = years
    parsed["_generated_at"] = int(time.time())
    parsed["_elapsed_sec"] = round(time.time() - started, 2)

    _write_cache(cache_key, parsed)
    log.info(
        "financial-insights: generated %s in %.1fs (%d bullets)",
        cache_key,
        parsed["_elapsed_sec"],
        len(parsed.get("summary_bullets") or []),
    )
    return parsed
