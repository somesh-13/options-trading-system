"""Async Redis client factory.

Used for hot caches (quotes, vol surfaces, LLM idempotency keys, session
revocation, scheduler distributed locks). One connection pool per process.

Helpers also provide a convenience JSON cache pattern:
    val = await cache_get_json("quote:HOOD")
    await cache_set_json("quote:HOOD", payload, ttl=30)
"""

from __future__ import annotations

import json
import os
from typing import Any, Optional

import redis.asyncio as aioredis

_client: Optional[aioredis.Redis] = None


def get_client() -> Optional[aioredis.Redis]:
    global _client
    if _client is not None:
        return _client
    url = os.getenv("REDIS_URL")
    if not url:
        return None
    _client = aioredis.from_url(url, encoding="utf-8", decode_responses=True)
    return _client


async def ping() -> bool:
    client = get_client()
    if client is None:
        return False
    try:
        return bool(await client.ping())
    except Exception:
        return False


async def cache_get_json(key: str) -> Any:
    client = get_client()
    if client is None:
        return None
    raw = await client.get(key)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


async def cache_set_json(key: str, value: Any, ttl: int = 60) -> None:
    client = get_client()
    if client is None:
        return
    await client.set(key, json.dumps(value, default=str), ex=ttl)


async def close() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
