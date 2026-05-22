#!/usr/bin/env bash
# Optional helper: seed NPM proxy hosts via its API.
#
# Manual UI entry (see README.md) is fine for the first bring-up. Use this
# script if you tear down NPM's data volume and want to recreate the routes
# without clicking through the GUI 27 times.
#
# Requires: curl, jq.
#
# Usage:
#   ./seed-proxy-hosts.sh admin@example.com changeme

set -euo pipefail

NPM_URL="${NPM_URL:-http://localhost:81}"
ADMIN_EMAIL="${1:-${NPM_ADMIN_EMAIL:-admin@example.com}}"
ADMIN_PASSWORD="${2:-${NPM_ADMIN_PASSWORD:-changeme}}"

echo "Logging in to NPM at $NPM_URL as $ADMIN_EMAIL"
TOKEN=$(curl -fsS -X POST "$NPM_URL/api/tokens" \
  -H "Content-Type: application/json" \
  -d "{\"identity\":\"$ADMIN_EMAIL\",\"secret\":\"$ADMIN_PASSWORD\"}" \
  | jq -r .token)

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "Failed to authenticate with NPM" >&2
  exit 1
fi

# Frontend catch-all + per-prefix locations
LOCATIONS=$(cat <<'JSON'
[
  {"path": "/api/pricing/",      "forward_scheme": "http", "forward_host": "pricing-api",   "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/mispricing/",   "forward_scheme": "http", "forward_host": "pricing-api",   "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/backtest/",     "forward_scheme": "http", "forward_host": "pricing-api",   "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/replay/",       "forward_scheme": "http", "forward_host": "pricing-api",   "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/risk/",         "forward_scheme": "http", "forward_host": "pricing-api",   "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/hedge/",        "forward_scheme": "http", "forward_host": "pricing-api",   "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/strategy/",     "forward_scheme": "http", "forward_host": "pricing-api",   "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/market/",       "forward_scheme": "http", "forward_host": "data-api",      "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/sec/",          "forward_scheme": "http", "forward_host": "data-api",      "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/etf/",          "forward_scheme": "http", "forward_host": "data-api",      "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/ir/",           "forward_scheme": "http", "forward_host": "data-api",      "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/macro-news/",   "forward_scheme": "http", "forward_host": "data-api",      "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/sentiment/",    "forward_scheme": "http", "forward_host": "data-api",      "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/scanner/",      "forward_scheme": "http", "forward_host": "data-api",      "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/flow/",         "forward_scheme": "http", "forward_host": "data-api",      "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/robinhood/",    "forward_scheme": "http", "forward_host": "portfolio-api", "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/auth/",         "forward_scheme": "http", "forward_host": "portfolio-api", "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/notifications/","forward_scheme": "http", "forward_host": "portfolio-api", "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/analytics/",    "forward_scheme": "http", "forward_host": "portfolio-api", "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/execution/",    "forward_scheme": "http", "forward_host": "portfolio-api", "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/portfolio/",    "forward_scheme": "http", "forward_host": "portfolio-api", "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/journal/",      "forward_scheme": "http", "forward_host": "portfolio-api", "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/engine/",       "forward_scheme": "http", "forward_host": "portfolio-api", "forward_port": 8080, "advanced_config": ""},
  {"path": "/ws/",               "forward_scheme": "http", "forward_host": "portfolio-api", "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/agents/",       "forward_scheme": "http", "forward_host": "llm-api",       "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/regime/",       "forward_scheme": "http", "forward_host": "llm-api",       "forward_port": 8080, "advanced_config": ""},
  {"path": "/api/signals/",      "forward_scheme": "http", "forward_host": "llm-api",       "forward_port": 8080, "advanced_config": ""}
]
JSON
)

PAYLOAD=$(jq -n --argjson locs "$LOCATIONS" '{
  domain_names: ["localhost"],
  forward_scheme: "http",
  forward_host: "frontend",
  forward_port: 8080,
  caching_enabled: false,
  block_exploits: true,
  allow_websocket_upgrade: true,
  http2_support: false,
  hsts_enabled: false,
  hsts_subdomains: false,
  ssl_forced: false,
  certificate_id: 0,
  meta: {},
  access_list_id: 0,
  advanced_config: "",
  locations: $locs
}')

echo "Creating proxy host with $(echo "$LOCATIONS" | jq length) custom locations..."
curl -fsS -X POST "$NPM_URL/api/nginx/proxy-hosts" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" | jq '{id, domain_names, forward_host, locations: (.locations | length)}'

echo "Done. Hit http://localhost to verify."
