# VegaEdge Python backend — single image, used by 5 containers:
#   pricing-api, data-api, portfolio-api, llm-api, engine-worker
# Container-specific behavior is driven by SERVICE_NAME + CMD override in
# docker-compose.yml. See backend/src/api/entry.py for the route filter.

# -----------------------------------------------------------------------------
# Builder — install wheels into a virtualenv we copy forward.
# -----------------------------------------------------------------------------
FROM python:3.11-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc g++ libpq-dev \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /venv
ENV PATH="/venv/bin:$PATH"

COPY requirements.txt .
RUN pip install --upgrade pip \
    && pip install -r requirements.txt

# -----------------------------------------------------------------------------
# Runtime — minimal image, only venv + source.
# -----------------------------------------------------------------------------
FROM python:3.11-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app/src \
    PATH="/venv/bin:$PATH"

WORKDIR /app

# curl: healthcheck. libpq5: psycopg runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /venv /venv
COPY src/ ./src/
COPY scripts/ ./scripts/

EXPOSE 8080

# Default CMD targets the route-filtered FastAPI entrypoint.
# engine-worker overrides this via docker-compose.yml.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS http://localhost:8080/health || exit 1

CMD ["uvicorn", "api.entry:app", "--host", "0.0.0.0", "--port", "8080"]
