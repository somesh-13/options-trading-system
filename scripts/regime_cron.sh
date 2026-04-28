#!/usr/bin/env bash
# VegaEdge regime poller — cron-facing driver for GET /api/regime/{ticker}.
#
# Sample crontab line (every 15 min during US market hours, Mon-Fri):
#   */15 9-16 * * 1-5  /home/jarvis/tst/trading-dashboard-app/scripts/regime_cron.sh
#
# Env overrides:
#   VEGAEDGE_API         base URL for FastAPI backend     (default: http://localhost:8000)
#   VEGAEDGE_TICKERS     space-separated watchlist        (default: "CIFR HOOD MSTR")
#   VEGAEDGE_REGIME_LOG  append target for JSON lines     (default: $HOME/vegaedge-regime-log.jsonl)
#
# Output: one JSON line per ticker per poll, with a `polled_at` ISO-8601 field
# injected. On HTTP failure, an error sentinel line is logged so a downstream
# consumer can still detect liveness.

set -euo pipefail

API="${VEGAEDGE_API:-http://localhost:8000}"
TICKERS="${VEGAEDGE_TICKERS:-CIFR HOOD MSTR}"
LOG="${VEGAEDGE_REGIME_LOG:-$HOME/vegaedge-regime-log.jsonl}"

ts="$(date -Iseconds)"

for t in $TICKERS; do
  if ! curl -fsS --max-time 30 "$API/api/regime/$t" \
      | jq -c --arg ts "$ts" '. + {polled_at: $ts}' \
      >> "$LOG"; then
    printf '{"polled_at":"%s","ticker":"%s","error":true}\n' "$ts" "$t" >> "$LOG"
  fi
done
