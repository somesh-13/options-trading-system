"""Thesis classifier for investor-relations items.

Each news headline / SEC filing / press release is labelled with one of:
    BULLISH      — positive catalyst (beat, raise, buyback, contract win)
    BEARISH      — negative catalyst (miss, dilution, downgrade, lawsuit)
    NEUTRAL      — mixed or no clear directional impact
    INFORMATIVE  — administrative disclosure with no thesis (8-K cover-only,
                   S-3 shelf filing, IR contact change, etc.)

Primary path is Gemini Flash via google-genai with structured JSON output.
When the API key is absent, the package isn't installed, the call errors, or
the response can't be parsed, we fall back to a lexicon scan over the existing
nlp_extractor signals — that path can't reliably distinguish NEUTRAL from
INFORMATIVE so it picks INFORMATIVE only when there are zero lexicon hits.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Dict, List, Optional

log = logging.getLogger(__name__)

THESIS_LABELS = ("BULLISH", "BEARISH", "NEUTRAL", "INFORMATIVE")

# Override-able for cost experiments. Default to flash because it's the
# cheapest text-tier model in the 2.5 family and the task is short.
_DEFAULT_MODEL = os.getenv("IR_CLASSIFIER_MODEL", "gemini-2.5-flash")

_RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "thesis": {"type": "string", "enum": list(THESIS_LABELS)},
        "confidence": {"type": "number"},
        "rationale": {"type": "string"},
    },
    "required": ["thesis", "confidence", "rationale"],
}

_SYSTEM_PROMPT = (
    "You classify investor-relations items (news headlines, SEC filings, "
    "press releases) for retail equity traders. Output exactly one thesis "
    "label that describes the likely impact on the issuer's share price "
    "over the next 1-5 trading days.\n"
    "- BULLISH = positive catalyst (beat, raise, buyback, contract win, "
    "FDA approval, upgrade).\n"
    "- BEARISH = negative catalyst (miss, dilution / ATM offering, "
    "downgrade, lawsuit, going-concern, recall).\n"
    "- NEUTRAL = mixed or no clear directional impact.\n"
    "- INFORMATIVE = administrative or disclosure-only items with no "
    "thesis (8-K cover-only, S-3 shelf, schedule, IR contact change, "
    "13G/13D non-event).\n"
    "Be skeptical of dilutive offerings — those are BEARISH even when "
    "framed as 'capital raise'. Confidence is your subjective certainty "
    "in the label, between 0 and 1."
)


def _gemini_classify(ticker: str, title: str, body: str) -> Optional[dict]:
    """Single Gemini call. Returns {'thesis','confidence','rationale','classifier'}
    or None on any failure (caller falls back to lexicon)."""
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        return None

    try:
        from google import genai  # deferred import — keep module loadable without dep
        from google.genai import types
    except ImportError:
        log.warning("google-genai not installed; lexicon fallback only")
        return None

    user_text = f"Ticker: {ticker}\nTitle: {title}\nBody: {(body or '')[:1500]}"
    try:
        client = genai.Client(api_key=api_key)
        resp = client.models.generate_content(
            model=_DEFAULT_MODEL,
            contents=user_text,
            config=types.GenerateContentConfig(
                system_instruction=_SYSTEM_PROMPT,
                response_mime_type="application/json",
                response_schema=_RESPONSE_SCHEMA,
                temperature=0.1,
            ),
        )
        text = (getattr(resp, "text", "") or "").strip()
        if not text:
            return None
        parsed = json.loads(text)
    except Exception:
        log.exception("Gemini IR-classify failed for %s", ticker)
        return None

    thesis = str(parsed.get("thesis", "")).upper()
    if thesis not in THESIS_LABELS:
        return None
    try:
        confidence = float(parsed.get("confidence", 0.5))
    except (TypeError, ValueError):
        confidence = 0.5
    confidence = max(0.0, min(1.0, confidence))
    rationale = str(parsed.get("rationale", "")).strip()[:600]
    return {
        "thesis": thesis,
        "confidence": round(confidence, 3),
        "rationale": rationale,
        "classifier": _DEFAULT_MODEL,
    }


def _lexicon_classify(title: str, body: str) -> dict:
    """Deterministic fallback that uses the existing nlp_extractor lexicons.

    INFORMATIVE is picked only when no bullish/bearish/dilution lexicon words
    appear at all — the lexicon can't otherwise distinguish 'mixed' from
    'administrative'. confidence is fixed at 0.5 to signal low certainty.
    """
    try:
        from data.nlp_extractor import (  # type: ignore
            BEARISH_WORDS,
            BULLISH_WORDS,
            DILUTION_WORDS,
            extract_sentiment,
        )
    except Exception:
        # If even the lexicon is unavailable, return INFORMATIVE so the row
        # still gets a label and the classifier loop terminates.
        return {
            "thesis": "INFORMATIVE",
            "confidence": 0.5,
            "rationale": "lexicon unavailable",
            "classifier": "lexicon-fallback",
        }

    blob = f"{title} {body or ''}".lower()
    has_bull = any(w in blob for w in BULLISH_WORDS)
    has_bear = any(w in blob for w in BEARISH_WORDS)
    has_dilution = any(w in blob for w in DILUTION_WORDS)

    score = extract_sentiment(f"{title} {body or ''}")

    if has_dilution and not has_bull:
        thesis = "BEARISH"
    elif score > 0.3:
        thesis = "BULLISH"
    elif score < -0.3:
        thesis = "BEARISH"
    elif has_bull or has_bear:
        thesis = "NEUTRAL"
    else:
        thesis = "INFORMATIVE"

    return {
        "thesis": thesis,
        "confidence": 0.5,
        "rationale": f"lexicon score={score:+.2f}",
        "classifier": "lexicon-fallback",
    }


def classify_ir_item(ticker: str, title: str, body: str = "") -> dict:
    """Top-level classifier. Always returns a usable dict; never raises.

    Result keys: thesis, confidence, rationale, classifier.
    """
    if not title:
        return {
            "thesis": "INFORMATIVE",
            "confidence": 0.4,
            "rationale": "no title",
            "classifier": "lexicon-fallback",
        }
    via_gemini = _gemini_classify(ticker, title, body)
    if via_gemini is not None:
        return via_gemini
    return _lexicon_classify(title, body)


def classify_batch(items: List[Dict]) -> List[Dict]:
    """Classify a batch of items in order.

    `items` shape: [{'ticker': str, 'title': str, 'body': str (optional)}, ...].
    Returns a list aligned with the input. A small sleep between Gemini calls
    keeps us well under any free-tier QPS ceiling.
    """
    out: List[Dict] = []
    for i, item in enumerate(items):
        out.append(
            classify_ir_item(
                ticker=str(item.get("ticker", "")).upper(),
                title=str(item.get("title", "")),
                body=str(item.get("body", "") or ""),
            )
        )
        # Throttle only between Gemini calls; lexicon hits are essentially free.
        if i + 1 < len(items) and out[-1]["classifier"] != "lexicon-fallback":
            time.sleep(0.2)
    return out
