.PHONY: help up down logs rebuild build mcp-list rpc clean-orphans db-shell db-tables clean

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
