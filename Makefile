PROJECT_DIR := $(CURDIR)
BACKEND_DIR := $(PROJECT_DIR)/backend
LOG_DIR     := $(PROJECT_DIR)/.run
FE_PORT     := 3000
BE_PORT     := 8000
FE_PID      := $(LOG_DIR)/frontend.pid
BE_PID      := $(LOG_DIR)/backend.pid
FE_LOG      := $(LOG_DIR)/frontend.log
BE_LOG      := $(LOG_DIR)/backend.log

NGROK_BIN    ?= $(HOME)/.local/bin/ngrok
NGROK_TUNNEL ?= dashboard
NGROK_API    := http://127.0.0.1:4040/api/tunnels
NGROK_LOG    := $(LOG_DIR)/ngrok.log
NGROK_PID    := $(LOG_DIR)/ngrok.pid

.PHONY: help start stop restart start-fe stop-fe restart-fe start-be stop-be restart-be status logs logs-fe logs-be \
        start-ngrok stop-ngrok restart-ngrok url check-live release

help:
	@echo "Targets:"
	@echo "  make start          Start frontend + backend"
	@echo "  make stop           Stop frontend + backend"
	@echo "  make restart        Restart frontend + backend"
	@echo "  make start-fe       Start frontend only"
	@echo "  make start-be       Start backend only"
	@echo "  make stop-fe        Stop frontend only"
	@echo "  make stop-be        Stop backend only"
	@echo "  make restart-fe     Restart frontend only"
	@echo "  make restart-be     Restart backend only"
	@echo "  make status         Show running status"
	@echo "  make logs           Tail both logs"
	@echo "  make logs-fe        Tail frontend log"
	@echo "  make logs-be        Tail backend log"
	@echo "  make start-ngrok    Start ngrok tunnel ($(NGROK_TUNNEL))"
	@echo "  make stop-ngrok     Stop ngrok"
	@echo "  make restart-ngrok  Restart ngrok"
	@echo "  make url            Print current public ngrok URL"
	@echo "  make check-live     Probe the public URL end-to-end"
	@echo "  make release        Restart services + ngrok and verify live URL"

$(LOG_DIR):
	@mkdir -p $(LOG_DIR)

start: start-be start-fe

stop:
	@bash -c 'trap "" HUP TERM INT; \
		echo "stopping frontend (:$(FE_PORT))"; \
		[ -f $(FE_PID) ] && { kill -- -$$(cat $(FE_PID)) 2>/dev/null; kill $$(cat $(FE_PID)) 2>/dev/null; rm -f $(FE_PID); } || true; \
		fuser -k -TERM $(FE_PORT)/tcp >/dev/null 2>&1; sleep 1; fuser -k -KILL $(FE_PORT)/tcp >/dev/null 2>&1; true; \
		pkill -f "next dev.*-p $(FE_PORT)" 2>/dev/null; true; \
		echo "stopping backend (:$(BE_PORT))"; \
		[ -f $(BE_PID) ] && { kill -- -$$(cat $(BE_PID)) 2>/dev/null; kill $$(cat $(BE_PID)) 2>/dev/null; rm -f $(BE_PID); } || true; \
		fuser -k -TERM $(BE_PORT)/tcp >/dev/null 2>&1; sleep 1; fuser -k -KILL $(BE_PORT)/tcp >/dev/null 2>&1; true; \
		pkill -f "uvicorn.*--port $(BE_PORT)" 2>/dev/null; true; \
		exit 0'

restart: stop start

start-fe: | $(LOG_DIR)
	@if fuser $(FE_PORT)/tcp >/dev/null 2>&1; then \
		echo "frontend already running on :$(FE_PORT) (pid$$(fuser $(FE_PORT)/tcp 2>/dev/null))"; \
	else \
		echo "starting frontend on :$(FE_PORT) -> $(FE_LOG)"; \
		cd $(PROJECT_DIR) && ( setsid --fork bash -c 'exec npm run dev' </dev/null >$(FE_LOG) 2>&1 & ); \
		sleep 1; fuser $(FE_PORT)/tcp 2>/dev/null | awk '{print $$1}' >$(FE_PID) || true; \
	fi

start-be: | $(LOG_DIR)
	@if fuser $(BE_PORT)/tcp >/dev/null 2>&1; then \
		echo "backend already running on :$(BE_PORT) (pid$$(fuser $(BE_PORT)/tcp 2>/dev/null))"; \
	else \
		echo "starting backend on :$(BE_PORT) -> $(BE_LOG)"; \
		cd $(BACKEND_DIR) && ( setsid --fork bash -c 'source venv/bin/activate && exec uvicorn src.api.routes:app --host :: --port $(BE_PORT) --reload' </dev/null >$(BE_LOG) 2>&1 & ); \
		sleep 2; fuser $(BE_PORT)/tcp 2>/dev/null | awk '{print $$1}' >$(BE_PID) || true; \
	fi

