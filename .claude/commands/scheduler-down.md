---
description: Stop the webhook auto-scheduling pipeline cleanly. Sweeps orphans. Safe to invoke when nothing is running.
---

# /scheduler-down

Tears down everything `/scheduler-up` started, plus any orphaned containers from `docker compose run --rm` invocations. Wraps `make scheduler-down`. Idempotent — safe to invoke when no pipeline is running.

## Steps

1. **Run the lifecycle target.** Execute `make scheduler-down` via Bash. The target:
   - Sends `SIGTERM` to the watch loop (PID from `/tmp/lin-sched-watch.pid`), waits 1s, escalates to `SIGKILL` if still alive. Removes the lock dir if left behind.
   - Sends `SIGTERM` to the smee forwarder (PID from `/tmp/lin-sched-smee.pid`), waits 1s, escalates to `SIGKILL`. Also runs `pkill -P` to catch any orphaned `npx`/`node` children.
   - Stops and removes the `linear-webhook-listener` container.
   - Sweeps any leftover `linear-auto-scheduler-*-run-*` containers from compose-run invocations (DUS-12 cleanup).
   - Does NOT touch the SQLite DB — signal history and mappings persist for inspection.

2. **Verify shutdown.** After the target reports done:
   - No process holds `/tmp/lin-sched-watch.pid` or `/tmp/lin-sched-smee.pid` (files removed).
   - `docker ps --filter "name=linear-auto-scheduler"` shows nothing webhook-related.
   - `make scheduler-status` confirms each component is "not running".

3. **Surface the teardown summary** to the user, including:
   - Which components were stopped vs were already down.
   - Confirmation that scheduler-state DB is intact (signals/mappings preserved).
   - Reminder that `/scheduler-up` brings everything back idempotently.

## Failure modes

- **PID file references a dead process.** The Makefile target detects this (`kill -0` check) and reports "stale pid file" — not an error.
- **Listener container already gone.** `docker compose stop`/`rm` are tolerant; the target ignores the error and continues.
- **Lock dir not held by us.** `rmdir` on a non-existent dir is silently OK (`|| true`).

## Guardrails

- Do not delete `data/scheduler.db` — that's signal/mapping history. Use `make clean` if a hard reset is genuinely needed (and only after confirming with the user).
- Do not delete the listener image — `make scheduler-up` would have to rebuild on next run.
- Do not modify `.env` or `config/preferences.yaml` during teardown.
