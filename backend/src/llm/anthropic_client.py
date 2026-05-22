"""Thin Anthropic client wrapper for the regime-shift scanner.

Lives separately from the Gemini wiring (data/earnings_llm_extract.py,
scanner/nl_parser.py) because the analytical workload has different needs:
strict JSON output, prompt caching on the (large) rubric system prompt, and a
single repair retry when the model returns prose around the JSON.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, Optional

log = logging.getLogger(__name__)

DEFAULT_MODEL = os.environ.get("REGIME_SHIFT_MODEL", "claude-sonnet-4-6")
_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


class AnthropicNotConfigured(RuntimeError):
    """ANTHROPIC_API_KEY missing — caller should surface a friendly error."""


def _client():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise AnthropicNotConfigured(
            "ANTHROPIC_API_KEY is not set. Add it to backend/.env to enable the regime-shift scanner."
        )
    try:
        from anthropic import Anthropic
    except ImportError as e:
        raise AnthropicNotConfigured(
            "anthropic SDK not installed. Run `pip install -r backend/requirements.txt`."
        ) from e
    return Anthropic(api_key=api_key)


def _parse_json_loose(text: str) -> Optional[Dict[str, Any]]:
    """Try strict JSON first; then a best-effort {...} block extraction.

    Claude with our system prompt almost always returns clean JSON, but if it
    wraps the response in prose ("Here is the analysis: { ... }") we still
    want to recover.
    """
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    m = _JSON_BLOCK_RE.search(text)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def complete_json(
    *,
    system: str,
    user: str,
    model: str = DEFAULT_MODEL,
    max_tokens: int = 2048,
    cache_system: bool = True,
) -> Dict[str, Any]:
    """Call Claude and return a parsed JSON dict.

    The system prompt is large and reused across tickers, so we mark it with
    ``cache_control={"type": "ephemeral"}`` to engage prompt caching. The
    first call pays the full system-prompt cost; subsequent calls within the
    5-minute TTL pay a discount.

    On parse failure, makes one repair attempt — sends the original output
    back with an instruction to return JSON only — before giving up.
    """
    client = _client()

    system_blocks: list[Dict[str, Any]] = [
        {"type": "text", "text": system, **({"cache_control": {"type": "ephemeral"}} if cache_system else {})}
    ]

    def _call(user_text: str) -> str:
        resp = client.messages.create(
            model=model,
            max_tokens=max_tokens,
            system=system_blocks,
            messages=[{"role": "user", "content": user_text}],
        )
        # Claude returns a list of content blocks; the JSON we want is in the text blocks.
        return "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")

    raw = _call(user)
    parsed = _parse_json_loose(raw)
    if parsed is not None:
        return parsed

    log.warning("Claude regime-shift response was not valid JSON; attempting one repair pass")
    repair_user = (
        "Your previous response was not valid JSON. Re-emit ONLY the JSON object — "
        "no prose, no code fences, no commentary. Original response was:\n\n"
        + raw
    )
    raw2 = _call(repair_user)
    parsed2 = _parse_json_loose(raw2)
    if parsed2 is not None:
        return parsed2

    raise ValueError(
        "Claude did not return parseable JSON after one repair attempt. "
        "First 200 chars of raw output: " + (raw[:200] if raw else "<empty>")
    )
