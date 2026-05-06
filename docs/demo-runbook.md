# Hackathon Demo Runbook

Closing-demo arc for the Linear Auto-Scheduler. ~5 minute live walk-through. The meta-payoff: the agent has been managing its own remaining hackathon stories on the same board it's now demoing against.

---

## Pre-demo (10 min before)

1. **Working directory.** `cd /Users/dustinherboldshimer/dev/hackathon/linear-auto-scheduler`.

2. **Verify MCPs.** `make mcp-list` → all three (linear, google-calendar, scheduler-state) green. If google-calendar isn't, re-run `npx @cocal/google-calendar-mcp auth`.

3. **Verify `.env` populated.**
   ```bash
   grep -E "^(LINEAR_WEBHOOK_SECRET|SMEE_URL)=." .env
   ```
   Both should print non-empty values.

4. **Empty Focus Sessions calendar.** Open Google Calendar UI, delete any leftover events on Focus Sessions.

5. **Reset state.**
   ```bash
   sqlite3 data/scheduler.db "DELETE FROM signals; DELETE FROM mappings WHERE linear_issue_identifier='DUS-13';"
   ```
   Plus confirm DUS-13 is in **Backlog** in Linear UI (drag back if you ran a dry-run).

6. **Linear webhook live.** Linear → Settings → API → Webhooks. Webhook entry exists pointing at the Smee channel, signing secret matches `.env`, **Issues** resource type checked. (Comments resource is optional — won't trigger scheduling, the slash command no-ops on `Comment.*` kinds.)

7. **Demo project + tickets ready.** `Demo - Auto-Scheduler Showcase` project in `dustin-hack` exists with **DUS-14–DUS-23** in Backlog. These are the prepped fixtures `/plan-week` will surface (varying priorities + estimates designed to exercise priority sequencing and multi-session chunking).

8. **One terminal in the repo root.** Lifecycle is single-command now (no longer three terminals).

---

## The single command

`/scheduler-up` (or `make scheduler-up`) brings up everything detached:

- listener container under the `webhook` compose profile
- `scripts/smee-forward.sh` as a nohup background process (PID → `/tmp/lin-sched-smee.pid`, log → `/tmp/lin-sched-smee.log`)
- `scripts/watch-signals.sh` as a nohup background process (PID → `/tmp/lin-sched-watch.pid`, log → `/tmp/lin-sched-watch.log`)

Idempotent — re-runs skip components already alive. SQLite pre-check inside the watch loop means idle ticks burn zero tokens (only spawns `claude -p` when there are unprocessed signals).

What to point out as you run it:
- **Listener:** "HMAC verification at the door, direct INSERT into SQLite, returns 200 in 6 ms. No `claude` inside this container."
- **Smee forwarder:** "Free webhook-relay channel — Linear posts there, smee-client streams to my laptop. HMAC verification still happens at my listener, not at Smee. Tunnel is dumb pipe."
- **Drain loop:** "Calendar-safety carve-out lives here. Polls every 30s, only spawns claude when signals queue. Two firewall layers — HMAC at the listener, dispatch guards in `/process-signals`."

For demo theater, an optional second pane: `tail -f /tmp/lin-sched-watch.log` so the audience sees the drain narrate itself.

---

## Demo arc (live)

### Beat 1 — empty state

```bash
make scheduler-up
make scheduler-status
```

Shows listener + smee forwarder + watch loop all running. Open `Focus Sessions` calendar in the right panel — empty. Linear board on left — DUS-14–DUS-23 in Backlog.

> "All three pieces running, calendar empty. Pipeline is hot."

### Beat 2 — interactive plan

```bash
claude /plan-week
```

`CLAUDE.md` points `/plan-week` at the **Demo project** by default, so the markdown output lists DUS-14–DUS-23 grouped by weekday with reasoning per issue. Walk through:

- **Considered calendars:** header (DUS-11 — multi-calendar free/busy union).
- **Priority sequencing:** Urgent (DUS-14, DUS-15) lands first, then High, then Medium, then Low (DUS-12 sequencing rules).
- **Multi-session chunking:** DUS-17 (210 min), DUS-18 (180 min), DUS-21 (150 min) split across days — `[DUS-17] Migrate analytics events to v2 schema (1/3)` etc.
- **Estimation rubric:** each line names which signals drove the number ("six emitter sites + cross-cutting + active thread → high estimate"; "single MJML template + direct edit language → low").

Don't `/apply-plan` — keep calendar empty for the live trigger.

### Beat 3 — the theme moment ⭐

In the Linear UI, drag **DUS-13** from Backlog → **Ready for Development**.

- Within ~1s, terminal shows `[listener] signal <uuid> kind=Issue.update` (visible if you tailed `/tmp/lin-sched-smee.log` or are watching `make webhook-logs`).
- Within ~30s + claude exec time (~15-45s), the watch loop fires the drain.
- **Heads-up:** Linear emits multiple `Issue.update` events per UI drag (state + sortOrder + startedAt all change). Two signals will land. The slash command's idempotency guard catches this — first signal gets `scheduled:1:<ts>`, second resolves `already_scheduled`. Audience-facing: "exactly one event lands on the calendar; the duplicate webhook is recognized and dropped."
- Refresh Google Calendar → event appears on Focus Sessions, titled `[DUS-13] Demo - pretest Ticket` with Linear backlink + estimate + reasoning in the description.

> "Zero terminal interaction. Linear state change → calendar update. The webhook drain is the only place we cross the calendar-safety line, and it's HMAC-gated."

### Beat 4 — completion lifecycle

Drag DUS-13 → **Done**.

- Two more `Issue.update` signals land (Linear pattern again).
- Drain dispatches: first gets `marked_completed:1` (mapping found, status flipped to `completed`, calendar event title prefixed `[done]`); second gets `marked_completed:0` (no active mappings to mark — already flipped).
- `sqlite3 data/scheduler.db "SELECT status FROM mappings WHERE linear_issue_identifier='DUS-13'"` → `completed`.
- Calendar event stays on the calendar (history preservation, not deletion).

> "Done means the work happened. We keep the audit trail; only Cancelled / Backlog removes future events."

### Beat 5 — cancellation lifecycle (optional, time-permitting)

Drag a different ticket (e.g. DUS-22) to **Ready for Development**, let it schedule, then drag it back to **Backlog** or → **Cancelled**.

- Future Focus Sessions event for DUS-22 gets deleted via `google-calendar.delete-event`.
- Mapping flips `scheduled → cancelled`.

### Beat 6 — meta-demo close

```bash
claude /plan-week project="Hackathon: Scheduler Agent"
```

Inline override pulls /plan-week off the Demo project for one beat, plans against the real hackathon stories. Closing line:

> "All of this — the schema, the slash commands, the listener, the drain — was scoped, planned, and built across DUS-5 through DUS-9 in a 4-hour window. The agent has been managing its own remaining hackathon stories on the same board the whole time."

Optional flourish: drag the lone DUS-10 stretch ticket to Ready for Development, watch it auto-schedule via the same pipeline.

---

## Failure-mode escape hatches

| Symptom | Recovery |
|---|---|
| `scheduler-up` fails: `LINEAR_WEBHOOK_SECRET unset` | `cat .env`, populate the variable. |
| `scheduler-up` fails: `signals` table missing | `make build`, retry. `ensure-schema` is a prereq of `webhook-up` and runs scheduler-state once to apply schema. If it still fails, scheduler-state image hasn't built yet. |
| Smee shows red dots in Linear's "Recent deliveries" tab | Signing secret in `.env` doesn't match Linear's stored value. Recreate the webhook in Linear, copy the new secret to `.env`, then `/scheduler-down` + `/scheduler-up`. |
| Watch loop won't start: lock dir held | `rmdir /tmp/lin-sched-watch.lock`, retry. (Means a previous watch loop crashed without releasing.) |
| Calendar event didn't appear within ~60s | `make scheduler-status` shows last 5 signals + processed flags. If a signal sits unprocessed, `tail /tmp/lin-sched-watch.log` for errors. |
| `claude` invocation hangs in drain loop | Ctrl-C the loop somehow, or just `/scheduler-down` and re-up. The signal stays unprocessed and gets picked up next iteration. |
| Stale demo state mid-demo | `/scheduler-down`, then `sqlite3 data/scheduler.db "DELETE FROM signals; DELETE FROM mappings WHERE linear_issue_identifier='DUS-13'"`, then delete any remaining Focus Sessions events manually, drag DUS-13 back to Backlog, `/scheduler-up`. |

---

## Post-demo cleanup

```bash
make scheduler-down

sqlite3 data/scheduler.db <<EOF
DELETE FROM signals;
DELETE FROM mappings WHERE linear_issue_identifier IN ('DUS-13', 'DUS-22');
EOF
```

Plus delete any leftover Focus Sessions events in the Google Calendar UI. Drag DUS-13 (and DUS-22 if used) back to Backlog so the next demo starts clean.

The 10 demo tickets DUS-14–DUS-23 stay — they're fixtures for repeated demos.

---

## Talking points cheat sheet

- **"Three MCPs, one orchestrator, no custom long-running agent service."** Linear hosted SSE + nspady google-calendar Docker + scheduler-state custom Docker, composed by the `claude` CLI. The webhook listener is a fourth process but doesn't host an agent — it's HMAC + INSERT + 200.
- **"scheduler-state owns the truth."** SQLite at `./data/scheduler.db` with three tables: signals (webhook deliveries), plans (whole-week schedules from `/plan-week`), mappings (Linear ↔ calendar event linkage).
- **"The carve-out is the only place we cross the calendar-safety line."** All other writes (`/apply-plan`) require interactive `yes`. The webhook drain skips that prompt because the listener already verified HMAC and the dispatch guards prevent over-scheduling.
- **"Cron-fallback over listener-spawn."** Picked the more reliable of the two AC paths — keeps the listener container minimal and avoids three brittle docker mounts (socket, auth credentials, repo).
- **"SQLite pre-check makes idle drains free."** Watch loop sleeps without spawning `claude` when no signals queue. Active = 30s response; idle = zero token spend.
- **"Hidden calendars are still treated as conflicts (DUS-11 default)."** Safer-by-default. Users opt out via `calendars.conflict_sources`.
- **"Idempotency guard handles webhook duplicates."** Linear emits multiple events per UI action (state + sortOrder + startedAt). The dispatch matrix's `get_mappings_for_issue` check ensures only one schedule action per real state transition.
