"""Per-service FastAPI entrypoint.

The existing ``api.routes:app`` is a single 4k-line FastAPI app with every
domain mounted directly on the app. To split the deployment into 5 isolated
containers (pricing-api, data-api, portfolio-api, llm-api, engine-worker)
without rewriting routes.py, this module:

  1. Reads ``SERVICE_NAME`` from env.
  2. Imports the monolithic ``app``.
  3. Filters its routes to keep only those whose path matches the prefixes
     this service owns. WebSocket, /metrics, /docs, /redoc, /openapi.json
     and /health/* are always kept.
  4. Replaces /health with a service-aware version that pings the DBs this
     service depends on.

A crash inside one container only affects routes for that service — NPM
maps each /api/<prefix> path to exactly one upstream, so a flaky SEC
scraper in data-api can't take down /api/pricing or /api/robinhood.

Run with: ``uvicorn api.entry:app --host 0.0.0.0 --port 8080``
"""

from __future__ import annotations

import logging
import os
from typing import Iterable

from fastapi.routing import APIRoute
from starlette.routing import WebSocketRoute

log = logging.getLogger(__name__)

# ----------------------------------------------------------------------------
# Prefix map — keep aligned with infra/npm/seed-proxy-hosts.sh
# ----------------------------------------------------------------------------
SERVICE_PREFIXES: dict[str, tuple[str, ...]] = {
    "pricing-api": (
        "/api/pricing",
        "/api/mispricing",
        "/api/backtest",
        "/api/replay",
        "/api/risk",          # stress test, P&L attribution, TCA — pricing-adjacent
        "/api/hedge",
        "/api/strategy",
    ),
    "data-api": (
        "/api/market",
        "/api/sec",
        "/api/etf",
        "/api/ir",
        "/api/macro-news",
        "/api/sentiment",
        "/api/scanner",
        "/api/flow",
    ),
    "portfolio-api": (
        "/api/robinhood",
        "/api/auth",
        "/api/notifications",
        "/api/analytics",
        "/api/execution",
        "/api/portfolio",
        "/api/journal",
        "/api/engine",
    ),
    "llm-api": (
        "/api/agents",
        "/api/regime",
        "/api/signals",
    ),
}

# Always-kept paths (don't depend on a domain)
COMMON_PATHS = ("/", "/health", "/ready", "/metrics", "/docs", "/redoc", "/openapi.json")


def _belongs(path: str, prefixes: Iterable[str]) -> bool:
    if path in COMMON_PATHS:
        return True
    return any(path.startswith(p) for p in prefixes)


def _build_app():
    # Import here so a misconfigured SERVICE_NAME logs cleanly before pulling
    # in the heavy yfinance/scipy dependency chain.
    from api.routes import app as monolith

    service = os.getenv("SERVICE_NAME", "").strip()
    if service not in SERVICE_PREFIXES:
        log.warning(
            "SERVICE_NAME=%r not in %s — running the unfiltered monolith. "
            "Set SERVICE_NAME for per-service deployment.",
            service, list(SERVICE_PREFIXES.keys()),
        )
        return monolith

    prefixes = SERVICE_PREFIXES[service]
    kept: list = []
    dropped = 0
    for route in monolith.router.routes:
        # WebSocket routes (api.ws_routes) live under /ws — keep on portfolio-api.
        if isinstance(route, WebSocketRoute):
            if service == "portfolio-api":
                kept.append(route)
            else:
                dropped += 1
            continue
        if isinstance(route, APIRoute):
            if _belongs(route.path, prefixes):
                kept.append(route)
            else:
                dropped += 1
            continue
        # Mount, Route (non-APIRoute), etc. — keep them.
        kept.append(route)

    monolith.router.routes = kept
    monolith.title = f"VegaEdge {service}"
    log.info(
        "service=%s kept=%d dropped=%d prefixes=%s",
        service, len(kept), dropped, prefixes,
    )

    # Override /health with a DB-aware probe (Docker healthcheck consumes this).
    _wire_health_probe(monolith, service)
    return monolith


def _wire_health_probe(app, service: str) -> None:
    """Replace the trivial /health with one that pings dependent DBs."""
    from fastapi import APIRouter
    from fastapi.responses import JSONResponse

    # Remove the original /health if it exists
    app.router.routes = [
        r for r in app.router.routes
        if not (isinstance(r, APIRoute) and r.path == "/health")
    ]

    router = APIRouter()

    @router.get("/health")
    async def health():
        from infra import db as pg
        from infra import mongo as mg
        from infra import redis as rd

        # All services hit Postgres + Redis. Mongo only matters for data-api / llm-api.
        results = {
            "service": service,
            "postgres": "ok" if await pg.ping() else "unconfigured-or-down",
            "redis": "ok" if await rd.ping() else "unconfigured-or-down",
        }
        if service in ("data-api", "llm-api"):
            results["mongo"] = "ok" if await mg.ping() else "unconfigured-or-down"

        # Healthcheck stays 200 even when DBs are unreachable during boot.
        # Docker `start_period` gives them time to come up. Hard failure modes
        # (process crashed, port not listening) are caught by curl's connect.
        return JSONResponse(status_code=200, content=results)

    app.include_router(router)


app = _build_app()
