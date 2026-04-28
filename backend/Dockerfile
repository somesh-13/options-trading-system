# VegaEdge Live Agent + Options Pricing API (Cloud Run)
# Multi-stage build — roadmap §11.2 targets <500MB runtime image.

# -----------------------------------------------------------------------------
# Builder: install wheels into a virtual env we can copy forward.
# -----------------------------------------------------------------------------
FROM python:3.11-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

# Install build toolchain only when needed for scientific wheels; strip after.
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc g++ \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /venv
ENV PATH="/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --upgrade pip \
    && pip install -r requirements.txt

# -----------------------------------------------------------------------------
# Runtime: minimal image, only the venv + source.
# -----------------------------------------------------------------------------
FROM python:3.11-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app/src \
    PATH="/venv/bin:$PATH"

WORKDIR /app

# curl is only needed for the healthcheck; omit if your orchestrator
# probes via an HTTP client other than curl.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /venv /venv
COPY src/ ./src/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8080/health || exit 1

CMD ["uvicorn", "api.routes:app", "--host", "0.0.0.0", "--port", "8080"]
