---
description: Apply the latest saved plan to the Focus Sessions calendar. Writes events. Requires explicit user confirmation.
---

# /apply-plan

Reads the latest plan from `scheduler-state`, asks the user to confirm, then creates calendar events on the dedicated `Focus Sessions` calendar and records every mapping in durable state.

## Steps

1. **Fetch the latest plan** — call `scheduler-state.get_latest_plan`. If null, abort with: "No plan to apply. Run /plan-week first."

2. **Render confirmation summary**:

   ```
   Plan generated <X minutes ago> at <ts>.
   Will create <N> events totaling <H> hours across <D> days on calendar "Focus Sessions".

   First 3 events:
     - Mon 09:00–10:30 [ENG-123] Fix login bug
     - Mon 10:45–12:00 [ENG-124] Add audit log (1/2)
     - Tue 09:00–10:30 [ENG-124] Add audit log (2/2)
     ...

   Approve? (yes/no)
   ```

3. **Stale-plan warning** — if `generated_at` was more than 1 hour ago, print a prominent warning: "Plan is N hours old. Calendar may have changed since. Re-run /plan-week to refresh? (yes to apply anyway / no)".

4. **Wait for explicit confirmation** — only proceed on a literal `yes`. Anything else (including "y", "ok", silence): abort, no writes, no DB updates.

5. **Create events** — for each session in the plan:
   - Calendar: `calendars.agent_writes_to` from preferences (the Focus Sessions calendar ID)
   - Title:
     - `[ENG-123] Issue title` if `total_sessions == 1`
     - `[ENG-123] Issue title (1/2)` if `total_sessions > 1`
   - Description (markdown):
     ```
     [Linear: ENG-123](https://linear.app/dustin-hack/issue/ENG-123)

     **Estimate:** 90min (1 of 2 sessions)
     **Reasoning:** <session.reasoning>
     ```
   - Start / end: from session JSON. Honor the timezone in preferences.

6. **Record each mapping** — after each successful `create_event`, call `scheduler-state.record_mapping` with:
   - `linear_issue_id`, `linear_issue_identifier`
   - `calendar_event_id` (returned by create_event), `calendar_id`
   - `session_index`, `total_sessions`
   - `planned_start`, `planned_end`
   - `status: "scheduled"`
   - `plan_id` (from the plan)

7. **Mark plan applied** — only after all sessions succeed, call `scheduler-state.mark_plan_applied(plan_id)`. Print summary: count of events created, total hours, list of mapping IDs.

## Failure handling

- **Mid-batch failure:** stop immediately. Print which sessions were created (with mapping IDs) and which were not. Do NOT call `mark_plan_applied`. The user can manually clean up orphans on the `Focus Sessions` calendar before retrying — easy because that calendar is dedicated.
- **Confirmation rejected:** zero side effects. No events, no DB writes.
- **Calendar API rate-limit:** wait briefly and retry once; on second failure, treat as mid-batch failure (above).
