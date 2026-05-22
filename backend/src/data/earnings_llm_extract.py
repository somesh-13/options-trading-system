"""LLM-augmented income statement extractor for 8-K / 6-K Exhibit 99.1.

The regex extractor in ``earnings_extract`` pulls a handful of headline rows
(revenue, operating income, net income, EPS). When the 10-Q hasn't yet been
filed for the same quarter, yfinance lacks the rest of the income statement
(SG&A, R&D, depreciation, interest expense, tax provision, …) — but those
numbers are sitting right there in the press release attached to the 8-K.

This module fills that gap with one Gemini Flash call per filing. Output
matches the user-facing schema with ``available`` / ``derived`` / ``pending_10Q``
status per field. Disk-cached by accession because filings are immutable —
once we've extracted, we never need to call the model again for that filing.

The extractor is deliberately a fallback. The orchestrator only calls it when:
  1. ≥5 of the standard income-statement rows are still empty after regex.
  2. No 10-Q / 10-K has been filed yet for the same period (else yfinance
     will have the data soon and the LLM call would be wasted spend).

Gracefully degrades when GEMINI_API_KEY is absent or the API errors —
returns ``None`` and the income statement just shows fewer populated cells.
"""

from __future__ import annotations

import json
import logging
import os
import pathlib
from typing import Any, Dict, Optional

log = logging.getLogger(__name__)

# Use the lighter Flash-Lite tier for earnings extraction. The full income-
# statement table is straightforward dense data (no reasoning required), and
# Flash-Lite has a substantially higher free-tier daily quota than Flash —
# the IR classifier already shares the Flash quota and was hitting it on
# active days. Set EARNINGS_LLM_MODEL to override.
_DEFAULT_MODEL = os.getenv("EARNINGS_LLM_MODEL", "gemini-2.5-flash-lite")

# All keys here align with the row keys in fundamentals._INCOME_STMT_ROW_MAP
# so the merge step is a flat dict copy. The one renaming (operating_income →
# operating_profit) happens in fundamentals.py since that file owns the row
# schema. Keeping the LLM-facing names plain-English keeps the prompt clear.
_FIELD_KEYS = [
    "total_revenues",
    "cost_of_sales",
    "gross_profit",
    "gross_margin",
    "sga",
    "rd",
    "da",
    "other_opex",
    "operating_income",
    "operating_margin",
    "interest_expense",
    "non_operating_income",
    "total_non_operating",
    "pretax_income",
    "tax_provision",
    "consolidated_ni",
    "ni_to_common",
    "eps_basic",
    "eps_diluted",
]

_SYSTEM_PROMPT = """You extract income-statement line items from SEC 8-K / 6-K Exhibit 99.1 earnings press releases.

For each requested field:
- If the press release directly states a numeric value for the most recent reported quarter, return it as `value` and `status: "available"`.
- If you can derive it from other stated values (e.g. Gross Profit = Revenue − Cost of Sales; Gross Margin = Gross Profit / Revenue), return the calculated number with `status: "derived"`.
- If the value is genuinely not in the release (typical for fully-broken-out non-operating items, deferred-tax detail, etc. — those usually appear only in the 10-Q), return `value: null` and `status: "pending_10Q"`.

Output rules:
- Money values in MILLIONS of the issuer's reporting currency.
- Per-share / per-ADS values in raw per-share units (NOT millions).
- Margins as decimals (0.25 = 25%).
- Negative values: use a leading minus, never parentheses.

Non-standard naming: map issuer-specific labels to the closest target field and explain the substitution in `note` (e.g. PayPal "Transaction Expense" → cost_of_sales; Shopify "Merchant solutions revenue" is a sub-revenue, not the total).

Return ONLY the most recent quarter's values. If the table shows current and prior period side-by-side, take the current. If multiple currencies are shown, use the issuer's reporting currency (the one consolidated_ni is denominated in)."""


_VALUE_FIELD_SCHEMA = {
    "type": "object",
    "properties": {
        # Gemini's schema dialect uses ``nullable: true`` rather than
        # JSON-Schema's ``["number", "null"]`` array. Models surface
        # ``pending_10Q`` rows by emitting ``null`` here.
        "value": {"type": "number", "nullable": True},
        "status": {"type": "string", "enum": ["available", "derived", "pending_10Q"]},
        "note": {"type": "string"},
    },
    "required": ["value", "status", "note"],
}

