"""Async Postgres pool factory.

Each backend service (pricing-api, data-api, portfolio-api, llm-api,
engine-worker) picks up its own DSN from env. Service-specific roles are
created by infra/postgres/init.sql so a compromised LLM container can't drop
journal.trades.

Usage:
    from infra.db import get_engine, get_session
    async with get_session() as session:
        rows = (await session.execute(stmt)).fetchall()
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import AsyncIterator, Optional

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


_DSN_BY_SERVICE = {
    "pricing-api":   "PRICING_PG_DSN",
    "data-api":      "DATA_PG_DSN",
    "portfolio-api": "PORTFOLIO_PG_DSN",
    "llm-api":       "LLM_PG_DSN",
    "engine-worker": "WORKER_PG_DSN",
}

_engine: Optional[AsyncEngine] = None
_session_factory: Optional[async_sessionmaker[AsyncSession]] = None


def _resolve_dsn() -> Optional[str]:
    service = os.getenv("SERVICE_NAME", "")
    env_key = _DSN_BY_SERVICE.get(service, "DATABASE_URL")
    return os.getenv(env_key) or os.getenv("DATABASE_URL")


def get_engine() -> Optional[AsyncEngine]:
    """Return the lazily-initialized AsyncEngine, or None if no DSN is set.

    Callers must handle the None case during the rolling SQLite→Postgres
    cutover (modules still on sqlite3 will skip the Postgres path entirely).
    """
    global _engine, _session_factory
    if _engine is not None:
        return _engine
    dsn = _resolve_dsn()
    if not dsn:
        return None
    _engine = create_async_engine(
        dsn,
        pool_size=5,
        max_overflow=5,
        pool_pre_ping=True,
        future=True,
    )
    _session_factory = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)
    return _engine


@asynccontextmanager
async def get_session() -> AsyncIterator[AsyncSession]:
    if get_engine() is None or _session_factory is None:
        raise RuntimeError(
            "Postgres DSN not configured for this service. "
            "Set the per-service env var (e.g. PRICING_PG_DSN) before calling get_session()."
        )
    async with _session_factory() as session:
        yield session


async def ping() -> bool:
    """Best-effort health probe used by /health and Docker healthchecks."""
    eng = get_engine()
    if eng is None:
        return False
    try:
        async with eng.connect() as conn:
            await conn.exec_driver_sql("SELECT 1")
        return True
    except Exception:
        return False


async def close() -> None:
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None
