.PHONY: help up down logs rebuild build mcp-list rpc clean-orphans db-shell db-tables clean \
        build-listener ensure-schema webhook-up webhook-down webhook-logs smee-forward watch-signals process-signals \
        scheduler-up scheduler-down scheduler-status

help:
	@echo "Targets:"
	@echo "  up              start dozzle log viewer (MCPs spawn on demand via claude)"
	@echo "  down            stop all containers"
	@echo "  logs            open dozzle in browser (http://localhost:8080)"
	@echo "  build           build scheduler-state image"
	@echo "  rebuild         rebuild scheduler-state image with --no-cache"
	@echo "  mcp-list        run 'claude mcp list' from repo root"
	@echo "  rpc             one-shot JSON-RPC against an MCP service (SVC=name FILE=path)"
	@echo "  clean-orphans   remove leaked *-run-* containers from compose run invocations"
	@echo "  db-shell        open sqlite3 against data/scheduler.db"
	@echo "  db-tables       show tables in data/scheduler.db"
	@echo "  clean           stop containers and remove SQLite db"
	@echo ""
	@echo "Webhook (DUS-9):"
	@echo "  build-listener  build linear-webhook-listener image"
	@echo "  webhook-up      start listener on :3000 (requires LINEAR_WEBHOOK_SECRET in .env)"
	@echo "  webhook-down    stop listener"
	@echo "  webhook-logs    tail listener logs"
	@echo "  smee-forward    run smee-client to forward SMEE_URL → localhost:3000"
	@echo "  watch-signals   host loop: drains /process-signals every 30s (single-process)"
	@echo "  process-signals run /process-signals once (headless, --dangerously-skip-permissions)"
	@echo ""
	@echo "Scheduler lifecycle (DUS-9):"
	@echo "  scheduler-up    start listener + smee forwarder + watch loop (detached)"
	@echo "  scheduler-down  stop everything cleanly + sweep orphans"
	@echo "  scheduler-status  show running components and recent log lines"

up:
	docker compose up -d dozzle

down:
	docker compose down

logs:
	@echo "Dozzle: http://localhost:8080"
	@open http://localhost:8080 2>/dev/null || true

build:
	docker compose build scheduler-state

rebuild:
	docker compose build --no-cache scheduler-state

mcp-list:
	claude mcp list

# One-shot JSON-RPC against an MCP service. Pipes FILE into the named
# service's stdin under a SIGALRM watchdog. After RPC_TIMEOUT seconds
# the docker CLI is killed (SIGALRM's default disposition is terminate);
# the daemon notices the gone-away client and `--rm` cleans up the
# container — even if the upstream image doesn't exit on stdin EOF
# (e.g. third-party MCPs we can't patch). Usage:
#   make rpc SVC=scheduler-state FILE=/tmp/rpc.txt
#
# We use a perl one-liner (`alarm` + `exec`) instead of GNU coreutils
# `timeout` because `timeout` is not on macOS by default and we don't
# want to require `brew install coreutils` for a hackathon.
SVC ?= scheduler-state
FILE ?= /tmp/rpc.txt
RPC_TIMEOUT ?= 5
rpc:
	@test -f $(FILE) || (echo "FILE=$(FILE) not found" && exit 1)
	perl -e 'alarm shift; exec @ARGV or die $$!' $(RPC_TIMEOUT) docker compose run --rm -T $(SVC) < $(FILE)

# Sweep any *-run-* containers left behind by `docker compose run --rm`
# invocations whose upstream image doesn't exit on stdin EOF. See DUS-12.
clean-orphans:
	@docker ps -aq --filter "name=linear-auto-scheduler-.*-run-" | xargs -r docker rm -f

db-shell:
	sqlite3 data/scheduler.db

db-tables:
	sqlite3 data/scheduler.db ".tables"

clean:
	docker compose down -v
	rm -f data/scheduler.db data/scheduler.db-wal data/scheduler.db-shm

# ---- Webhook stack (DUS-9) -----------------------------------------------
# The listener runs under the `webhook` compose profile so default `make up`
# doesn't require LINEAR_WEBHOOK_SECRET. The listener writes signals directly
# to the shared SQLite volume; /process-signals (host) drains them.

build-listener:
	docker compose --profile webhook build linear-webhook-listener