_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "fields": {
            "type": "object",
            "properties": {k: _VALUE_FIELD_SCHEMA for k in _FIELD_KEYS},
            "required": _FIELD_KEYS,
        },
        "company_specific_notes": {"type": "string"},
    },
    "required": ["fields", "company_specific_notes"],
}


def _cache_dir() -> pathlib.Path:
    # backend/.cache/sec/llm_extracts/{accession}.json — sibling of the existing
    # exhibit-text cache so all SEC-derived state lives in one tree.
    base = pathlib.Path(__file__).resolve().parents[2] / ".cache" / "sec" / "llm_extracts"
    return base


def _cache_path(accession_clean: str) -> pathlib.Path:
    return _cache_dir() / f"{accession_clean}.json"


def _read_cache(accession_clean: str) -> Optional[Dict[str, Any]]:
    p = _cache_path(accession_clean)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text())
    except Exception:
        return None


def _write_cache(accession_clean: str, payload: Dict[str, Any]) -> None:
    try:
        p = _cache_path(accession_clean)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(payload))
    except Exception as exc:  # pragma: no cover — disk-write failures shouldn't crash
        log.warning("LLM-extract cache write failed for %s: %s", accession_clean, exc)


def llm_extract_income_statement(
    ticker: str,
    body: str,
    period_end: str,
    accession: str,
    filing_form: str = "8-K",
) -> Optional[Dict[str, Any]]:
    """Run a single Gemini Flash call to extract the full income statement.

    ``accession`` is required: it both identifies the filing for the cache
    and lets the orchestrator avoid duplicate calls when the same filing is
    referenced from multiple consumers.

    Returns the parsed JSON dict (with ``fields`` and ``company_specific_notes``)
    or ``None`` when the API key is missing, the SDK isn't installed, or the
    call fails for any reason. Callers fall back to the regex-only result.
    """
    if not body or not accession:
        return None

    accession_clean = accession.replace("-", "")
    cached = _read_cache(accession_clean)
    if cached is not None:
        return cached

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        log.info("earnings-llm: GEMINI_API_KEY absent; skipping for %s/%s", ticker, accession)
        return None

    try:
        from google import genai  # deferred import — keeps module loadable in tests
        from google.genai import types
    except ImportError:
        log.warning("google-genai not installed; LLM earnings extract unavailable")
        return None

    # Trim to ~35K chars. Earnings press releases are 15-50KB cleaned text;
    # the income statement and EPS tables sit inside the first 30KB for every
    # issuer we've sampled. Keeping the tail trimmed bounds token cost.
    body_for_prompt = body[:35000]
    user_text = (
        f"Ticker: {ticker}\n"
        f"Filing form: {filing_form}\n"
        f"Most-recent period ending: {period_end}\n\n"
        f"Press release (cleaned text from Exhibit 99.1):\n"
        f"---\n{body_for_prompt}\n---"
    )

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
            log.warning("earnings-llm: empty response for %s/%s", ticker, accession)
            return None
        parsed = json.loads(raw)
    except Exception:
        log.exception("earnings-llm: Gemini call failed for %s/%s", ticker, accession)
        return None

    # Annotate with the model name so downstream consumers can see what
    # produced the values.
    parsed["_model"] = _DEFAULT_MODEL
    parsed["_accession"] = accession
    parsed["_ticker"] = ticker
    parsed["_period_end"] = period_end

    _write_cache(accession_clean, parsed)
    log.info(
        "earnings-llm: extracted %s fields for %s/%s",
        sum(1 for v in (parsed.get("fields") or {}).values() if v.get("value") is not None),
        ticker,
        accession,
    )
    return parsed


def llm_field_value(parsed: Dict[str, Any], key: str) -> Optional[float]:
    """Convenience: return the numeric ``value`` for an LLM key, or None."""
    fields = (parsed or {}).get("fields") or {}
    item = fields.get(key)
    if not isinstance(item, dict):
        return None
    val = item.get("value")
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None
