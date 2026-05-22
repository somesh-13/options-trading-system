# VegaEdge — task runner (just). Replaces the legacy Makefile.
# https://github.com/casey/just
#
# Usage:
#   just                 # list recipes
#   just up              # start docker stack
#   just logs-service data-api
#   just migrate

set shell := ["bash", "-uc"]
set positional-arguments

# --- Local-dev paths ---------------------------------------------------------
project_dir := justfile_directory()
backend_dir := project_dir / "backend"
log_dir     := project_dir / ".run"
fe_port     := "3000"
be_port     := "8000"
fe_pid      := log_dir / "frontend.pid"
be_pid      := log_dir / "backend.pid"
fe_log      := log_dir / "frontend.log"
be_log      := log_dir / "backend.log"

# --- ngrok -------------------------------------------------------------------
ngrok_bin    := env_var_or_default("NGROK_BIN", env_var("HOME") + "/.local/bin/ngrok")
ngrok_tunnel := env_var_or_default("NGROK_TUNNEL", "dashboard")
ngrok_api    := "http://127.0.0.1:4040/api/tunnels"
ngrok_log    := log_dir / "ngrok.log"
ngrok_pid    := log_dir / "ngrok.pid"

# Default recipe — prints the available commands.
default:
    @just --list --unsorted

# ----------------------------------------------------------------------------
# Local dev (frontend + backend on the host, no Docker)
# ----------------------------------------------------------------------------

[group('local')]
[doc('Start frontend + backend (host processes, no Docker)')]
start: start-be start-fe

[group('local')]
[doc('Stop frontend + backend')]
stop:
    @bash -c 'trap "" HUP TERM INT; \
        echo "stopping frontend (:{{fe_port}})"; \
        [ -f {{fe_pid}} ] && { kill -- -$(cat {{fe_pid}}) 2>/dev/null; kill $(cat {{fe_pid}}) 2>/dev/null; rm -f {{fe_pid}}; } || true; \
        fuser -k -TERM {{fe_port}}/tcp >/dev/null 2>&1; sleep 1; fuser -k -KILL {{fe_port}}/tcp >/dev/null 2>&1; true; \
        pkill -f "next dev.*-p {{fe_port}}" 2>/dev/null; true; \
        echo "stopping backend (:{{be_port}})"; \
        [ -f {{be_pid}} ] && { kill -- -$(cat {{be_pid}}) 2>/dev/null; kill $(cat {{be_pid}}) 2>/dev/null; rm -f {{be_pid}}; } || true; \
        fuser -k -TERM {{be_port}}/tcp >/dev/null 2>&1; sleep 1; fuser -k -KILL {{be_port}}/tcp >/dev/null 2>&1; true; \
        pkill -f "uvicorn.*--port {{be_port}}" 2>/dev/null; true; \
        exit 0'

[group('local')]
[doc('Restart frontend + backend')]
restart: stop start

[group('local')]
[doc('Start frontend only')]
start-fe:
    @mkdir -p {{log_dir}}
    @if fuser {{fe_port}}/tcp >/dev/null 2>&1; then \
        echo "frontend already running on :{{fe_port}} (pid$(fuser {{fe_port}}/tcp 2>/dev/null))"; \
    else \
        echo "starting frontend on :{{fe_port}} -> {{fe_log}}"; \
        cd {{project_dir}} && ( setsid --fork bash -c 'exec npm run dev' </dev/null >{{fe_log}} 2>&1 & ); \
        sleep 1; fuser {{fe_port}}/tcp 2>/dev/null | awk '{print $1}' >{{fe_pid}} || true; \
    fi

[group('local')]
[doc('Start backend only')]
start-be:
    @mkdir -p {{log_dir}}
    @if fuser {{be_port}}/tcp >/dev/null 2>&1; then \
        echo "backend already running on :{{be_port}} (pid$(fuser {{be_port}}/tcp 2>/dev/null))"; \
    else \
        echo "starting backend on :{{be_port}} -> {{be_log}}"; \
        cd {{backend_dir}} && ( setsid --fork bash -c 'source venv/bin/activate && exec uvicorn src.api.routes:app --host :: --port {{be_port}} --reload' </dev/null >{{be_log}} 2>&1 & ); \
        sleep 2; fuser {{be_port}}/tcp 2>/dev/null | awk '{print $1}' >{{be_pid}} || true; \
    fi

