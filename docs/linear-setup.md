# Linear Setup

End state: `claude` can list, read, and update Linear issues from your workspace via MCP.

---

## Choice: hosted vs local Linear MCP

| | **Linear hosted MCP** *(recommended)* | **Community local MCP** |
|---|---|---|
| Endpoint | `https://mcp.linear.app/sse` | Runs as Docker container in your stack |
| Auth | OAuth (browser-based, one-time) | Personal API key in `.env` |
| Setup time | ~3 minutes | ~10 minutes |
| Linear support | Official | Community |
| Tools available | Full Linear toolset, kept current by Linear | Whatever the community server exposes |
| "Local everything" purist | Strictly speaking, no — it's Linear's hosted endpoint | Yes |

**Recommendation: hosted, for v1.** Your "everything local" rule is about *your* services and any custom listeners — SaaS API gateways aren't what that rule is protecting against. Linear's hosted MCP is officially maintained, will track Linear feature changes faster than community alternatives, and saves you 10 minutes you don't have.

If you want to swap to a community local MCP later, the rest of the system is unchanged — just edit `.mcp.json`.

The instructions below cover the hosted path. Community-local fallback is in the appendix.

---

## Step 1 — Confirm workspace and team

You'll need:
- The **workspace** you'll authenticate against (likely your Olio Apps Linear).
- The **team(s)** scope — either all teams you have access to, or a specific one.

For the hackathon I'd recommend **scoping to one team** so `/plan-week` doesn't pick up unrelated work. The Linear MCP supports filtering by team in tool calls; you'll just instruct the agent in CLAUDE.md to filter to that team.

> **Decision needed:** Which team / project ID? Note the team key (e.g. `ENG`, `OLIO`) — it'll appear in issue identifiers like `ENG-123` and `CLAUDE.md` will reference it.

## Step 2 — Create the hackathon tracker board

This is the board that tracks the hackathon work itself. The meta-demo at the end is the agent reading this same board and scheduling the remaining stories.

1. In Linear, create a project: `Hackathon: Scheduler Agent`.
2. Add a status workflow that includes `Backlog → Todo → In Progress → Done` at minimum. (Most Linear teams already have this.)
3. Seed it with the stories from `PLANNING.md`:
   - `Story 0: Bootstrap docker-compose + scheduler-state MCP skeleton` — P2
   - `Story 1: /plan-week command (read-only)` — P2
   - `Story 2: /apply-plan command (write)` — P2
   - `Story 3: Estimation + chunking + priority` — P2
   - `Stretch: /reschedule command` — P3
   - `Stretch: Linear webhook listener` — P3
   - `Stretch: Slack signal source` — P3
4. Assign all of them to yourself.
5. Give each story a body with the acceptance criteria from PLANNING.md — this is the text the agent will use to estimate effort.

## Step 3 — Connect the Linear MCP to claude

In your repo's `.mcp.json`:

```json
{
  "mcpServers": {
    "linear": {
      "type": "sse",
      "url": "https://mcp.linear.app/sse"
    },
    "google-calendar": {
      "command": "docker",
      "args": ["compose", "run", "--rm", "google-calendar-mcp"]
    },
    "scheduler-state": {
      "command": "docker",
      "args": ["compose", "run", "--rm", "scheduler-state"]
    }
  }
}
```

## Step 4 — Authenticate

From the repo root:
```bash
claude
```

Inside the session, ask Claude to authenticate with the Linear MCP. Or trigger it explicitly:
```
> /mcp
```
You'll see the Linear MCP listed — follow the auth prompt. A browser opens, you approve in your Linear workspace, done.

> **Note**: if you're in multiple Linear workspaces, the OAuth flow will let you pick which one to authorize.

## Step 5 — Verify

Inside `claude`:
```
> List my open issues assigned to me in the Hackathon team, ordered by priority.
```

Should return your seeded stories. If yes, you're done.

---

## Webhook setup (stretch — for v2 reactive sync)

You don't need this for the v1 hackathon. Setup notes for when you tackle the stretch goal:

1. Linear → Settings → API → Webhooks → **New webhook**.
2. URL: `https://your-tunnel.example.com/webhooks/linear` (you'll need ngrok or similar to expose your local listener).
3. Events: `Issue` (covers create/update/delete).
4. Resource types: scope to the Hackathon team.
5. Linear shows you a signing secret — store as `LINEAR_WEBHOOK_SECRET` in `.env`.

The v2 listener container will receive POSTs at `/webhooks/linear`, verify the signature, and call `log_signal(source='linear', kind='issue.updated', payload=…)` on the scheduler-state MCP.

---

## Appendix: community local Linear MCP (fallback path)

If you'd rather self-host:

1. Linear → Settings → API → **Personal API keys** → Create. Name it `hackathon-scheduler`. Save the key (`lin_api_…`) somewhere safe.
2. Add to `.env`:
   ```
   LINEAR_API_KEY=lin_api_...
   ```
3. Add a service to `docker-compose.yml`:
   ```yaml
   linear-mcp:
     image: ghcr.io/jerhadf/linear-mcp-server:latest  # or whichever community option you pick
     environment:
       LINEAR_API_KEY: ${LINEAR_API_KEY}
     stdin_open: true
     tty: true
   ```
4. Update `.mcp.json` to point `linear` at this container instead of the SSE URL.

There are several community Linear MCP servers; verify the one you pick is actively maintained before committing. The hosted option doesn't have this risk.

---

## Troubleshooting

**OAuth flow loops back to login.**
Likely already authenticated to a different Linear workspace in your browser. Open an incognito window and re-run.

**Agent returns issues from teams you don't care about.**
Either the agent isn't filtering, or the user has access to multiple teams. Add team filter instructions to `CLAUDE.md`:
> When listing Linear issues for `/plan-week`, restrict to team `OLIO_HACKATHON` (team ID: `xxx`).

**Tool call times out.**
SSE connections occasionally drop. Restart `claude`. If persistent, try the community local MCP fallback.
