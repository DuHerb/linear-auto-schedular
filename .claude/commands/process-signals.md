---
description: Drain unprocessed Linear webhook signals. Schedules / completes / cancels Focus Sessions events based on issue state changes.
---

# /process-signals

Drains the `signals` table FIFO and dispatches each unprocessed signal to a calendar action: schedule, mark complete, or cancel. Every signal is stamped processed (with a resolution note) before moving on, even no-ops, so the drain is idempotent across re-runs.

## Calendar-safety carve-out — read first

This is the **only** path in the system that may write or delete calendar events without an interactive `yes` prompt. The user explicitly signed off on this for the webhook story (DUS-9):

- Inputs are HMAC-verified at the listener; signal rows can only originate from Linear.
- The dispatch logic below is the firewall: schedule **only** when there is no active mapping; cancel **only** future events; never touch the user's primary calendar.
- Calendar safety rules from `CLAUDE.md` still apply: only `calendars.agent_writes_to` (Focus Sessions) is writable; never schedule over a busy block.

If invoked interactively (without `--dangerously-skip-permissions`), still proceed without confirmation prompts — the carve-out applies to this slash command, not the harness.

## Steps

1. **Load preferences** — call `scheduler-state.get_preferences`. Capture timezone, working_hours, defaults, fixed_blocks, calendars.

2. **Drain unprocessed signals** — call `scheduler-state.list_signals` with `{"processed": false}`. Process the returned list **strictly serially** in `received_at` order. Do not parallelize — overlapping schedules can race the free/busy lookup.

3. **For each signal, dispatch by `kind`:**

   - **`Issue.update`** — parse `payload.data` (the Linear issue snapshot). Read:
     - `id` (Linear UUID) → use as `linear_issue_id`
     - `identifier` (e.g. `DUS-42`) → use as `linear_issue_identifier`
     - `state.name` (state the issue *moved to*)
     - `assignee.id` — if the issue is no longer assigned to me, resolve as `not_my_issue` (skip).

   - **`Issue.create`** — only act if `state.name` is one of the schedulable states below. Otherwise resolve as `created_not_yet_actionable`.

   - **Anything else** (`Comment.*`, `Project.*`, etc.) — resolve as `kind_not_handled`. Always still mark processed.

4. **State-driven dispatch** (after parsing):

   | State.name | Action |
   |---|---|
   | `Ready for Development`, `Todo`, `In Progress` | Schedule (see §5) — but only if `get_mappings_for_issue` returns no `scheduled` or `in_progress` rows. If active mappings already exist, resolve as `already_scheduled`. |
   | `Done` | For each existing mapping with status in (`scheduled`, `in_progress`): call `update_mapping_status` with `status="completed"`. Optionally update the calendar event title to prefix `[done]` via `google-calendar.update-event`. Resolve as `marked_completed:<N>`. |
   | `Cancelled`, `Backlog` | For each existing mapping with `planned_start` ≥ now and status in (`scheduled`, `in_progress`): call `google-calendar.delete-event` on Focus Sessions, then `update_mapping_status` with `status="cancelled"`. Past sessions are left intact (history). Resolve as `cancelled:<N>`. |
   | anything else | Resolve as `state_not_handled:<state.name>`. |

5. **Single-issue scheduling** (when dispatching to "Schedule"):

   1. Re-fetch the issue via `linear.get_issue(id)` with comments expansion, so estimation reads the current body + thread (the webhook payload may be stale or partial).
   2. Estimate effort minutes per the rubric in `/plan-week` step 3. Default to the lower end on ambiguity.
   3. Compute the conflict-source calendar set per `/plan-week` step 4 (resolve `calendars.conflict_sources` or fall back to `list-calendars` minus `calendars.agent_writes_to`). Call `get-freebusy` once across the set for the next 5 weekdays starting now.
   4. Find the next slot ≥ now that fits inside `working_hours`, doesn't overlap a busy interval (with `buffer_around_meetings_minutes`), and is at least `session_min_minutes` long. If estimate > `session_max_minutes`, chunk per `/plan-week` step 5 and place sessions sequentially across days.
   5. For each chunk, call `google-calendar.create-event` on `calendars.agent_writes_to`. Title and description follow the `/apply-plan` format. Then `record_mapping` with `status="scheduled"` and **no `plan_id`** (single-issue webhook scheduling does not generate a plan row).
   6. Resolve as `scheduled:<N_sessions>:<first_session_start_iso>`.

6. **Always call `mark_signal_processed`** with the resolution string above, even on no-ops, errors-handled, and skipped kinds. A signal that fails to process should be marked with resolution `error:<short_reason>` so future drains skip it instead of looping. If the underlying issue is critical, the user can manually re-log a new signal after fixing the state.

7. **Output** — print a one-line summary per signal:

   ```
   <signal_id_short> <kind> → <resolution>
   ```

   At the end, print `Processed N signals (S scheduled, C completed, X cancelled, K skipped, E errors)`.

## Failure handling

- **Mid-batch failure** — stop processing. The current signal stays unprocessed; subsequent drains pick up where this one left off. Already-applied actions are durable: mappings are recorded after each `create_event`, and `mark_signal_processed` only runs after the action lands.
- **Linear/Calendar API rate-limit** — fail fast on the current signal (resolve `error:rate_limited`), continue to the next. The fallback drain loop will re-try later.
- **Signal payload malformed** — resolve `error:malformed_payload:<reason>` and keep moving. Pre-validation at the listener already rejects non-JSON / unsigned bodies, so this path is rare.

## Drain mechanism

This command is invoked one of two ways:

1. **On-demand**: `claude /process-signals` (interactive, runs once).
2. **Polling loop**: `make watch-signals` runs a host-side loop that invokes `claude -p '/process-signals' --dangerously-skip-permissions` every 30 seconds. The Makefile target acquires a portable `mkdir`-based lock so a second `make watch-signals` aborts with an explicit message rather than racing the calendar. This is the production path during the demo — it satisfies the DUS-9 cron-fallback acceptance criterion.

The webhook listener does **not** invoke `claude` itself; it only writes signals. Decoupling keeps the listener container minimal (no `claude` CLI / no host config mounts) and the polling loop trivially serializable.
