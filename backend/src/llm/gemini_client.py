"""Gemini fallback for the regime-shift scanner.

Mirrors the ``complete_json(system, user, ...)`` shape of
``anthropic_client.py`` so callers can swap providers without changing the
call site. Used when ``ANTHROPIC_API_KEY`` is not set but ``GEMINI_API_KEY``
is — see ``scanner/regime_shift._select_llm``.
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, Optional

log = logging.getLogger(__name__)

_DEFAULT_MODEL_FALLBACK = "gemini-2.5-flash"
_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


def _resolved_default_model() -> str:
    """Re-read each call so a .env edit + reload flips the model without restart."""
    return os.environ.get("REGIME_SHIFT_GEMINI_MODEL") or _DEFAULT_MODEL_FALLBACK


# Module-level alias kept for callers that want a static reference (e.g. the
# regime_shift selector logs ``DEFAULT_MODEL`` for provenance).
DEFAULT_MODEL = _resolved_default_model()


class GeminiNotConfigured(RuntimeError):
    """GEMINI_API_KEY/GOOGLE_API_KEY missing."""


class GeminiQuotaExceeded(RuntimeError):
    """google-genai responded with 429 RESOURCE_EXHAUSTED (free-tier quota)."""


def _api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        raise GeminiNotConfigured(
            "GEMINI_API_KEY (or GOOGLE_API_KEY) is not set. Add it to backend/.env."
        )
    return key


def _parse_json_loose(text: str) -> Optional[Dict[str, Any]]:
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
    model: Optional[str] = None,
    max_tokens: int = 2048,
    cache_system: bool = True,  # accepted for API parity; Gemini doesn't expose explicit caching here
) -> Dict[str, Any]:
    """Call Gemini and return a parsed JSON dict.

    Uses ``response_mime_type="application/json"`` for strict JSON output.
    Falls back to a loose ``{...}`` extraction (and one repair retry) on the
    rare cases where the model wraps prose around the JSON.
    """
    del cache_system  # API parity with the Anthropic wrapper.

    resolved_model = model or _resolved_default_model()
    log.info("regime_shift gemini call: model=%s", resolved_model)

    api_key = _api_key()
    try:
        from google import genai
        from google.genai import types
    except ImportError as e:
        raise GeminiNotConfigured("google-genai not installed.") from e

    client = genai.Client(api_key=api_key)

    def _call(user_text: str) -> str:
        try:
            resp = client.models.generate_content(
                model=resolved_model,
                contents=user_text,
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    response_mime_type="application/json",
                    temperature=0.0,
                    max_output_tokens=max_tokens,
                ),
            )
        except Exception as exc:
            code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
            msg = str(exc)
            if code == 429 or "RESOURCE_EXHAUSTED" in msg or "429" in msg:
                raise GeminiQuotaExceeded(msg) from exc
            raise
        return (getattr(resp, "text", "") or "").strip()

    raw = _call(user)
    parsed = _parse_json_loose(raw)
    if parsed is not None:
        return parsed

    log.warning("Gemini regime-shift response was not valid JSON; attempting one repair pass")
    repair_user = (
        "Your previous response was not valid JSON. Re-emit ONLY the JSON object — "
        "no prose, no code fences, no commentary. Original response was:\n\n" + raw
    )
    raw2 = _call(repair_user)
    parsed2 = _parse_json_loose(raw2)
    if parsed2 is not None:
        return parsed2

    raise ValueError(
        "Gemini did not return parseable JSON after one repair attempt. "
        "First 200 chars of raw output: " + (raw[:200] if raw else "<empty>")
    )
