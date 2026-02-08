# Gemini CLI Setup Guide

Connect your fantasy leagues to Gemini CLI via Flaim's MCP server. Clean machine to first tool call in ~5 minutes.

**Verified:** 2026-02-07 — full OAuth flow + `get_user_session` tool call confirmed end-to-end.

## Prerequisites

1. **Gemini CLI installed** — see [Gemini CLI docs](https://geminicli.com/docs/) for installation
2. **Flaim account** with at least one league synced — sign up at [flaim.app](https://flaim.app) and connect your ESPN or Yahoo credentials
3. **Default league set** — go to [flaim.app/leagues](https://flaim.app/leagues) and set a default

## Step 1: Add MCP Server

```bash
gemini mcp add flaim --scope user --transport http https://api.flaim.app/mcp
```

**Important:** Gemini CLI only loads MCP servers in trusted folders. If you run `gemini` from an untrusted directory (like `~`), `/mcp list` will show nothing. Either:
- Run `gemini` from a trusted project folder, or
- Trust your current folder via Gemini CLI settings (`/settings`)

Verify it was added (from a trusted folder):

```
/mcp list
```

You should see `flaim` listed (possibly as "Disconnected — OAuth not authenticated" until Step 2).

## Step 2: Authorize

Start authentication:

```
/mcp auth flaim
```

This opens your browser to the Flaim consent page:

1. Browser opens → Flaim authorization page (`flaim.app/oauth/consent`)
2. Sign in if needed → review the permissions (read-only access to your fantasy data)
3. Click **Allow** → redirect completes → Gemini CLI receives your token

Gemini CLI stores the token securely in `~/.gemini/mcp-oauth-tokens.json`. You don't need to manage tokens manually.

**Note:** Flaim uses OAuth 2.1 with PKCE and supports automatic discovery via `/.well-known/oauth-authorization-server`. Gemini CLI handles the entire flow.

## Step 3: First Tool Call

Ask a question about your fantasy leagues:

```
What leagues do I have connected?
```

Expected: Gemini calls `get_user_session` and returns your league names, platforms, and IDs.

Try more:

```
Show me the standings in my league
```

```
Who is on my roster?
```

You should see real data from your ESPN or Yahoo fantasy leagues.

## Available Tools

| Tool | What it does |
|------|-------------|
| `get_user_session` | Lists all your connected leagues |
| `get_ancient_history` | Historical leagues (2+ years old) |
| `get_league_info` | League settings and members |
| `get_standings` | Current standings |
| `get_matchups` | Current/upcoming matchups |
| `get_roster` | Your team roster with player stats |
| `get_free_agents` | Available free agents |

All tools are read-only. No trades, adds, or drops — Flaim only reads your data.

---

## OAuth Flow Detail

What happens under the hood when you run `/mcp auth flaim`:

1. Gemini CLI discovers Flaim's OAuth configuration via `https://api.flaim.app/.well-known/oauth-authorization-server`
2. CLI generates a PKCE challenge and opens your browser to the authorization URL
3. You sign in to Flaim (via Clerk) and consent to read-only access
4. Flaim redirects back with an authorization code
5. Gemini CLI exchanges the code for an access token + refresh token
6. Token is stored in `~/.gemini/mcp-oauth-tokens.json`
7. Scope granted: `mcp:read` (read-only fantasy data access)

## Token Lifecycle

- **Access tokens** expire after the configured TTL
- **Refresh tokens** are stored by Gemini CLI and used automatically when the access token expires
- **Auto-refresh**: Gemini CLI handles token refresh transparently — you shouldn't need to re-authorize
- **Manual re-auth**: If auto-refresh fails (e.g., refresh token revoked), run `/mcp auth flaim` again
- **Rate limit**: 200 MCP calls per day per user

## Troubleshooting

### "Authentication required" or tools fail with 401
Token may have expired and auto-refresh failed. Re-run authentication:
```
/mcp auth flaim
```

### "Token expired" after long inactivity
Gemini CLI should auto-refresh. If it doesn't:
1. Remove the server: `gemini mcp remove flaim`
2. Re-add: `gemini mcp add flaim --scope user --transport http https://api.flaim.app/mcp`
3. Re-authorize: `/mcp auth flaim`

### "No leagues found" or empty responses
Your Flaim account may not have leagues synced:
1. Go to [flaim.app/leagues](https://flaim.app/leagues)
2. Verify you have leagues listed
3. Ensure a default league is selected
4. If using ESPN: confirm your ESPN credentials are synced (use the Chrome extension or manual entry)

### `/mcp list` shows "No MCP servers configured"
You're likely in an untrusted folder. Gemini CLI suppresses MCP servers in untrusted directories. Run `gemini` from a trusted project folder or trust the current one via `/settings`.

### Connection timeout or server unreachable
- Verify the URL is `https://api.flaim.app/mcp` (not localhost, not http)
- Check your internet connection
- Verify the service is up: `curl -s https://api.flaim.app/auth/health`

### Browser doesn't open during auth
Copy the authorization URL from the terminal and open it manually in your browser.

### "Invalid redirect" error
Ensure your Gemini CLI version is up to date. Older versions may use redirect URIs that Flaim doesn't recognize.

### Rate limited (HTTP 429)
Flaim allows 200 MCP calls per day. If you hit the limit, wait until the next day or check your usage patterns.

### Consent page shows an error
Clear your browser cookies for `flaim.app` and retry the authorization flow.
