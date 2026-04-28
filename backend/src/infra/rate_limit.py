"""Token-bucket rate limiter with per-API configuration (roadmap §11.3).

Usage::

    from infra.rate_limit import limiter

    limiter.configure("alpaca", rate_per_sec=5, burst=10)
    if limiter.acquire("alpaca", timeout=2.0):
        ...

The 3-tier cache and circuit breaker features are split across companion
modules; this one ships the core primitive.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Dict, Optional


@dataclass
class _Bucket:
    rate_per_sec: float
    burst: int
    tokens: float = 0.0
    last_refill: float = 0.0

    def refill(self, now: float) -> None:
        elapsed = max(0.0, now - self.last_refill)
        self.tokens = min(self.burst, self.tokens + elapsed * self.rate_per_sec)
        self.last_refill = now


class TokenBucketLimiter:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._buckets: Dict[str, _Bucket] = {}

    def configure(self, name: str, rate_per_sec: float, burst: int) -> None:
        with self._lock:
            self._buckets[name] = _Bucket(
                rate_per_sec=float(rate_per_sec),
                burst=int(burst),
                tokens=float(burst),
                last_refill=time.monotonic(),
            )

    def acquire(self, name: str, cost: float = 1.0, timeout: Optional[float] = None) -> bool:
        deadline = time.monotonic() + timeout if timeout is not None else None
        while True:
            with self._lock:
                bucket = self._buckets.get(name)
                if bucket is None:
                    return True  # Unknown APIs are permitted — configure() first to gate.
                now = time.monotonic()
                bucket.refill(now)
                if bucket.tokens >= cost:
                    bucket.tokens -= cost
                    return True
                needed = cost - bucket.tokens
                wait = needed / bucket.rate_per_sec if bucket.rate_per_sec > 0 else None
            if deadline is None:
                return False
            if wait is None or time.monotonic() + wait > deadline:
                return False
            time.sleep(min(wait, deadline - time.monotonic()))

    def tokens_remaining(self, name: str) -> Optional[float]:
        with self._lock:
            bucket = self._buckets.get(name)
            if bucket is None:
                return None
            bucket.refill(time.monotonic())
            return bucket.tokens


limiter = TokenBucketLimiter()

# Sensible defaults the API layer can override via env.
limiter.configure("alpaca", rate_per_sec=5, burst=20)
limiter.configure("gemini", rate_per_sec=2, burst=5)
limiter.configure("yahoo", rate_per_sec=3, burst=10)
