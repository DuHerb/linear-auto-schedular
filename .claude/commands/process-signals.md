---
description: Drain unprocessed Linear/Slack signals, dispatching to schedule/cancel/complete actions on the calendar. Stretch — Story 4.
---

# /process-signals

Reads unprocessed rows from `scheduler-state.signals`, dispatches each to the appropriate calendar action, and marks them processed. Designed to be invoked headlessly by the webhook listener after each signal is logged, or via cron fallback.

## Steps

1. **Read unprocessed signals** — call `scheduler-state.list_signals({ processed: false })`, ordered by `received_at` ascending (FIFO).

2. **For each signal**, dispatch by `source` + `kind` + payload state:

   ### `source=linear`, `kind=issue.updated` (or `issue.created`)

   Decode the new state from the payload (`data.state.name` or equivalent).

   - **State ≥ "Ready for Development"** AND no existing active mapping for this issue (check `get_mappings_for_issue`):
     - Schedule a single-issue plan: estimate, find the next available slot honoring preferences, create event on Focus Sessions, record mapping.
     - Resolution note: `"scheduled at <ts>, mapping_id=<id>"`.

   - **State = "Done"**:
     - Look up active mapping(s). For each: leave the calendar event in place but call `update_mapping_status(mapping_id, "completed")`. Optionally append `[DONE]` to event title.
     - Resolution: `"marked complete: <mapping_ids>"`.

   - **State = "Cancelled"** OR moved back to **"Backlog"**:
     - For each active mapping with `planned_start > now`: delete the calendar event via `google-calendar.delete_event`, then `update_mapping_status(mapping_id, "cancelled")`.
     - Resolution: `"cancelled future events: <mapping_ids>"`.

   - **All other transitions:** no-op. Resolution: `"no-op: <state>"`.

3. **Mark signal processed** — call `scheduler-state.mark_signal_processed(signal_id, resolution)` after each signal handled.

4. **Per-signal isolation** — failures on one signal must not block the rest. Log the error in the resolution field as `"error: <message>"` and continue.

## Concurrency

Two near-simultaneous webhook deliveries could trigger two `/process-signals` runs. Mitigation:
- The `signals` table's `processed_at IS NULL` index lets each run claim only unprocessed rows.
- If overlap risk is real, add a SQLite advisory lock (single boolean row in a `meta` table) before draining and release after.

## Guardrails

- **Apply the same calendar safety rules from `CLAUDE.md`** — but with implicit confirmation, since this command is designed to run headless. The implicit consent is: the user moved the ticket in Linear; that's the trigger.
- Only the `Focus Sessions` calendar is writable. Never touch the user's primary calendar.
- If `preferences.yaml` is invalid, abort the entire run; do not mark any signal processed.