[group('local')]
[doc('Stop frontend only')]
stop-fe:
    @bash -c 'trap "" HUP TERM INT; \
        echo "stopping frontend (:{{fe_port}})"; \
        [ -f {{fe_pid}} ] && { kill -- -$(cat {{fe_pid}}) 2>/dev/null; kill $(cat {{fe_pid}}) 2>/dev/null; rm -f {{fe_pid}}; } || true; \
        fuser -k -TERM {{fe_port}}/tcp >/dev/null 2>&1; sleep 1; fuser -k -KILL {{fe_port}}/tcp >/dev/null 2>&1; true; \
        pkill -f "next dev.*-p {{fe_port}}" 2>/dev/null; true; \
        exit 0'

[group('local')]
[doc('Stop backend only')]
stop-be:
    @bash -c 'trap "" HUP TERM INT; \
        echo "stopping backend (:{{be_port}})"; \
        [ -f {{be_pid}} ] && { kill -- -$(cat {{be_pid}}) 2>/dev/null; kill $(cat {{be_pid}}) 2>/dev/null; rm -f {{be_pid}}; } || true; \
        fuser -k -TERM {{be_port}}/tcp >/dev/null 2>&1; sleep 1; fuser -k -KILL {{be_port}}/tcp >/dev/null 2>&1; true; \
        pkill -f "uvicorn.*--port {{be_port}}" 2>/dev/null; true; \
        exit 0'

[group('local')]
[doc('Restart frontend only')]
restart-fe: stop-fe start-fe

[group('local')]
[doc('Restart backend only')]
restart-be: stop-be start-be

[group('local')]
[doc('Show running status of host processes')]
status:
    @printf "frontend :{{fe_port}}  "; p=$(fuser {{fe_port}}/tcp 2>/dev/null); [ -n "$p" ] && echo "UP (pid$p)" || echo "down"
    @printf "backend  :{{be_port}}  "; p=$(fuser {{be_port}}/tcp 2>/dev/null); [ -n "$p" ] && echo "UP (pid$p)" || echo "down"

[group('local')]
[doc('Tail both logs')]
logs:
    @tail -n 50 -f {{fe_log}} {{be_log}}

[group('local')]
[doc('Tail frontend log')]
logs-fe:
    @tail -n 100 -f {{fe_log}}

[group('local')]
[doc('Tail backend log')]
logs-be:
    @tail -n 100 -f {{be_log}}

# ----------------------------------------------------------------------------
# ngrok
# ----------------------------------------------------------------------------

[group('ngrok')]
[doc('Start ngrok tunnel')]
start-ngrok:
    @mkdir -p {{log_dir}}
    @if curl -sf {{ngrok_api}} >/dev/null 2>&1; then \
        echo "ngrok already running (agent API on :4040)"; \
    else \
        [ -x {{ngrok_bin}} ] || { echo "ngrok binary not found at {{ngrok_bin}}"; exit 1; }; \
        echo "starting ngrok tunnel '{{ngrok_tunnel}}' -> {{ngrok_log}}"; \
        ( setsid --fork bash -c 'exec {{ngrok_bin}} start {{ngrok_tunnel}} --log=stdout --log-format=json' </dev/null >{{ngrok_log}} 2>&1 & ); \
        for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; curl -sf {{ngrok_api}} >/dev/null 2>&1 && break; done; \
        pgrep -f "{{ngrok_bin}} start" | head -1 >{{ngrok_pid}} || true; \
    fi

[group('ngrok')]
[doc('Stop ngrok')]
stop-ngrok:
    @echo "stopping ngrok"; pkill -f "{{ngrok_bin}} start" 2>/dev/null; rm -f {{ngrok_pid}}; true

[group('ngrok')]
[doc('Restart ngrok')]
restart-ngrok: stop-ngrok start-ngrok

