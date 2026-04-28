"""Tech-debt tests: token-bucket limiter + metrics registry."""

import sys
import time
from pathlib import Path

BACKEND_SRC = Path(__file__).resolve().parent.parent / "src"
if str(BACKEND_SRC) not in sys.path:
    sys.path.insert(0, str(BACKEND_SRC))


def test_token_bucket_respects_burst():
    from infra.rate_limit import TokenBucketLimiter

    lim = TokenBucketLimiter()
    lim.configure("test", rate_per_sec=10, burst=3)
    assert lim.acquire("test") is True
    assert lim.acquire("test") is True
    assert lim.acquire("test") is True
    # Bucket empty — non-blocking acquire should fail.
    assert lim.acquire("test", timeout=0) is False


def test_token_bucket_refills_over_time():
    from infra.rate_limit import TokenBucketLimiter

    lim = TokenBucketLimiter()
    lim.configure("test", rate_per_sec=100, burst=1)
    assert lim.acquire("test") is True
    assert lim.acquire("test", timeout=0) is False
    time.sleep(0.03)  # ~3 tokens should have refilled
    assert lim.acquire("test", timeout=0) is True


def test_metrics_snapshot_and_render():
    from infra.observability import MetricsRegistry

    m = MetricsRegistry()
    m.incr("hits", 3)
    for v in (10, 20, 30, 40, 50):
        m.observe("latency_ms", v)

    snap = m.snapshot()
    assert snap["counters"]["hits"] == 3
    lat = snap["histograms"]["latency_ms"]
    assert lat["count"] == 5
    assert lat["avg"] == 30.0

    text = m.render_text()
    assert "hits 3.0" in text
    assert "latency_ms_count 5.0" in text


def test_correlation_id_round_trips():
    from infra.observability import get_correlation_id, set_correlation_id

    cid = set_correlation_id()
    assert cid
    assert get_correlation_id() == cid
    override = set_correlation_id("custom-id")
    assert override == "custom-id"
    assert get_correlation_id() == "custom-id"
