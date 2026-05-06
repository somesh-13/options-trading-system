"""Gemini-backed AI summary for SEC 8-K / 10-K / 10-Q filings.

Pipeline (one Gemini Flash-Lite call per filing, then cached forever):
  1. Read the cached Exhibit 99.1 / filing body via sec_exhibits.
  2. Send to Gemini with a structured response_schema covering:
     - summary bullets (5–8 executive-friendly statements)
     - financial highlights (revenue / EBITDA / cash / capex / guidance — as
       formatted strings to allow ranges like "$30–35M")
     - operational highlights (free-form bullets)
     - physical-AI entities (sites, capacity_mw, partners, build phases) —
       first-class because the dashboard's primary use case is power-backed
       infrastructure issuers (TeraWulf, IREN, CIFR, BTBT, Riot, etc.)
     - risks
     - evidence (bullet_index → verbatim quote from source)
     - missing_fields (model self-reports what it couldn't find)
  3. Cache result to backend/.cache/sec/llm_extracts/{accession}-summary.json.
     Filings are immutable so cache is permanent — same key as the existing
     income-statement extractor's cache, with a "-summary" suffix to keep the
     two payloads separate.

Gracefully degrades when GEMINI_API_KEY is absent or the API errors —
returns ``None`` so the route can return a 503 with a useful message.
"""

from __future__ import annotations

import json
import logging
import os
import pathlib
import time
from typing import Any, Dict, Optional

log = logging.getLogger(__name__)

# Flash-Lite has a much higher free-tier daily quota than full Flash (20/day
# on Flash hits us during active sessions). The summary task is dense text
# comprehension at temp=0 — Flash-Lite handles it well.
_DEFAULT_MODEL = os.getenv("FILING_SUMMARY_MODEL", "gemini-2.5-flash-lite")

_CACHE_DIR = pathlib.Path(__file__).resolve().parents[2] / ".cache" / "sec" / "llm_extracts"

_SYSTEM_PROMPT = """You are an investor-relations document intelligence layer.

Given the cleaned text of one SEC filing (8-K Exhibit 99.1 earnings release, 10-K, 10-Q, or similar), produce a concise executive briefing in JSON form.

Hard rules:
- Do NOT hype. Use neutral, business-grade language.
- Every summary bullet must be supported by at least one verbatim quote from the source — populate the `evidence` array accordingly.
- If a financial metric is not stated in the document, OMIT IT (set the field to null) and add the field name to `missing_fields`. Never fabricate.
- Mark inferred conclusions explicitly (e.g. "implies …") and only when directly supported by stated facts.
- Numbers: keep the issuer's own formatting ($35.8M, $9.7 million, 200 MW, 150 megawatts) — do NOT round or convert units.

Physical-AI specialization: this dashboard tracks power-backed compute & data-center issuers. Capture infrastructure detail in `physical_ai`:
  - `sites`: named locations (Cayuga, Lake Mariner, Childress, Rockdale, etc.)
  - `capacity_mw`: any megawatt figures with their context (e.g. "200 MW Cayuga online by Q4 2026")
  - `customers_or_partners`: named tenants / counterparties / hyperscalers (Google, Fluidstack, Microsoft, Core42, etc.)
  - `build_phases`: timeline / milestone language (Phase 1 / Phase 2, energization dates, target ready-for-service)

Length:
- 5–8 summary_bullets
- ≤6 operational_highlights
- ≤4 risks

If the document is not an earnings or IR document (e.g. proxy, registration), still extract what you can; populate `missing_fields` with categories that don't apply."""


