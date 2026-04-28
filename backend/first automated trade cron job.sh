#!/usr/bin/env bash
# Start the backend server and the mispricing engine so it runs for tomorrow.
# Engine scans CIFR and HOOD every 5 min; only executes during market hours (9:30–16:00 ET).
# Paper trading only (Alpaca paper API). Direction (sell calls vs sell puts) is chosen by EV.

set -e
BACKEND_DIR="$(dirname "$0")"
SRC_DIR="$BACKEND_DIR/src"
cd "$BACKEND_DIR"
# Use venv if present
if [ -d "$BACKEND_DIR/.venv" ]; then
  PYTHON="$BACKEND_DIR/.venv/bin/python3"
  UVICORN="$BACKEND_DIR/.venv/bin/uvicorn"
else
  PYTHON=python3
  UVICORN="python3 -m uvicorn"
fi
# Run from backend so .env is in cwd for Alpaca keys; PYTHONPATH so api.routes resolves
export PYTHONPATH="$SRC_DIR"
BASE_URL="${BASE_URL:-http://localhost:8000}"

# Start backend in background if not already listening
if ! curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/engine/status" 2>/dev/null | grep -q 200; then
  echo "Starting backend on port 8000..."
  $UVICORN api.routes:app --host 0.0.0.0 --port 8000 &
  echo "Waiting for server to be ready..."
  for i in $(seq 1 30); do
    if curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/engine/status" 2>/dev/null | grep -q 200; then
      break
    fi
    sleep 1
  done
fi

# Start the engine
echo "Starting mispricing engine (HOOD + CIFR, paper trading)..."
RESP=$(curl -s -X POST "$BASE_URL/api/engine/start")
echo "$RESP"
if echo "$RESP" | grep -q '"status":"started"'; then
  echo "Engine started. It will scan every 5 min and execute paper orders during market hours when volatility conditions are met."
else
  echo "Engine may already be running. Check: curl $BASE_URL/api/engine/status"
fi