stop-fe:
	@bash -c 'trap "" HUP TERM INT; \
		echo "stopping frontend (:$(FE_PORT))"; \
		[ -f $(FE_PID) ] && { kill -- -$$(cat $(FE_PID)) 2>/dev/null; kill $$(cat $(FE_PID)) 2>/dev/null; rm -f $(FE_PID); } || true; \
		fuser -k -TERM $(FE_PORT)/tcp >/dev/null 2>&1; sleep 1; fuser -k -KILL $(FE_PORT)/tcp >/dev/null 2>&1; true; \
		pkill -f "next dev.*-p $(FE_PORT)" 2>/dev/null; true; \
		exit 0'

stop-be:
	@bash -c 'trap "" HUP TERM INT; \
		echo "stopping backend (:$(BE_PORT))"; \
		[ -f $(BE_PID) ] && { kill -- -$$(cat $(BE_PID)) 2>/dev/null; kill $$(cat $(BE_PID)) 2>/dev/null; rm -f $(BE_PID); } || true; \
		fuser -k -TERM $(BE_PORT)/tcp >/dev/null 2>&1; sleep 1; fuser -k -KILL $(BE_PORT)/tcp >/dev/null 2>&1; true; \
		pkill -f "uvicorn.*--port $(BE_PORT)" 2>/dev/null; true; \
		exit 0'

restart-fe: stop-fe start-fe

restart-be: stop-be start-be

status:
	@printf "frontend :$(FE_PORT)  "; p=$$(fuser $(FE_PORT)/tcp 2>/dev/null); [ -n "$$p" ] && echo "UP (pid$$p)" || echo "down"
	@printf "backend  :$(BE_PORT)  "; p=$$(fuser $(BE_PORT)/tcp 2>/dev/null); [ -n "$$p" ] && echo "UP (pid$$p)" || echo "down"

logs:
	@tail -n 50 -f $(FE_LOG) $(BE_LOG)

logs-fe:
	@tail -n 100 -f $(FE_LOG)

logs-be:
	@tail -n 100 -f $(BE_LOG)

start-ngrok: | $(LOG_DIR)
	@if curl -sf $(NGROK_API) >/dev/null 2>&1; then \
		echo "ngrok already running (agent API on :4040)"; \
	else \
		[ -x $(NGROK_BIN) ] || { echo "ngrok binary not found at $(NGROK_BIN)"; exit 1; }; \
		echo "starting ngrok tunnel '$(NGROK_TUNNEL)' -> $(NGROK_LOG)"; \
		( setsid --fork bash -c 'exec $(NGROK_BIN) start $(NGROK_TUNNEL) --log=stdout --log-format=json' </dev/null >$(NGROK_LOG) 2>&1 & ); \
		for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; curl -sf $(NGROK_API) >/dev/null 2>&1 && break; done; \
		pgrep -f "$(NGROK_BIN) start" | head -1 >$(NGROK_PID) || true; \
	fi

stop-ngrok:
	@echo "stopping ngrok"; pkill -f "$(NGROK_BIN) start" 2>/dev/null; rm -f $(NGROK_PID); true

restart-ngrok: stop-ngrok start-ngrok

url:
	@curl -sf $(NGROK_API) 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); urls=[t['public_url'] for t in d['tunnels'] if t['name']=='$(NGROK_TUNNEL)']; print(urls[0] if urls else '')" 2>/dev/null | grep . || { echo "ngrok not running — run 'make start-ngrok'"; exit 1; }

check-live:
	@U=$$(curl -sf $(NGROK_API) 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); urls=[t['public_url'] for t in d['tunnels'] if t['name']=='$(NGROK_TUNNEL)']; print(urls[0] if urls else '')" 2>/dev/null); \
	[ -z "$$U" ] && { echo "ngrok not running — run 'make start-ngrok'"; exit 1; }; \
	echo "Public URL: $$U"; \
	printf "  frontend  GET /                       ... "; curl -s -o /dev/null -w "HTTP %{http_code}\n" -H "ngrok-skip-browser-warning: 1" "$$U/"; \
	printf "  backend   GET /api/market/cifr/price  ... "; curl -s -o /dev/null -w "HTTP %{http_code}\n" -H "ngrok-skip-browser-warning: 1" "$$U/api/market/cifr/price"

release: restart-be restart-fe start-ngrok
	@echo ""; echo "waiting for services to settle..."; sleep 3
	@$(MAKE) -s check-live
	@echo ""; echo "Release done. Public URL:"; $(MAKE) -s url
