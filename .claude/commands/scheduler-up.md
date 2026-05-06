---
description: Start the full webhook auto-scheduling pipeline (listener + smee forwarder + drain loop). Idempotent.
---

# /scheduler-up

Brings up every long-running piece of the DUS-9 pipeline so the user has one shell back instead of three terminals. Wraps `make scheduler-up`, then verifies each component is alive and reports status.

## Steps

1. **Run the lifecycle target.** Execute `make scheduler-up` via Bash. The target:
   - Verifies `LINEAR_WEBHOOK_SECRET` and `SMEE_URL` are set in `.env` (errors out clearly if either is missing).
   - Ensures the `signals`/`plans`/`mappings` schema exists (`make ensure-schema`).
   - Brings up the `linear-webhook-listener` container under the `webhook` compose profile.
   - Detaches `scripts/smee-forward.sh` and `scripts/watch-signals.sh` as nohup background processes, recording each PID to `/tmp/lin-sched-{smee,watch}.pid`.
   - Skips re-launching any component already running (idempotent).
   - Aborts loudly if either detached process dies within 1 second of launch.

2. **Verify health.** After the target reports success:
   - `curl -fsS http://localhost:3000/health` should return `{"ok":true}`.
   - The PID files exist and reference live processes.
   - `make scheduler-status` summarizes the live state.

3. **Surface the bring-up summary** to the user, including:
   - Listener URL and health status.
   - Tail-log paths for the two background processes (`/tmp/lin-sched-smee.log`, `/tmp/lin-sched-watch.log`).
   - Reminder of the calendar-safety carve-out: from this point on, `make watch-signals`'s drain may write Focus Sessions events without an interactive `yes` prompt — the firewall is HMAC verification at the listener plus the dispatch guards in `/process-signals`.
   - The stop command: `make scheduler-down` (or `/scheduler-down`).

## Failure modes

- **Missing secrets.** `make scheduler-up` exits non-zero with a pointer to `.env`. Surface the message verbatim — don't silently continue.
- **Listener fails to start.** Tail `make webhook-logs` (or `docker logs linear-auto-scheduler-linear-webhook-listener-1`) and surface the last few lines.
- **Background process dies immediately.** The Makefile target catches this (1-second post-launch `kill -0` check). Surface the relevant log file path.
- **Lock dir already held.** Means a previous `make watch-signals` is running in a terminal. Either stop it first or accept the existing loop — don't force-clear the lock.

## Guardrails

- Do not invoke `claude -p '/process-signals'` directly — `make scheduler-up` already starts the drain loop.
- Do not write to `.env` from this command. If a secret is missing, ask the user to populate it.
- Do not modify the calendar from this command. Calendar writes happen only inside the drain loop.
