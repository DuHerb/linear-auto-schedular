.PHONY: help up down logs rebuild build mcp-list db-shell db-tables clean

help:
	@echo "Targets:"
	@echo "  up         start dozzle log viewer (MCPs spawn on demand via claude)"
	@echo "  down       stop all containers"
	@echo "  logs       open dozzle in browser (http://localhost:8080)"
	@echo "  build      build scheduler-state image"
	@echo "  rebuild    rebuild scheduler-state image with --no-cache"
	@echo "  mcp-list   run 'claude mcp list' from repo root"
	@echo "  db-shell   open sqlite3 against data/scheduler.db"
	@echo "  db-tables  show tables in data/scheduler.db"
	@echo "  clean      stop containers and remove SQLite db"

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

db-shell:
	sqlite3 data/scheduler.db

db-tables:
	sqlite3 data/scheduler.db ".tables"

clean:
	docker compose down -v
	rm -f data/scheduler.db data/scheduler.db-wal data/scheduler.db-shm
