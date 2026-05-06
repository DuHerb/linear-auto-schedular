.PHONY: help up down logs rebuild build mcp-list rpc clean-orphans db-shell db-tables clean \
        build-listener ensure-schema webhook-up webhook-down webhook-logs smee-forward watch-signals process-signals

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
		| perl -e 'alarm 5; exec @ARGV or die $$!' docker compose run --rm -T scheduler-state >/dev/null 2>&1 || true; \
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
smee-forward:
	@grep -q "^SMEE_URL=." .env 2>/dev/null || \
		(echo "ERROR: SMEE_URL unset in .env" && exit 1)
	@. ./.env && npx --yes smee-client --url "$$SMEE_URL" --target http://localhost:3000/webhooks/linear

# Single drain pass via headless claude. The --dangerously-skip-permissions
# flag is the calendar-safety carve-out the user signed off on for DUS-9.
process-signals:
	claude -p '/process-signals' --dangerously-skip-permissions

# Polling drain. Single-process serial loop — running two `make watch-signals`
# at once will race the calendar; don't. The mkdir-based lock below is a
# best-effort guard that's portable across macOS (no `flock` by default) and
# Linux. The lock doubles as a stale-PID indicator: if the process crashes,
# rerun with `make watch-signals-force` which clears /tmp/lin-sched-watch.lock.
WATCH_INTERVAL ?= 30
WATCH_LOCK ?= /tmp/lin-sched-watch.lock
watch-signals:
	@if ! mkdir $(WATCH_LOCK) 2>/dev/null; then \
		echo "ERROR: $(WATCH_LOCK) exists — another watch-signals running, or stale lock."; \
		echo "       If stale: rmdir $(WATCH_LOCK) && retry."; \
		exit 1; \
	fi
	@trap 'rmdir $(WATCH_LOCK) 2>/dev/null' EXIT INT TERM; \
	echo "Polling /process-signals every $(WATCH_INTERVAL)s. Ctrl-C to stop."; \
	while true; do \
		claude -p '/process-signals' --dangerously-skip-permissions; \
		sleep $(WATCH_INTERVAL); \
	done