_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "summary_bullets": {
            "type": "array",
            "items": {"type": "string"},
            "minItems": 3,
            "maxItems": 8,
        },
        "financial_highlights": {
            "type": "object",
            "properties": {
                "revenue": {"type": "string", "nullable": True},
                "ebitda": {"type": "string", "nullable": True},
                "net_income": {"type": "string", "nullable": True},
                "cash": {"type": "string", "nullable": True},
                "capex": {"type": "string", "nullable": True},
                "guidance": {"type": "string", "nullable": True},
            },
            "required": ["revenue", "ebitda", "net_income", "cash", "capex", "guidance"],
        },
        "operational_highlights": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 6,
        },
        "physical_ai": {
            "type": "object",
            "properties": {
                "sites": {"type": "array", "items": {"type": "string"}},
                "capacity_mw": {"type": "array", "items": {"type": "string"}},
                "customers_or_partners": {"type": "array", "items": {"type": "string"}},
                "build_phases": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["sites", "capacity_mw", "customers_or_partners", "build_phases"],
        },
        "risks": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 4,
        },
        "evidence": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "bullet_index": {"type": "integer"},
                    "quote": {"type": "string"},
                },
                "required": ["bullet_index", "quote"],
            },
        },
        "missing_fields": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
    "required": [
        "summary_bullets",
        "financial_highlights",
        "operational_highlights",
        "physical_ai",
        "risks",
        "evidence",
        "missing_fields",
    ],
}


def _cache_path(accession_clean: str) -> pathlib.Path:
    return _CACHE_DIR / f"{accession_clean}-summary.json"


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
        _CACHE_DIR.mkdir(parents=True, exist_ok=True)
        _cache_path(accession_clean).write_text(json.dumps(payload))
    except Exception as exc:  # disk-write failures shouldn't crash the request
        log.warning("filing-summary cache write failed for %s: %s", accession_clean, exc)


def get_cached_summary(accession: str) -> Optional[Dict[str, Any]]:
    """Return the cached summary for ``accession`` or None if not extracted yet."""
    return _read_cache(accession.replace("-", ""))


def generate_filing_summary(
    ticker: str,
    accession: str,
    body: str,
    filing_form: str = "8-K",
    filing_date: Optional[str] = None,
    title: Optional[str] = None,
    *,
    force: bool = False,
) -> Optional[Dict[str, Any]]:
    """Generate (or retrieve cached) AI summary for a single filing.

    Returns the parsed JSON dict, or None when the API key is missing / the
    SDK isn't installed / the call fails. Callers should treat None as a
    soft failure and surface "AI summary unavailable" in the UI.
    """
    if not body or not accession:
        return None

    accession_clean = accession.replace("-", "")
    if not force:
        cached = _read_cache(accession_clean)
        if cached is not None:
            return cached

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        log.info("filing-summary: GEMINI_API_KEY absent; skipping for %s/%s", ticker, accession)
        return None

    try:
        from google import genai
        from google.genai import types
    except ImportError:
        log.warning("google-genai not installed; filing summary unavailable")
        return None

    # Most 8-K Exhibit 99.1 press releases are ≤50KB cleaned text; 10-K/10-Q
    # full bodies can be huge but we only get exhibit-99.1 from sec_exhibits
    # for 8-Ks. Trim defensively to keep token cost bounded.
    body_for_prompt = body[:60_000]

    user_parts = [f"Ticker: {ticker}", f"Filing form: {filing_form}"]
    if title:
        user_parts.append(f"Title: {title}")
    if filing_date:
        user_parts.append(f"Filing date: {filing_date}")
    user_parts.append("")
    user_parts.append("Document text (cleaned):")
    user_parts.append("---")
    user_parts.append(body_for_prompt)
    user_parts.append("---")
    user_text = "\n".join(user_parts)

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
            log.warning("filing-summary: empty response for %s/%s", ticker, accession)
            return None
        parsed = json.loads(raw)
    except Exception:
        log.exception("filing-summary: Gemini call failed for %s/%s", ticker, accession)
        return None

    parsed["_model"] = _DEFAULT_MODEL
    parsed["_accession"] = accession
    parsed["_ticker"] = ticker
    parsed["_filing_form"] = filing_form
    parsed["_filing_date"] = filing_date
    parsed["_title"] = title
    parsed["_generated_at"] = int(time.time())
    parsed["_elapsed_sec"] = round(time.time() - started, 2)

    _write_cache(accession_clean, parsed)
    log.info(
        "filing-summary: generated for %s/%s in %.1fs (%d bullets)",
        ticker,
        accession,
        parsed["_elapsed_sec"],
        len(parsed.get("summary_bullets") or []),
    )
    return parsed
