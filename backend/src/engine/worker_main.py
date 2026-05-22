"""Standalone APScheduler entrypoint for the engine-worker container.

Runs the same cron jobs as the in-process scheduler, but without serving
HTTP. Keeps the FastAPI containers free of background work so a long-running
job can't block request handling, and so the scheduler stops cleanly when
this container is restarted.

Run with: ``python -m engine.worker_main``
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
from pathlib import Path

# Make sibling packages importable when run as `python -m engine.worker_main`
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

log = logging.getLogger("engine.worker")


async def _run() -> None:
    # Same structured JSON logging the API services use.
    try:
        from infra.observability import configure_json_logging
        configure_json_logging()
    except Exception as exc:  # noqa: BLE001
        logging.basicConfig(level=logging.INFO)
        log.warning("Falling back to basic logging: %s", exc)

    log.info("engine-worker booting (SERVICE_NAME=%s)", os.getenv("SERVICE_NAME", "engine-worker"))

    from engine.scheduler import start_scheduler, stop_scheduler

    sched = start_scheduler()
    log.info("scheduler started; jobs=%s", [j.id for j in sched.get_jobs()])

    stop_event = asyncio.Event()

    def _stop(*_a):
        log.info("shutdown signal received")
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, _stop)

    try:
        await stop_event.wait()
    finally:
        log.info("stopping scheduler")
        try:
            stop_scheduler()
        except Exception:  # noqa: BLE001
            log.exception("scheduler stop failed")


if __name__ == "__main__":
    asyncio.run(_run())
