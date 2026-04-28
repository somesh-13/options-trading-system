"""
Natural-language scanner query parser.

Takes a free-form query like "Is CIFR overpriced compared to its 30-day HV?"
and returns a structured intent via Gemini. Falls back to a deterministic
regex parser when GEMINI_API_KEY is not configured so the UI stays usable.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

log = logging.getLogger(__name__)

# Separate env so we can use a text model here without disturbing the Live/audio
# model that the VegaEdge agent expects via GEMINI_MODEL.
TEXT_MODEL = os.getenv("GEMINI_TEXT_MODEL", "gemini-2.5-flash")

INTENTS = [
    "mispricing_check",
    "trade_recommendation",
    "price_query",
    "volatility_query",
    "regime_check",
    "comparison",
    "scan",
    "backtest",
    "news_sentiment",
    "other",
]

RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "tickers": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Uppercased US stock tickers mentioned in the query. Empty if none.",
        },
        "intent": {
            "type": "string",
            "enum": INTENTS,
            "description": "Primary action the user is asking for.",
        },
        "conditions": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Concrete filters/criteria the user stated (e.g. 'IV > HV', 'in the last 30 days', 'ratio above 1.3').",
        },
        "timeframe": {
            "type": "string",
            "description": "Time window, e.g. '1D', '1M', '30d', '5Y'. Empty string if absent.",
        },
        "summary": {
            "type": "string",
            "description": "One-sentence restatement of what the user is asking.",
        },
    },
    "required": ["tickers", "intent", "conditions", "summary"],
}

SYSTEM_PROMPT = (
    "You are a parser for a stock-analysis dashboard. "
    "Extract structured intent from the user's query. "
    "Always return valid JSON matching the schema. "
    f"Valid intents: {', '.join(INTENTS)}. "
    "Tickers must be uppercase US equity symbols (1-5 letters). "
    "If the query mentions a company by name (e.g. 'Cipher Mining', 'Apple'), "
    "convert to the canonical ticker (CIFR, AAPL) when confident. "
    "Never invent tickers; leave the list empty if unsure. "
    "Conditions should capture concrete numeric thresholds or qualitative "
    "filters in the user's own words (short phrases, not sentences)."
)


def _gemini_parse(query: str) -> Optional[Dict[str, Any]]:
    """Call Gemini with structured output. Returns None on any failure."""
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        return None

    try:
        from google import genai  # deferred import so a missing package doesn't block the module
        from google.genai import types
    except ImportError:
        log.warning("google-genai not installed; skipping Gemini parse")
        return None

    try:
        client = genai.Client(api_key=api_key)
        resp = client.models.generate_content(
            model=TEXT_MODEL,
            contents=query,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                response_mime_type="application/json",
                response_schema=RESPONSE_SCHEMA,
                temperature=0.0,
            ),
        )
        text = getattr(resp, "text", "") or ""
        if not text.strip():
            return None
        return json.loads(text)
    except Exception:
        log.exception("Gemini NL-parse failed")
        return None


_TICKER_RE = re.compile(r"\b([A-Z]{1,5})\b")
_NAME_TO_TICKER = {
    "apple": "AAPL",
    "microsoft": "MSFT",
    "google": "GOOGL",
    "alphabet": "GOOGL",
    "amazon": "AMZN",
    "meta": "META",
    "facebook": "META",
    "nvidia": "NVDA",
    "tesla": "TSLA",
    "cipher mining": "CIFR",
    "cipher": "CIFR",
    "cipher-mining": "CIFR",
    "marathon": "MARA",
    "marathon digital": "MARA",
    "riot platforms": "RIOT",
    "riot": "RIOT",
    "terawulf": "WULF",
    "wulf": "WULF",
    "robinhood": "HOOD",
    "coinbase": "COIN",
    "paypal": "PYPL",
    "grab": "GRAB",
}
_STOPWORDS = {
    "IS", "THE", "AND", "OR", "OF", "IN", "TO", "FOR", "ON", "BY", "AT", "IT",
    "AS", "IF", "BE", "HAS", "THAN", "THIS", "THAT", "A", "AN", "I",
    "ARE", "DO", "DOES", "WILL", "HOW", "WHY", "WHAT", "WHEN", "COMPARE",
    "COMPARED", "TODAY", "NOW", "WEEK", "MONTH", "YEAR", "DAY", "DAYS",
    "IV", "HV", "EV", "BUY", "SELL", "NEUTRAL", "VS", "OVER", "UNDER",
}


def _regex_parse(query: str) -> Dict[str, Any]:
    """Deterministic fallback parser. Good enough to keep the UI responsive."""
    q = query.strip()
    low = q.lower()

    tickers: List[str] = []
    for candidate in _TICKER_RE.findall(q):
        if candidate in _STOPWORDS:
            continue
        if candidate not in tickers:
            tickers.append(candidate)

    for phrase, sym in _NAME_TO_TICKER.items():
        if phrase in low and sym not in tickers:
            tickers.append(sym)

    # Very rough intent classification.
    def has(*words: str) -> bool:
        return any(w in low for w in words)

    if has("overpriced", "overvalued", "undervalued", "mispriced", "fair value", "cheap", "expensive"):
        intent = "mispricing_check"
    elif has("buy", "sell", "trade", "position", "strike", "recommend"):
        intent = "trade_recommendation"
    elif has("price", "quote", "trading at"):
        intent = "price_query"
    elif has("volatility", "iv", "hv", "implied"):
        intent = "volatility_query"
    elif has("regime", "crash", "high-vol"):
        intent = "regime_check"
    elif has("compare", "vs ", "versus", "against"):
        intent = "comparison"
    elif has("scan", "screen", "find", "which stocks", "show me"):
        intent = "scan"
    elif has("backtest", "past", "historical"):
        intent = "backtest"
    elif has("news", "sentiment", "filing"):
        intent = "news_sentiment"
    else:
        intent = "other"

    conditions: List[str] = []
    for pattern, label in [
        (r"ratio\s*[><=]+\s*[\d.]+", None),
        (r"iv\s*[><=]+\s*hv", None),
        (r"hv\s*[><=]+\s*iv", None),
        (r"last\s+\d+\s*(days?|weeks?|months?|years?)", None),
        (r"\d+[-\s]?day", None),
        (r"above\s*\d+%?", None),
        (r"below\s*\d+%?", None),
        (r"30[-\s]?day", None),
    ]:
        for m in re.findall(pattern, low):
            text = m if isinstance(m, str) else " ".join(m)
            if label:
                text = label
            if text and text not in conditions:
                conditions.append(text)

    timeframe = ""
    for pat in [r"\b(1D|5D|1M|3M|6M|1Y|2Y|5Y)\b", r"(\d+)\s*(?:days?|weeks?|months?|years?)"]:
        m = re.search(pat, q, re.IGNORECASE)
        if m:
            timeframe = m.group(0).upper()
            break

    summary = q if len(q) <= 140 else (q[:137] + "…")

    return {
        "tickers": tickers,
        "intent": intent,
        "conditions": conditions,
        "timeframe": timeframe,
        "summary": summary,
    }


def parse_nl_query(query: str) -> Dict[str, Any]:
    """
    Primary entry point. Returns dict with keys:
      tickers, intent, conditions, timeframe, summary, source
    `source` is 'gemini' or 'regex' depending on which path handled it.
    """
    q = (query or "").strip()
    if not q:
        return {
            "tickers": [],
            "intent": "other",
            "conditions": [],
            "timeframe": "",
            "summary": "",
            "source": "regex",
        }

    gemini = _gemini_parse(q)
    if gemini is not None:
        gemini.setdefault("tickers", [])
        gemini.setdefault("conditions", [])
        gemini.setdefault("timeframe", "")
        gemini.setdefault("summary", q)
        gemini.setdefault("intent", "other")
        gemini["tickers"] = [t.upper() for t in gemini["tickers"] if isinstance(t, str) and t.strip()]
        gemini["source"] = "gemini"
        return gemini

    fallback = _regex_parse(q)
    fallback["source"] = "regex"
    return fallback
