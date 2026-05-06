---
description: Generate a weekly schedule from Linear issues. Read-only — does not write to calendar.
---

# /plan-week

Generate a weekly plan that schedules Linear issues assigned to the user, respecting working hours, fixed blocks, and existing meetings. **Zero calendar writes.** The plan is saved to `scheduler-state` for `/apply-plan` to consume.

## Steps

1. **Load preferences** — call `scheduler-state.get_preferences`. Capture timezone, working_hours, defaults, fixed_blocks, calendars.

2. **List Linear issues** — call the `linear` MCP. Scope:
   - Workspace: `dustin-hack`
   - Team: from `CLAUDE.md` (Linear scope section)
   - Assignee: me
   - Status in: Backlog, Todo, In Progress, Ready for Development
   - Order: priority desc (Urgent → P1 → P2 → P3 → P4), then created_at asc

3. **Read issue context for estimation** — for each issue, fetch body + comments. Estimate effort in minutes from text. Output one reasoning line per issue. No model, just judgment.

4. **Read calendar free/busy** — call `google-calendar.freebusy` for the next 7 weekdays on the user's primary calendar.

5. **Compose schedule** — per-day slotting:
   - Work only inside `working_hours[<weekday>]`.
   - Skip slots overlapping any busy block (with `defaults.buffer_around_meetings_minutes` margin on both sides).
   - Honor `fixed_blocks` of `type: block` (lunch, office_hours) — never schedule over them.
   - For `fixed_blocks` of `type: flexible` (workout) — pick a slot inside the window.
   - Sessions ≤ `defaults.session_max_minutes`. Insert a `break_duration_minutes` gap after every `break_after_minutes` of continuous work.
   - Issues estimated > `session_max_minutes` split into N sequential sessions: `ceil(estimate / session_max_minutes)`, equal-ish chunks, scheduled in priority order.
   - Tie-break equal-priority issues by issue creation date (older first).

6. **Output the plan** — markdown to stdout, grouped by weekday:

   ```
   ## Monday, Mar 10
   - 09:00–10:30 [ENG-123] Fix login bug (90min, 1/1) — body says ~3 unit tests + validation tweak
   - 10:30–10:45 break
   - 10:45–12:00 [ENG-124] Add audit log (75min, 1/2)
   ...

   Total: 6h 15m across 4 days. plan_id: <id>
   ```

7. **Persist the plan** — call `scheduler-state.save_plan` with structured JSON:

   ```json
   {
     "week_of": "2026-03-09",
     "sessions": [
       {
         "linear_issue_id": "...",
         "linear_issue_identifier": "ENG-123",
         "title": "Fix login bug",
         "linear_url": "https://linear.app/...",
         "session_index": 1,
         "total_sessions": 1,
         "planned_start": "2026-03-10T09:00:00-08:00",
         "planned_end": "2026-03-10T10:30:00-08:00",
         "estimate_minutes": 90,
         "reasoning": "..."
       }
     ]
   }
   ```

8. **Echo `plan_id`** — print it on the last line so the user can reference it.

## Guardrails

- **NEVER call `google-calendar.create_event` / `update_event` / `delete_event`.** This command is read-only. Verify before output: no write tool calls were made.
- If preferences fail to load (calendar ID still placeholder, etc.), abort with a clear message pointing the user at `config/preferences.yaml`.
- If Linear returns zero matching issues, say so explicitly — don't fabricate work.