# Schema lives inside the scheduler-state image (Dockerfile copies schema.sql
# into /app/dist/). On a fresh checkout the listener would crash on the first
# POST with `no such table: signals` because the listener does direct SQLite
# writes and never applies schema itself. This target runs scheduler-state
# once with the bare initialize handshake — that fires the boot path which
# applies schema idempotently.
ensure-schema:
	@if [ ! -f data/scheduler.db ] || ! sqlite3 data/scheduler.db ".tables" 2>/dev/null | grep -q signals; then \
		echo "[ensure-schema] seeding scheduler.db schema via scheduler-state boot..."; \
		printf '%s\n%s\n' \
			'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","clientInfo":{"name":"init","version":"0"},"capabilities":{}}}' \
			'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
		| perl -e 'alarm 5; exec @ARGV or die $$!' docker compose run --rm -T scheduler-state >/dev/null 2>&1; \
		sqlite3 data/scheduler.db ".tables" 2>/dev/null | grep -q signals || \
			(echo "ERROR: ensure-schema did not create the signals table." && \
			 echo "       Is the scheduler-state image built? Try: make build" && \
			 exit 1); \
	fi

webhook-up: ensure-schema
	@grep -q "^LINEAR_WEBHOOK_SECRET=." .env 2>/dev/null || \
		(echo "ERROR: LINEAR_WEBHOOK_SECRET unset in .env" && exit 1)
	docker compose --profile webhook up -d linear-webhook-listener
	@echo "Listener: http://localhost:3000 (POST /webhooks/linear, GET /health)"

webhook-down:
	docker compose --profile webhook stop linear-webhook-listener
	docker compose --profile webhook rm -f linear-webhook-listener

webhook-logs:
	docker compose --profile webhook logs -f linear-webhook-listener

# Smee channel URL lives in .env as SMEE_URL. We forward to the listener's
# local /webhooks/linear endpoint so HMAC verification still happens here.
# Logic lives in scripts/smee-forward.sh so scheduler-up can detach the
# same code path without re-implementing it.
smee-forward:
	@bash scripts/smee-forward.sh

# Single drain pass via headless claude. The --dangerously-skip-permissions
# flag is the calendar-safety carve-out the user signed off on for DUS-9.
process-signals:
	claude -p '/process-signals' --dangerously-skip-permissions

# Polling drain. Single-process serial loop — running two `make watch-signals`
# at once will race the calendar; don't. The mkdir-based lock below is a
# best-effort guard that's portable across macOS (no `flock` by default) and
# Linux. If a previous run crashed without releasing the lock, recover with:
#   rmdir /tmp/lin-sched-watch.lock
WATCH_INTERVAL ?= 30
WATCH_LOCK ?= /tmp/lin-sched-watch.lock
watch-signals:
	@WATCH_INTERVAL=$(WATCH_INTERVAL) WATCH_LOCK=$(WATCH_LOCK) bash scripts/watch-signals.sh

# ---- Scheduler lifecycle (DUS-9) -----------------------------------------
# scheduler-up brings up everything needed for webhook-driven auto-scheduling
# and detaches the long-running host processes so the user gets one shell
# back. scheduler-down stops them cleanly and sweeps orphans.

SMEE_PID ?= /tmp/lin-sched-smee.pid
SMEE_LOG ?= /tmp/lin-sched-smee.log
WATCH_PID ?= /tmp/lin-sched-watch.pid
WATCH_LOG ?= /tmp/lin-sched-watch.log

