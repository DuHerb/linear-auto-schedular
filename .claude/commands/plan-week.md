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
   - All matched issues are scheduled regardless of priority; ordering happens in step 5. Carry Linear's numeric `priority` field through verbatim (0=None, 1=Urgent, 2=High, 3=Medium, 4=Low) — the planner re-sorts.

3. **Read issue context for estimation** — for each issue returned in step 2, call `linear.get_issue(id)` so the body and the full comment thread are loaded (the `list_issues` response carries titles + priorities only). Estimate effort in minutes from that text. No ML model, no fixture lookup — pure LLM judgment from the issue text. Surface one short reasoning line per issue tied to concrete signals.

   **Estimation rubric** — weigh these signals when reading body + comments. The reasoning line should name the ones that drove the estimate so the user can audit calibration over time:

   | Signal | Pulls estimate ↑ | Pulls estimate ↓ |
   |---|---|---|
   | Number of acceptance criteria | many discrete checkboxes | one or two |
   | Files / surfaces touched | crosses module boundaries, touches schema | single file, single function |
   | Test surface | new test fixtures, multiple test types | trivial unit test, no new fixtures |
   | New abstractions / config schema changes | yes | no |
   | Comment thread density | active back-and-forth, open questions | quiet, body-only |
   | "Stretch", "research", "spike" language | ↑ | — |
   | Direct-edit language (rename, typo, doc tweak) | — | ↓ |

   Default to the *lower* end of a plausible range when signals are ambiguous. Padded estimates eat the user's planning windows; the dedicated `Focus Sessions` calendar is cheap to extend if a session runs long.

4. **Read calendar free/busy** — call `google-calendar.freebusy` for the next 7 weekdays on the user's primary calendar.

5. **Compose schedule** — per-day slotting:

   - Work only inside `working_hours[<weekday>]`.
   - Skip slots overlapping any busy block (with `defaults.buffer_around_meetings_minutes` margin on both sides).
   - Honor `fixed_blocks` of `type: block` (lunch, office_hours) — never schedule over them.
   - For `fixed_blocks` of `type: flexible` (workout) — pick a slot inside the window.
   - **Sequencing.** Order issues by Linear `priority` (1 Urgent → 2 High → 3 Medium → 4 Low → 0 None). Tie-break equal-priority issues by `createdAt` ascending (older first). Worked example: P1 created Mar 5 lands before P1 created Mar 7; both land before any P2.
   - **Chunking.** If `estimate_minutes <= session_max_minutes` → one session. Otherwise split into `N = ceil(estimate / session_max_minutes)` equal-ish sessions, each `round(estimate / N)` minutes; the **last session absorbs any rounding slack** so the chunk durations always sum to `estimate_minutes` exactly. Schedule chunks in `session_index` order (1, 2, …, N), with the constraint that a higher-index chunk must start at or after the previous chunk's end. Worked examples (with default `session_max_minutes=120`):
     - 90 min → 1 session of 90
     - 180 min → 2 sessions of 90 (not 120 + 60 — keep chunks roughly equal so reasoning is consistent across sessions)
     - 240 min → 2 sessions of 120
     - 300 min → 3 sessions of 100
     - 250 min → 3 sessions of 83 + 83 + 84 (last absorbs the +1)
     - 200 min → 3 sessions of 67 + 67 + 66 (last absorbs the −1)
   - **Cross-day fit.** When a chunk doesn't fit the current day's remaining slot:
     1. If the slot is `>= session_min_minutes`, schedule a smaller chunk that fills the slot (still ≤ `session_max_minutes`), then re-chunk the remainder for subsequent days. The chunk count `N` may grow beyond the initial `ceil()` because day boundaries forced a smaller piece.
     2. If the slot is `< session_min_minutes`, skip the rest of the day and start the next chunk on the next available day at the chunks's full size.
     3. Re-chunked remainders still honor `session_max_minutes`. Example: 240 min issue, day 1 has 60 min free → schedule chunk 1 = 60 min on day 1; remaining 180 min re-chunks into 2×90 across day 2 (total 3 sessions, not the originally-planned 2).
     4. `session_index` and `total_sessions` reflect the *final* chunk count after cross-day adjustment, not the initial `ceil()` estimate.
   - **Breaks (anticipatory).** Track continuous-work minutes per day. Before scheduling each session, check whether adding it would push the counter past `break_after_minutes`. If so, insert a `break_duration_minutes` gap *before* the session and reset the counter to 0; the new session then starts fresh and increments the counter by its own duration. The break does not need to be its own JSON entry — just leave the gap in the markdown output and skip those minutes when picking the next session's start. Reset the counter when crossing a busy block, lunch, or end-of-day (those are natural breaks). Worked example with `break_after_minutes=120`, `break_duration_minutes=15`: 90 min session (counter=90) → next is 60 min, 90+60=150 > 120 → insert 15 min break *first*, reset counter, then schedule 60 min session (counter=60). Result: `90 → break → 60 → …`. The intent is to never let the agent actually do more than `break_after_minutes` of continuous focused work.

6. **Output the plan** — markdown to stdout, grouped by weekday:

   ```
   ## Monday, Mar 10
   - 09:00–10:30 [ENG-123] Fix login bug (90min, 1/1) — body says ~3 unit tests + validation tweak
   - 10:30–10:45 break
   - 10:45–12:00 [ENG-124] Add audit log (75min, 1/2)
   ...

   Total: 6h 15m across 4 days. plan_id: <id>
   ```

7. **Persist the plan** — call `scheduler-state.save_plan` with structured JSON. The schema below is the minimum; descriptive fields (`title`, `reasoning`, `linear_url`, `estimate_minutes`, `priority`) pass through and are surfaced by `/apply-plan` in event titles and descriptions.

   ```json
   {
     "week_of": "2026-03-09",
     "sessions": [
       {
         "linear_issue_id": "...",
         "linear_issue_identifier": "ENG-123",
         "title": "Fix login bug",
         "linear_url": "https://linear.app/...",
         "priority": 1,
         "session_index": 1,
         "total_sessions": 2,
         "planned_start": "2026-03-10T09:00:00-08:00",
         "planned_end": "2026-03-10T10:30:00-08:00",
         "estimate_minutes_total": 180,
         "estimate_minutes_session": 90,
         "reasoning": "Body lists 3 acceptance criteria touching auth + session storage; comment thread surfaces an open question about token rotation. Mid-complexity; signals: many criteria, schema touch, active thread."
       }
     ]
   }
   ```

   - `priority` must mirror Linear's `priority` value (0 None, 1 Urgent, 2 High, 3 Medium, 4 Low) so `/apply-plan` and downstream consumers don't have to re-fetch the issue.
   - `estimate_minutes_total` is the whole-issue estimate; `estimate_minutes_session` is this chunk. Equal across sessions when the issue is split.
   - `reasoning` should name at least one rubric signal so calibration is auditable from the saved plan alone.

8. **Echo `plan_id`** — print it on the last line so the user can reference it.

## Guardrails

- **NEVER call `google-calendar.create_event` / `update_event` / `delete_event`.** This command is read-only. Verify before output: no write tool calls were made.
- If preferences fail to load (calendar ID still placeholder, etc.), abort with a clear message pointing the user at `config/preferences.yaml`.
- If Linear returns zero matching issues, say so explicitly — don't fabricate work.
