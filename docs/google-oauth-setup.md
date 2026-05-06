# Google Calendar OAuth Setup

This is the **#1 timebox risk** for the hackathon. Do this the night before.

End state: a `gcp-oauth.keys.json` file in `config/credentials/` and a working refresh token, so the `google-calendar-mcp` Docker container can read and write your calendar.

---

## Choice: which Google MCP you'll connect

We're using **`@cocal/google-calendar-mcp`** (the npm name) — repo: `nspady/google-calendar-mcp`. Local Docker, full CRUD, free/busy, multi-account, well-maintained. The setup below targets its credential format.

Note: Google released an **official remote Calendar MCP server** in 2026, but it's a hosted endpoint that connects via OAuth — fine in principle, but doesn't fit the "everything local in Docker" hackathon spirit. nspady's server is the right call for this project.

---

## Step 1 — Create a Google Cloud project

1. Go to https://console.cloud.google.com.
2. Top bar → project dropdown → **New Project**.
3. Name it `hackathon-scheduler` (or whatever). Organization: leave at default.
4. Wait ~10 seconds for it to provision. Switch to it.

## Step 2 — Enable the Google Calendar API

1. Left nav → **APIs & Services → Library**.
2. Search "Google Calendar API". Click it. Click **Enable**.

That's the only API you need for v1. Don't enable Drive, Gmail, etc. unless you're going for the stretch goal of reading linked Google Docs.

## Step 3 — Configure the OAuth consent screen

This is the screen users see when authorizing. Even though it's just you, Google requires it.

1. Left nav → **APIs & Services → OAuth consent screen** (or **Google Auth Platform → Branding** in the newer UI).
2. **User Type**: select **External** (Internal is only for Workspace orgs and not needed here).
3. **App information**:
   - App name: `Hackathon Scheduler`
   - User support email: your email
   - Developer contact email: your email
4. **Scopes**: skip on this screen — the MCP requests scopes at OAuth time. (If asked, add `https://www.googleapis.com/auth/calendar`.)
5. **Test users**: click **Add users**, add **your own Gmail/Workspace email**. Without this, OAuth will refuse you.
6. Save.

You'll be in **Testing** mode. That's fine. **Note**: in test mode, refresh tokens expire after 7 days. Re-auth command is in the troubleshooting section below.

## Step 4 — Create OAuth client credentials

1. Left nav → **APIs & Services → Credentials**.
2. **+ Create Credentials → OAuth client ID**.
3. **Application type**: **Desktop app** *(this is the right choice for the nspady MCP — do not pick Web application)*.
4. Name: `hackathon-scheduler-desktop`.
5. Click **Create**.
6. A modal shows your client ID and secret. Click **Download JSON**.
7. Save it as `config/credentials/gcp-oauth.keys.json` in your repo. **This file is already in `.gitignore` per the planning doc — verify before committing anything.**

The file looks like:
```json
{
  "installed": {
    "client_id": "...apps.googleusercontent.com",
    "project_id": "hackathon-scheduler",
    "client_secret": "GOCSPX-...",
    "redirect_uris": ["http://localhost"],
    "..."
  }
}
```

## Step 5 — Run the first-time auth flow

The OAuth consent flow needs a browser, which Docker containers don't have. So we authenticate **outside** Docker first, then mount the resulting token into the container.

From the repo root:

```bash
export GOOGLE_OAUTH_CREDENTIALS="$(pwd)/config/credentials/gcp-oauth.keys.json"
npx @cocal/google-calendar-mcp auth
```

What happens:
1. A browser opens to a Google consent page.
2. You'll see "Google hasn't verified this app" — that's expected in test mode. Click **Advanced → Go to Hackathon Scheduler (unsafe)**. It's your own app; "unsafe" is just Google's standard warning for unverified apps.
3. Approve the calendar scope.
4. The terminal prints "Authentication successful" and writes a token file.

**Where the token lands**: by default it goes to `~/.config/google-calendar-mcp/tokens.json` (or similar — the CLI prints the path). For the hackathon, copy or symlink it into the repo so docker-compose can mount it:

```bash
mkdir -p config/credentials
cp ~/.config/google-calendar-mcp/tokens.json config/credentials/google-token.json
```

Or set the token path explicitly before running auth:
```bash
export GOOGLE_CALENDAR_MCP_TOKEN_PATH="$(pwd)/config/credentials/google-token.json"
```

## Step 6 — Verify

```bash
GOOGLE_OAUTH_CREDENTIALS="$(pwd)/config/credentials/gcp-oauth.keys.json" \
  npx @cocal/google-calendar-mcp list-calendars
```

If this prints your calendar list, you're done with Google.

## Step 7 — docker-compose wiring (preview)

For reference, the compose stanza you'll end up with mounts both files read-write (token must be writable so the MCP can refresh it):

```yaml
google-calendar-mcp:
  image: ghcr.io/metorial/mcp-container--nspady--google-calendar-mcp--google-calendar-mcp:latest
  # OR build from source if you want to inspect / modify
  volumes:
    - ./config/credentials/gcp-oauth.keys.json:/config/gcp-oauth.keys.json:ro
    - ./config/credentials/google-token.json:/config/tokens.json
  stdin_open: true
  tty: true
```

---

## Step 8 — Create the dedicated `Focus Sessions` calendar

Manual one-time step in the Google Calendar UI:

1. https://calendar.google.com → left sidebar → **+ Other calendars → Create new calendar**.
2. Name: `Focus Sessions`. Save.
3. Note: the calendar **ID** is needed by the MCP, not the name. To find it:
   - Settings → click `Focus Sessions` under "Settings for my calendars" → scroll to **Calendar ID**.
   - Looks like `c_abcd1234@group.calendar.google.com`.
4. Put this ID in `config/preferences.yaml` as `calendars.agent_writes_to`. (Update from the placeholder name in the planning doc.)

---

## Troubleshooting

**"Token expired" / "invalid_grant" after 7 days.**
You're in test mode. Re-run:
```bash
GOOGLE_OAUTH_CREDENTIALS="$(pwd)/config/credentials/gcp-oauth.keys.json" \
  npx @cocal/google-calendar-mcp auth
```
To stop dealing with this, publish your app (Google Auth Platform → Audience → **Publish app**). For an unverified app this still triggers the "unsafe" warning, but tokens stop expiring at 7 days. Worth doing right after the hackathon.

**"Access blocked: This app's request is invalid" (Error 400 redirect_uri_mismatch).**
You picked the wrong client type. Delete the client and recreate as **Desktop app**, not Web application.

**"Access blocked: Hackathon Scheduler has not completed verification."**
You forgot to add yourself as a test user. Step 3, item 5.

**Docker can't refresh the token.**
The token file must be mounted writable (no `:ro`). Check Step 7.

**Browser doesn't open during auth.**
The CLI prints a URL — paste it manually into a browser. After approving, copy the redirect URL back into the terminal.
