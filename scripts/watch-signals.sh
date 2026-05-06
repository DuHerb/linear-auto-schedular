#!/usr/bin/env bash
# Polling drain for unprocessed Linear webhook signals.
#
# Runs `claude -p '/process-signals' --dangerously-skip-permissions` whenever
# the signals table has unprocessed rows. Idle ticks are SQLite-only (no
# `claude` invocation, no token spend). Single-process — the mkdir-based
# lock prevents two concurrent loops from racing the calendar.
#
# Used both as a foreground process (`make watch-signals`) and as a
# detached background process (`make scheduler-up`).

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

WATCH_INTERVAL="${WATCH_INTERVAL:-30}"
WATCH_LOCK="${WATCH_LOCK:-/tmp/lin-sched-watch.lock}"
DB_PATH="${DB_PATH:-data/scheduler.db}"

if ! mkdir "$WATCH_LOCK" 2>/dev/null; then
  echo "ERROR: $WATCH_LOCK exists — another watch-signals running, or stale lock." >&2
  echo "       If stale: rmdir $WATCH_LOCK && retry." >&2
  exit 1
fi
trap 'rmdir "$WATCH_LOCK" 2>/dev/null' EXIT INT TERM

echo "[watch-signals] polling /process-signals every ${WATCH_INTERVAL}s. Ctrl-C to stop."

while true; do
  unprocessed=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM signals WHERE processed_at IS NULL" 2>/dev/null || echo 0)
  if [ "$unprocessed" -gt 0 ]; then
    echo "[watch-signals] $unprocessed unprocessed signal(s); draining..."
    claude -p '/process-signals' --dangerously-skip-permissions
  fi
  sleep "$WATCH_INTERVAL"
done