scheduler-up: ensure-schema
	@grep -q "^LINEAR_WEBHOOK_SECRET=." .env 2>/dev/null || \
		(echo "ERROR: LINEAR_WEBHOOK_SECRET unset in .env" && exit 1)
	@grep -q "^SMEE_URL=." .env 2>/dev/null || \
		(echo "ERROR: SMEE_URL unset in .env" && exit 1)
	@docker compose --profile webhook up -d linear-webhook-listener >/dev/null
	@echo "[scheduler-up] listener: http://localhost:3000"
	@if [ -f $(SMEE_PID) ] && kill -0 $$(cat $(SMEE_PID)) 2>/dev/null; then \
		echo "[scheduler-up] smee-forward already running (pid $$(cat $(SMEE_PID)))"; \
	else \
		rm -f $(SMEE_PID); \
		nohup bash scripts/smee-forward.sh > $(SMEE_LOG) 2>&1 & \
		echo $$! > $(SMEE_PID); \
		sleep 1; \
		if kill -0 $$(cat $(SMEE_PID)) 2>/dev/null; then \
			echo "[scheduler-up] smee-forward started (pid $$(cat $(SMEE_PID)), log $(SMEE_LOG))"; \
		else \
			echo "ERROR: smee-forward failed to start. Check $(SMEE_LOG)"; \
			rm -f $(SMEE_PID); \
			exit 1; \
		fi; \
	fi
	@if [ -f $(WATCH_PID) ] && kill -0 $$(cat $(WATCH_PID)) 2>/dev/null; then \
		echo "[scheduler-up] watch-signals already running (pid $$(cat $(WATCH_PID)))"; \
	else \
		rm -f $(WATCH_PID); \
		rmdir $(WATCH_LOCK) 2>/dev/null || true; \
		nohup bash scripts/watch-signals.sh > $(WATCH_LOG) 2>&1 & \
		echo $$! > $(WATCH_PID); \
		sleep 1; \
		if kill -0 $$(cat $(WATCH_PID)) 2>/dev/null; then \
			echo "[scheduler-up] watch-signals started (pid $$(cat $(WATCH_PID)), log $(WATCH_LOG))"; \
		else \
			echo "ERROR: watch-signals failed to start. Check $(WATCH_LOG)"; \
			rm -f $(WATCH_PID); \
			exit 1; \
		fi; \
	fi
	@echo ""
	@echo "Pipeline up. Tail logs with:"
	@echo "  tail -f $(SMEE_LOG)    # smee forwarder"
	@echo "  tail -f $(WATCH_LOG)   # drain loop"
	@echo "  make webhook-logs      # listener container"
	@echo "Stop with: make scheduler-down"

scheduler-down:
	@if [ -f $(WATCH_PID) ]; then \
		PID=$$(cat $(WATCH_PID)); \
		if kill -0 $$PID 2>/dev/null; then \
			kill -TERM $$PID 2>/dev/null || true; \
			sleep 1; \
			kill -KILL $$PID 2>/dev/null || true; \
			echo "[scheduler-down] watch-signals stopped (pid $$PID)"; \
		else \
			echo "[scheduler-down] watch-signals not running (stale pid file)"; \
		fi; \
		rm -f $(WATCH_PID); \
	else \
		echo "[scheduler-down] watch-signals: no pid file"; \
	fi
	@rmdir $(WATCH_LOCK) 2>/dev/null || true
	@if [ -f $(SMEE_PID) ]; then \
		PID=$$(cat $(SMEE_PID)); \
		if kill -0 $$PID 2>/dev/null; then \
			kill -TERM $$PID 2>/dev/null || true; \
			sleep 1; \
			kill -KILL $$PID 2>/dev/null || true; \
			pkill -P $$PID 2>/dev/null || true; \
			echo "[scheduler-down] smee-forward stopped (pid $$PID)"; \
		else \
			echo "[scheduler-down] smee-forward not running (stale pid file)"; \
		fi; \
		rm -f $(SMEE_PID); \
	else \
		echo "[scheduler-down] smee-forward: no pid file"; \
	fi
	@docker compose --profile webhook stop linear-webhook-listener 2>/dev/null || true
	@docker compose --profile webhook rm -f linear-webhook-listener 2>/dev/null || true
	@echo "[scheduler-down] listener stopped"
	@docker ps -aq --filter "name=linear-auto-scheduler-.*-run-" 2>/dev/null | xargs -r docker rm -f 2>/dev/null || true
	@echo "[scheduler-down] orphans swept"
	@echo "[scheduler-down] done"

scheduler-status:
	@echo "=== Listener ==="
	@docker ps --filter "name=linear-auto-scheduler-linear-webhook-listener" --format "{{.Names}} {{.Status}}" || true
	@echo "=== Smee forwarder ==="
	@if [ -f $(SMEE_PID) ] && kill -0 $$(cat $(SMEE_PID)) 2>/dev/null; then \
		echo "running (pid $$(cat $(SMEE_PID)), log $(SMEE_LOG))"; \
	else \
		echo "not running"; \
	fi
	@echo "=== Watch loop ==="
	@if [ -f $(WATCH_PID) ] && kill -0 $$(cat $(WATCH_PID)) 2>/dev/null; then \
		echo "running (pid $$(cat $(WATCH_PID)), log $(WATCH_LOG))"; \
	else \
		echo "not running"; \
	fi
	@echo "=== Recent signals (5) ==="
	@sqlite3 data/scheduler.db "SELECT signal_id, kind, processed_at IS NOT NULL AS processed FROM signals ORDER BY received_at DESC LIMIT 5" 2>/dev/null || echo "no db"
