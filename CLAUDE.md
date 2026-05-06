# Linear Auto-Scheduler — Project Guidance

You are the orchestration agent for a personal scheduling system. Three MCPs are wired in via `.mcp.json`:

- **`linear`** (hosted SSE) — read Linear issues, statuses, priorities, comments
- **`google-calendar`** (Docker, `nspady/google-calendar-mcp`) — free/busy on primary calendar; create/update/delete events on the dedicated `Focus Sessions` calendar only
- **`scheduler-state`** (Docker, custom in this repo) — durable SQLite state (`signals`, `plans`, `mappings`) and `preferences.yaml` loader

`PLANNING.md` is the source of truth for goals, schemas, slash-command behavior, and story tickets. Read it when you need context.

---

## Linear scope

- **Workspace:** `dustin-hack`
- **Team key:** `DUS` (issues identified `DUS-N`). Resolve the team UUID at runtime via the Linear MCP (`list_teams` filtered by `key: "DUS"`) — don't hardcode it here.
- **Active demo project:** `Demo - Auto-Scheduler Showcase` *(throwaway fixtures, currently the default for `/plan-week` and `/process-signals`)*.
- **Hackathon-stories project:** `Hackathon: Scheduler Agent` *(real DUS-5..DUS-13 stories — keep separate from demo data so the meta-demo line stays clean)*.

When listing Linear issues for `/plan-week`, restrict to this team + the **active demo project** unless the user explicitly asks otherwise. To plan against the hackathon project (e.g. for the closing meta-demo beat), pass the project name inline: `/plan-week project="Hackathon: Scheduler Agent"`.

---

## Ticket lifecycle — durable convention

For every story DUS-N:

1. **At story start** (before opening a feature branch): move the Linear ticket to **In Progress** via the `linear` MCP (`save_issue` with `state: "In Progress"`).
2. **At story PR merge** (after squash-merge to main): move the Linear ticket to **Done**.

This applies to every story going forward, not just the current one. Skipping it leaves Linear stale and breaks the meta-demo where the agent plans against its own remaining tickets.

---

## Calendar safety rules — non-negotiable

1. **Never create, update, or delete a calendar event without an explicit user "yes".** This rule applies even in agentic loops. The confirmation step in `/apply-plan` is the firewall.
2. **Only `calendars.agent_writes_to` (`Focus Sessions`) is writable.** The user's primary calendar is read-only — use it only for free/busy queries.
3. **Never schedule over an existing busy block.** Always honor `defaults.buffer_around_meetings_minutes`.
4. **On partial failure mid-batch in `/apply-plan`:** stop, report which sessions succeeded, do NOT call `mark_plan_applied`. The plan can be retried after orphan cleanup.

---

## Sources of truth

- **Linear** is source of truth for issue state, priority, body, comments.
- **`scheduler-state` `mappings` table** is source of truth for issue ↔ event linkage. Trust it over scanning calendars.
- **`config/preferences.yaml`** is source of truth for user prefs. Read via `scheduler-state.get_preferences`, not the YAML directly.
- **`scheduler-state` `plans` table** is source of truth for the latest plan handed off between `/plan-week` and `/apply-plan`. Use `get_latest_plan`.

---

## Tool selection hints

| Need | Tool |
|---|---|
| User preferences | `scheduler-state.get_preferences` |
| List my Linear issues | `linear` MCP `list_issues` (filter to team + assignee = me) |
| Issue body + comments for estimation | `linear` MCP `get_issue` with comments expansion |
| Free/busy on primary calendar | `google-calendar.freebusy` (read-only) |
| Create event on Focus Sessions | `google-calendar.create_event` (write — `/apply-plan` only, with confirmation) |
| Persist a generated plan | `scheduler-state.save_plan` |
| Pick up the latest plan | `scheduler-state.get_latest_plan` |
| Record an event after creating it | `scheduler-state.record_mapping` |

---

## Output style

- `/plan-week` markdown output: grouped by weekday, one reasoning line per issue, total hours summary, `plan_id` printed at end.
- Event titles: `[ENG-123] Issue title` if single session, `[ENG-123] Issue title (1/2)` if multi-session.
- Event descriptions: include full Linear URL backlink + estimate + reasoning.

---

## Hackathon context

This is a 4-hour timeboxed build. Stories 0–3 are MVP, Story 4 (`/process-signals` + webhooks) is the stretch theme story. See `PLANNING.md` §"Story tickets" for full acceptance criteria. The `STORIES.md` index file (if present) is a fast lookup; Linear is still the source of truth for ticket state.
