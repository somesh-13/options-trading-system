"""Structured JSON logging + in-memory metrics registry (roadmap §11.4).

Designed for Cloud Run / GCP Logging which parses stdout JSON into structured
fields. Metrics are kept in-process (no Prometheus client dependency) and
served via a simple text-format endpoint.
"""

from __future__ import annotations

import json
import logging
import logging.handlers
import os
import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# JSON logging
# ---------------------------------------------------------------------------


class JsonFormatter(logging.Formatter):
    """Emit a single-line JSON record per log message."""

    RESERVED = {
        "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
        "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
        "created", "msecs", "relativeCreated", "thread", "threadName",
        "processName", "process", "message",
    }

    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created))
                  + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        # Tag every log line with the owning service so `docker compose logs`
        # output can be filtered downstream (e.g. `jq 'select(.service=="data-api")'`).
        svc = os.environ.get("SERVICE_NAME")
        if svc:
            payload["service"] = svc
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        for key, value in record.__dict__.items():
            if key in self.RESERVED or key.startswith("_"):
                continue
            payload[key] = value
        return json.dumps(payload, default=str)


def configure_json_logging(level: int = logging.INFO) -> None:
    """Attach the JSON formatter to the root logger (idempotent).

    Always writes JSON to stdout. If BACKEND_LOG_DIR is set (or the conventional
    ``backend/logs/`` directory exists/can be created), additionally writes a
    rotating ERROR-only file ``backend-error.log`` so production errors survive
    independent of the parent shell's redirection.
    """
    root = logging.getLogger()
    for h in list(root.handlers):
        root.removeHandler(h)
    formatter = JsonFormatter()
    stdout_handler = logging.StreamHandler(sys.stdout)
    stdout_handler.setFormatter(formatter)
    root.addHandler(stdout_handler)
    root.setLevel(level)

    log_dir = os.environ.get("BACKEND_LOG_DIR")
    if not log_dir:
        log_dir = str(Path(__file__).resolve().parents[2] / "logs")
    try:
        Path(log_dir).mkdir(parents=True, exist_ok=True)
        err_handler = logging.handlers.RotatingFileHandler(
            os.path.join(log_dir, "backend-error.log"),
            maxBytes=10 * 1024 * 1024,
            backupCount=5,
            encoding="utf-8",
        )
        err_handler.setLevel(logging.ERROR)
        err_handler.setFormatter(formatter)
        root.addHandler(err_handler)
    except Exception as exc:  # noqa: BLE001 — logging must never break startup
        sys.stderr.write(f"[observability] error-log handler disabled: {exc}\n")


# ---------------------------------------------------------------------------
# Correlation IDs
# ---------------------------------------------------------------------------

_current_correlation: threading.local = threading.local()


def set_correlation_id(value: Optional[str] = None) -> str:
    cid = value or uuid.uuid4().hex[:16]
    _current_correlation.value = cid
    return cid


def get_correlation_id() -> Optional[str]:
    return getattr(_current_correlation, "value", None)


# ---------------------------------------------------------------------------
# Metrics registry (in-memory, thread-safe)
# ---------------------------------------------------------------------------


@dataclass
class _Counter:
    value: float = 0.0


@dataclass
class _Histogram:
    samples: List[float] = field(default_factory=list)
    max_samples: int = 1024

    def observe(self, value: float) -> None:
        if len(self.samples) >= self.max_samples:
            self.samples.pop(0)
        self.samples.append(float(value))


class MetricsRegistry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counters: Dict[str, _Counter] = {}
        self._histograms: Dict[str, _Histogram] = {}

    def incr(self, name: str, delta: float = 1.0) -> None:
        with self._lock:
            c = self._counters.setdefault(name, _Counter())
            c.value += float(delta)

    def observe(self, name: str, value: float) -> None:
        with self._lock:
            h = self._histograms.setdefault(name, _Histogram())
            h.observe(value)

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            counters = {k: v.value for k, v in self._counters.items()}
            histograms: Dict[str, Dict[str, float]] = {}
            for name, h in self._histograms.items():
                if not h.samples:
                    continue
                xs = sorted(h.samples)
                n = len(xs)
                histograms[name] = {
                    "count": float(n),
                    "sum": float(sum(xs)),
                    "avg": float(sum(xs) / n),
                    "p50": float(xs[n // 2]),
                    "p95": float(xs[min(n - 1, int(n * 0.95))]),
                    "p99": float(xs[min(n - 1, int(n * 0.99))]),
                    "max": float(xs[-1]),
                }
        return {"counters": counters, "histograms": histograms}

    def render_text(self) -> str:
        """Render a Prometheus-ish text exposition of the current snapshot."""
        snap = self.snapshot()
        lines: List[str] = []
        for name, value in snap["counters"].items():
            lines.append(f"{name} {value}")
        for name, stats in snap["histograms"].items():
            for suffix, v in stats.items():
                lines.append(f"{name}_{suffix} {v}")
        return "\n".join(lines) + "\n"


_metrics = MetricsRegistry()


def metrics() -> MetricsRegistry:
    return _metrics
