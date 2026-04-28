"""Path-restricted reverse proxy for the public ngrok tunnel.

Forwards ONLY `GET /api/regime/{ticker}` (and `GET /` health) to the
private FastAPI backend on 127.0.0.1:8000. Trading / portfolio / agent
routes on the backend stay unreachable from the tunnel.

Run:
    venv/bin/uvicorn scripts.regime_public_proxy:app --host 127.0.0.1 --port 8001
Then:
    ngrok http 8001
"""

from __future__ import annotations

import os
import re

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, PlainTextResponse

UPSTREAM = os.environ.get("VEGAEDGE_UPSTREAM", "http://127.0.0.1:8000")
TICKER_RE = re.compile(r"^[A-Za-z][A-Za-z0-9.\-]{0,9}$")

app = FastAPI(
    title="VegaEdge Regime Proxy",
    description="Public-facing read-only proxy. Only GET /api/regime/{ticker} is exposed.",
)

_client = httpx.AsyncClient(base_url=UPSTREAM, timeout=60.0)


@app.get("/", response_class=PlainTextResponse)
async def root() -> str:
    return "VegaEdge regime proxy. Try /api/regime/CIFR"


@app.get("/api/regime/{ticker}")
async def regime(ticker: str, request: Request) -> JSONResponse:
    if not TICKER_RE.match(ticker):
        raise HTTPException(status_code=400, detail="Invalid ticker")
    if request.method != "GET":
        raise HTTPException(status_code=405, detail="Method not allowed")
    try:
        upstream = await _client.get(f"/api/regime/{ticker.upper()}")
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Upstream unreachable: {exc}")
    return JSONResponse(status_code=upstream.status_code, content=upstream.json())


@app.on_event("shutdown")
async def _close() -> None:
    await _client.aclose()
