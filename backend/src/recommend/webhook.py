"""Outbound webhook dispatcher — POSTs RecommendationResponse to a remote
Claude agent's URL on a schedule.

Env vars:
    REMOTE_AGENT_WEBHOOK_URL    Required to enable dispatch
    REMOTE_AGENT_WEBHOOK_TOKEN  Bearer token; sent as Authorization header
    REMOTE_AGENT_ONLY_ACTIONABLE  "true"/"false" (default true): skip HOLD verdicts

When the URL/token aren't set, scan_and_dispatch is a no-op so it's safe to
register the cron job unconditionally.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Iterable, List, Optional

import requests
from pydantic import BaseModel

from recommend.engine import build_recommendation
from recommend.models import RecommendationResponse

log = logging.getLogger(__name__)

DEFAULT_WATCHLIST: List[str] = ["RDW", "WULF", "CIFR", "ONDS", "CLSK"]


class WebhookConfig(BaseModel):
    remote_url: str
    bearer_token: str
    watchlist: List[str]
    only_actionable: bool = True


def load_webhook_config() -> Optional[WebhookConfig]:
    url = os.environ.get("REMOTE_AGENT_WEBHOOK_URL", "").strip()
    token = os.environ.get("REMOTE_AGENT_WEBHOOK_TOKEN", "").strip()
    if not url or not token:
        return None

    only_actionable = os.environ.get("REMOTE_AGENT_ONLY_ACTIONABLE", "true").lower() != "false"

    try:
        from engine.config import EngineConfig

        watchlist = list(EngineConfig().tickers) or DEFAULT_WATCHLIST
    except Exception:
        watchlist = DEFAULT_WATCHLIST

    return WebhookConfig(
        remote_url=url,
        bearer_token=token,
        watchlist=watchlist,
        only_actionable=only_actionable,
    )


async def scan_and_dispatch() -> dict:
    """Cron entry point: build a recommendation per watchlist ticker, POST
    each one to the remote URL. Returns a summary dict suitable for logs.
    """
    cfg = load_webhook_config()
    if cfg is None:
        log.info("scan_and_dispatch: REMOTE_AGENT_WEBHOOK_URL not configured — skipping")
        return {"dispatched": 0, "skipped": 0, "errors": 0, "configured": False}

    dispatched = 0
    skipped = 0
    errors = 0
    per_ticker: List[dict] = []

    for ticker in cfg.watchlist:
        try:
            rec = await build_recommendation(ticker)
        except Exception as exc:  # noqa: BLE001
            log.warning("scan_and_dispatch: build failed for %s: %s", ticker, exc)
            errors += 1
            per_ticker.append({"ticker": ticker, "status": "build_failed", "error": str(exc)})
            continue

        if cfg.only_actionable and not _has_actionable(rec):
            skipped += 1
            per_ticker.append({"ticker": ticker, "status": "skipped_not_actionable",
                               "verdict": rec.verdict})
            continue

        ok, detail = await _post_with_retry(cfg, rec)
        if ok:
            dispatched += 1
            per_ticker.append({"ticker": ticker, "status": "dispatched",
                               "verdict": rec.verdict})
        else:
            errors += 1
            per_ticker.append({"ticker": ticker, "status": "post_failed", "error": detail})

    return {
        "configured": True,
        "watchlist": cfg.watchlist,
        "dispatched": dispatched,
        "skipped": skipped,
        "errors": errors,
        "results": per_ticker,
    }


def _has_actionable(rec: RecommendationResponse) -> bool:
    return any(b.actionable for b in rec.strategies)


async def _post_with_retry(
    cfg: WebhookConfig,
    rec: RecommendationResponse,
    *,
    delays: Iterable[float] = (1.0, 4.0, 16.0),
) -> tuple[bool, str]:
    """POST one recommendation with up to 3 retries (1s/4s/16s backoff).
    Returns (ok, detail) where detail is a short status string for logs.
    """
    payload = rec.model_dump(mode="json")
    headers = {
        "Authorization": f"Bearer {cfg.bearer_token}",
        "Content-Type": "application/json",
    }

    last_detail = ""
    attempts = [0.0, *delays]
    for i, delay in enumerate(attempts):
        if delay:
            await asyncio.sleep(delay)
        started = time.perf_counter()
        try:
            resp = await asyncio.to_thread(
                requests.post, cfg.remote_url, json=payload, headers=headers, timeout=10
            )
        except Exception as exc:  # noqa: BLE001
            last_detail = f"attempt {i}: {type(exc).__name__}: {exc}"
            log.warning("webhook POST exception for %s: %s", rec.ticker, last_detail)
            continue
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        if 200 <= resp.status_code < 300:
            log.info("webhook delivered %s in %.0fms (status %d)", rec.ticker, elapsed_ms, resp.status_code)
            return True, f"{resp.status_code} in {elapsed_ms:.0f}ms"
        last_detail = f"attempt {i}: HTTP {resp.status_code} {resp.text[:200]}"
        log.warning("webhook POST non-2xx for %s: %s", rec.ticker, last_detail)
        # Don't retry on 4xx other than 408/429 — they won't change
        if 400 <= resp.status_code < 500 and resp.status_code not in (408, 429):
            break

    return False, last_detail
