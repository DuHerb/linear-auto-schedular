# Hackathon Demo Runbook

Closing-demo arc for the Linear Auto-Scheduler. ~5 minute live walk-through. The meta-payoff: the agent has been managing its own remaining hackathon stories on the same board it's now demoing against.

---

## Pre-demo (10 min before)

1. **Check the working directory.** `cd /Users/dustinherboldshimer/dev/hackathon/linear-auto-scheduler`.

2. **Verify MCPs.** `make mcp-list` → all three (linear, google-calendar, scheduler-state) green. If google-calendar isn't, re-run `npx @cocal/google-calendar-mcp auth`.

3. **Verify .env populated.**
   ```bash
   grep -E "^(LINEAR_WEBHOOK_SECRET|SMEE_URL)=." .env
   ```
   Both should print non-empty values.

4. **Empty `Focus Sessions` calendar.** In Google Calendar UI, delete any leftover events on that calendar so the demo starts clean.

5. **Stale-mapping cleanup.** If you've been smoke-testing, drop scheduled rows that no longer have backing events:
   ```bash
   sqlite3 data/scheduler.db \
     "DELETE FROM mappings WHERE status='scheduled' AND linear_issue_identifier LIKE 'DUS-9%';"
   ```

6. **Linear webhook live.** Linear → Settings → API → Webhooks. Webhook entry for the Smee channel exists, signing secret matches `.env`, Resource types include Issues. If it isn't there, create one before continuing.

7. **Demo ticket prepped.** A throwaway ticket in Backlog state, assigned to you. Body: "Fix the login bug, ~30 min." Use this for the live trigger.

8. **Three terminals ready, side-by-side.** Each in the repo root.

---

## The three terminals

**Layout:** stack vertically so the audience sees them all. Left half of screen for terminals; right half for Linear UI + Google Calendar UI.

### Terminal 1 — listener
```bash
make webhook-up
make webhook-logs        # tail
```

What to point out: "This is the only public-facing piece. HMAC verification at the door, direct INSERT into SQLite, returns 200 in 6 ms. No `claude` inside this container."

### Terminal 2 — Smee forwarder
```bash
make smee-forward
```

What to point out: "Smee is a free webhook-relay channel — Linear posts there, my laptop subscribes over SSE. HMAC verification still happens at my listener, not at Smee. The tunnel is dumb pipe."

### Terminal 3 — drain loop
```bash
make watch-signals
```

What to point out: "This is the calendar-safety carve-out. The only path that writes events without an interactive `yes` prompt. Triggered only by HMAC-verified signals — two firewall layers. Polls every 30 seconds; an event lands within that window of the Linear state change."

---

## Demo arc (live)

### Beat 1 — empty state
- Show empty `Focus Sessions` calendar in the right panel.
- Show the Linear board: stories in Backlog.
- "All three MCPs running, listener up, drain loop watching. Calendar is empty."

### Beat 2 — interactive plan
```
claude /plan-week
```
- Walk through the markdown output. "Reads my Linear board, checks free/busy across all my calendars (DUS-11), estimates from issue body + comments (DUS-8), chunks long tasks across days, sequences by priority."
- Show the `Considered calendars:` header.
- Don't `/apply-plan` — that's not the headline.

### Beat 3 — the theme moment ⭐
- In Linear UI, drag the demo ticket from Backlog → **Ready for Development**.
- Watch terminal 1: `[listener] signal <uuid> kind=Issue.update` appears within ~1 s.
- Watch terminal 3: within 30 s, the drain fires. `claude` runs `/process-signals`, queries `get_mappings_for_issue` (no active → schedule path), reads the issue, finds the next slot, creates the event.
- Refresh Google Calendar. Event appears on `Focus Sessions` with title `[DUS-13] Fix the login bug` and the Linear backlink in the description.
- "Zero terminal interaction. Linear state change → calendar update."

### Beat 4 — completion lifecycle
- Drag the demo ticket to **Done**.
- Watch the drain pick up the second signal within 30 s.
- `sqlite3 data/scheduler.db "SELECT status FROM mappings WHERE linear_issue_identifier='DUS-13'"` → `completed`.
- Calendar event is left intact for history; status is what matters.

### Beat 5 — cancellation lifecycle (optional, time-permitting)
- Drag a different ticket to **Cancelled** (one with a future-dated mapping).
- Drain fires; future event deleted; mapping `cancelled`.

### Beat 6 — meta-demo close
- "All of this — the schema, the slash commands, the listener, the drain — was scoped, planned, and built across DUS-5 through DUS-9 in a 4-hour window. The agent has been managing its own remaining hackathon stories the entire time."
- Show the Linear board with DUS-9 in `In Progress` (or `Done` post-merge).
- Optional: `claude /plan-week` one more time to show it scheduling the *remaining* hackathon stretch work.

---

## Failure-mode escape hatches

| Symptom | Recovery |
|---|---|
| Listener won't start: `LINEAR_WEBHOOK_SECRET unset` | Check `.env` is populated. `cat .env`. |
| `webhook-up` fails: `signals` table missing | `make build && make ensure-schema`. |
| Smee channel rejected payloads (Linear shows red dots in webhook log) | Signing secret in `.env` doesn't match the one Linear stores. Recreate the webhook in Linear, copy new secret to `.env`, restart listener. |
| Drain loop stuck (`/tmp/lin-sched-watch.lock` exists) | `rmdir /tmp/lin-sched-watch.lock` and re-run. |
| Calendar event didn't appear within 30 s | Check terminal 3 — drain may have errored. `sqlite3 data/scheduler.db "SELECT signal_id, kind, processed_at, resolution FROM signals ORDER BY received_at DESC LIMIT 3"` shows resolution strings. |
| Smee forwarder shows nothing on a state change | Check Linear webhook → Recent deliveries. If Linear shows 200, Smee dropped it; restart `make smee-forward`. If Linear shows non-200, secret mismatch. |
| `claude` invocation hangs in drain loop | Ctrl-C the loop, `rmdir` the lock, re-run. The signal stays unprocessed and gets picked up next iteration. |

---

## Post-demo cleanup

```bash
# Stop everything
# Terminal 3: Ctrl-C
# Terminal 2: Ctrl-C
make webhook-down

# Remove the demo ticket if it was throwaway
# (or drop the demo mappings from SQLite)
sqlite3 data/scheduler.db \
  "DELETE FROM mappings WHERE linear_issue_identifier='DUS-13';"

# Clean smee-test signals from history (optional — they're processed already)
sqlite3 data/scheduler.db \
  "DELETE FROM signals WHERE resolution LIKE '%smoke%';"
```

---

## Talking points cheat sheet

- **"Three MCPs, one orchestrator, no custom long-running agent service."** That's the v1 architecture. Linear hosted SSE + nspady google-calendar Docker + scheduler-state custom Docker, all composed by the `claude` CLI.
- **"scheduler-state owns the truth."** SQLite at `./data/scheduler.db` with three tables: signals (webhook deliveries), plans (whole-week schedules), mappings (Linear ↔ calendar event linkage).
- **"The carve-out is the only place we cross the calendar-safety line."** All other writes (`/apply-plan`) require interactive `yes`. The webhook drain skips that prompt because the listener already verified HMAC and the dispatch guards prevent over-scheduling.
- **"Cron-fallback over listener-spawn."** Picked the more reliable of the two AC paths — keeps the listener container minimal and avoids three brittle docker mounts (socket, auth credentials, repo).
- **"Hidden calendars are still treated as conflicts (DUS-11 default)."** Safer-by-default. Users opt out via `calendars.conflict_sources`.