[group('ngrok')]
[doc('Print current public ngrok URL')]
url:
    @curl -sf {{ngrok_api}} 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); urls=[t['public_url'] for t in d['tunnels'] if t['name']=='{{ngrok_tunnel}}']; print(urls[0] if urls else '')" 2>/dev/null | grep . || { echo "ngrok not running — run 'just start-ngrok'"; exit 1; }

[group('ngrok')]
[doc('Probe the public URL end-to-end')]
check-live:
    @U=$(curl -sf {{ngrok_api}} 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); urls=[t['public_url'] for t in d['tunnels'] if t['name']=='{{ngrok_tunnel}}']; print(urls[0] if urls else '')" 2>/dev/null); \
    [ -z "$U" ] && { echo "ngrok not running — run 'just start-ngrok'"; exit 1; }; \
    echo "Public URL: $U"; \
    printf "  frontend  GET /                       ... "; curl -s -o /dev/null -w "HTTP %{http_code}\n" -H "ngrok-skip-browser-warning: 1" "$U/"; \
    printf "  backend   GET /api/market/cifr/price  ... "; curl -s -o /dev/null -w "HTTP %{http_code}\n" -H "ngrok-skip-browser-warning: 1" "$U/api/market/cifr/price"

[group('ngrok')]
[doc('Restart services + ngrok and verify live URL')]
release: restart-be restart-fe start-ngrok
    @echo ""; echo "waiting for services to settle..."; sleep 3
    @just check-live
    @echo ""; echo "Release done. Public URL:"; just url

# ----------------------------------------------------------------------------
# Docker compose stack — NPM + frontend + 5 backend services + Postgres/Mongo/Redis
# ----------------------------------------------------------------------------

[group('docker')]
[doc('Build images (if needed) + start the full Docker stack')]
up:
    docker compose --env-file .env.docker up -d
    @echo ""
    @echo "Stack is starting. Containers:"
    @docker compose ps
    @echo ""
    @echo "NPM admin UI: http://localhost:81 (default: admin@example.com / changeme)"
    @echo "App:          http://localhost"

[group('docker')]
[doc('Stop the Docker stack')]
down:
    docker compose down

[group('docker')]
[doc('Show container status')]
ps:
    docker compose ps

[group('docker')]
[doc('Build frontend + backend images')]
build-images:
    docker compose build

[group('docker')]
[doc('Tail logs for one container — e.g. `just logs-service data-api`')]
logs-service service:
    docker compose logs -f --tail=200 {{service}}

[group('docker')]
[doc('One-shot SQLite -> Postgres/Mongo cutover')]
migrate:
    @test -f backend/trades.db || { echo "backend/trades.db missing — nothing to migrate"; exit 1; }
    docker compose run --rm \
        -v {{project_dir}}/backend/trades.db:/legacy/trades.db:ro \
        -v {{project_dir}}/backend/.cache:/legacy/.cache:ro \
        portfolio-api \
        python -m scripts.migrate_sqlite_to_stores \
            --sqlite /legacy/trades.db \
            --cache  /legacy/.cache

[group('docker')]
[doc('Open psql shell against the Postgres container')]
psql:
    docker compose exec postgres psql -U vegaedge -d vegaedge

[group('docker')]
[doc('Open mongosh shell against the Mongo container')]
mongo:
    docker compose exec mongo mongosh -u vegaedge -p vegaedge_dev_pw --authenticationDatabase admin vegaedge

[group('docker')]
[doc('Open redis-cli against the Redis container')]
redis-cli:
    docker compose exec redis redis-cli

[group('docker')]
[doc('Per-service /health probe through NPM')]
health:
    @echo "--- container status ---"; docker compose ps --format "table {{{{.Service}}\t{{{{.Status}}"
    @echo ""; echo "--- per-service /health (via NPM on :80, requires proxy hosts configured) ---"
    @for svc in pricing data market robinhood agents; do \
        printf "  GET /api/%-10s/health ... " "$svc"; \
        curl -s -o /tmp/h.json -w "HTTP %{http_code}\n" "http://localhost/api/$svc/health" || true; \
    done
