"""One-shot Gemini chat grounded in a per-ticker positions report.

Each call rebuilds the report fresh and injects it as system context so the
model can only answer from the user's actual positions. No persistence — chat
history is supplied by the client on every request.
"""

from __future__ import annotations

import logging
import os
import time
from typing import List, Optional

from robinhood.ticker_report import build_ticker_report, report_to_markdown

log = logging.getLogger(__name__)

# Reuse the same model the IR classifier uses by default — proven and cheap.
_DEFAULT_MODEL = (
    os.getenv("TICKER_CHAT_MODEL")
    or os.getenv("CONTRACT_LLM_MODEL")
    or "gemini-2.5-flash"
)

_SYSTEM_TEMPLATE = (
    "You are a concise trading-positions assistant. Answer ONLY using the "
    "report below — do not invent positions, prices, or Greeks. If the user "
    "asks about something the report does not cover, say so plainly. Prefer "
    "specific numbers over hedging language. When asked about loss or "
    "breakeven, derive it from the strikes, premiums, and current marks in "
    "the report.\n\n"
    "=== REPORT FOR {ticker} ===\n"
    "{report_md}\n"
    "=== END REPORT ===\n"
)


def _format_history(history: List[dict]) -> List[dict]:
    """Convert chat history to google-genai contents format.

    Maps `role: 'assistant'` → `'model'` (genai convention) and ignores
    anything outside `user`/`assistant`.
    """
    contents: List[dict] = []
    for m in history or []:
        role = (m.get("role") or "").lower()
        text = (m.get("content") or "").strip()
        if not text:
            continue
        if role == "user":
            contents.append({"role": "user", "parts": [{"text": text}]})
        elif role in ("assistant", "model"):
            contents.append({"role": "model", "parts": [{"text": text}]})
    return contents


def chat_about_ticker(
    ticker: str,
    message: str,
    history: Optional[List[dict]] = None,
    account: Optional[str] = None,
) -> dict:
    """Build the report → call Gemini → return reply.

    Returns: {reply: str, model: str, latency_ms: int, error?: str}
    """
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not api_key:
        return {
            "reply": "",
            "model": _DEFAULT_MODEL,
            "latency_ms": 0,
            "error": "GEMINI_API_KEY not set on backend",
        }

    try:
        from google import genai
        from google.genai import types
    except ImportError:
        return {
            "reply": "",
            "model": _DEFAULT_MODEL,
            "latency_ms": 0,
            "error": "google-genai package not installed",
        }

    report = build_ticker_report(ticker, account)
    report_md = report_to_markdown(report)
    system = _SYSTEM_TEMPLATE.format(ticker=ticker.upper(), report_md=report_md)

    contents = _format_history(history or [])
    contents.append({"role": "user", "parts": [{"text": message}]})

    started = time.time()
    try:
        client = genai.Client(api_key=api_key)
        resp = client.models.generate_content(
            model=_DEFAULT_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system,
                temperature=0.2,
            ),
        )
        text = (getattr(resp, "text", "") or "").strip()
    except Exception as exc:
        log.exception("Gemini ticker-chat failed")
        return {
            "reply": "",
            "model": _DEFAULT_MODEL,
            "latency_ms": int((time.time() - started) * 1000),
            "error": f"Gemini call failed: {exc}",
        }

    return {
        "reply": text or "(empty response)",
        "model": _DEFAULT_MODEL,
        "latency_ms": int((time.time() - started) * 1000),
    }
