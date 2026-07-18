# Flaim Setup Docs (ChatGPT + Optional MCP Clients)

This page is the single user-facing guide for using Flaim Fantasy in ChatGPT, plus secondary manual MCP setup for Claude custom connectors, Perplexity custom remote connectors, Gemini CLI, and developer testing.

## What Flaim Is

Flaim is a read-only fantasy analysis service for ESPN, Yahoo, and Sleeper leagues. It provides tools for rosters, standings, matchups, league settings, and free agents with explicit platform and season context.

Flaim cannot place trades, add/drop players, or modify league settings.

## Server + Auth

- **MCP URL:** `https://api.flaim.app/mcp`
- **Transport:** HTTP `POST` (non-POST returns `405` with `Allow: POST`)
- **Auth:** OAuth 2.1 + PKCE (S256)
- **Dynamic client registration:** `https://api.flaim.app/auth/register`
- **Authorization URL:** `https://api.flaim.app/auth/authorize`
- **Token URL:** `https://api.flaim.app/auth/token`
- **Revocation URL:** `https://api.flaim.app/auth/revoke`
- **Discovery:** `https://api.flaim.app/.well-known/oauth-authorization-server`
- **Token lifetime:** 1-hour access tokens plus rotating refresh tokens with a 1-year inactivity window by default (`OAUTH_REFRESH_TOKEN_TTL_SECONDS`, default `31536000`, clamped to 1 hour minimum and 1 year maximum)

## Setup (Once)

1. Create an account at `https://flaim.app`.
2. Add fantasy credentials:
   - ESPN: install the Chrome extension and click Sync, or enter cookies manually in the Flaim UI.
   - Yahoo: connect via OAuth in the Flaim UI (if applicable for your setup).
   - Sleeper: connect your Sleeper username in the Flaim UI.
3. Visit `https://flaim.app/leagues` and set a **default** league (recommended).

## Connect Your AI Client

| Client | Status | Setup path |
|--------|--------|------------|
| ChatGPT | Primary | Use Flaim Fantasy in ChatGPT |
| Claude | Optional custom connector | Add Flaim as a Claude custom connector where your Claude account supports it |
| Perplexity | Optional custom remote connector | Add Flaim as a custom remote connector with OAuth and Streamable HTTP |
| Gemini CLI | Optional terminal MCP client | Add Flaim as a Gemini CLI MCP server |
| Kiro, Cursor, and other coding tools | Optional terminal MCP client | Add Flaim as an MCP server with URL `https://api.flaim.app/mcp` |

### ChatGPT

Use Flaim Fantasy in ChatGPT as the primary experience. It is distributed through ChatGPT Apps and uses the same read-only league tools and OAuth flow described on this page.

### Manual MCP Clients

These clients can connect directly to Flaim's MCP endpoint where their MCP support allows remote HTTP servers and OAuth.

### Claude (Custom Connector)

Flaim is fully live and not in beta. Claude custom connectors are an optional setup path and may still be labeled beta by Claude; Free users are limited to one custom connector.

1. Add a remote MCP server with URL `https://api.flaim.app/mcp`.
2. Complete the OAuth consent screen when prompted.

### Perplexity (Custom Remote Connector)

Perplexity custom remote connectors require HTTPS. In some workspaces, admins must enable custom remote connectors before members can add them.

1. Add a custom remote connector with URL `https://api.flaim.app/mcp`, OAuth auth, and Streamable HTTP transport.
2. Complete the OAuth consent screen when prompted.

### Gemini CLI

1. `gemini mcp add flaim https://api.flaim.app/mcp --transport http`
2. In Gemini: `/mcp auth flaim` and complete the OAuth consent screen.

### Kiro and Other Coding Tools

Any MCP client that supports remote HTTP servers with OAuth should work. Add Flaim as an MCP server using this config:

```json
{
  "mcpServers": {
    "flaim": {
      "url": "https://api.flaim.app/mcp"
    }
  }
}
```

Then trigger the OAuth flow in your client (e.g. Kiro CLI: `/mcp auth flaim`) and complete the OAuth consent screen.

## Tools

All tools take explicit parameters: `platform`, `sport`, `league_id`, `season_year` (plus optional fields where applicable).

Analysis tools are read-only. `refresh_leagues` requires `mcp:write` because it can add or update Flaim league records after provider discovery, but it does not make roster moves, trades, drops, or lineup changes.

- `get_user_session` (required first call in a normal chat): your leagues and defaults
- `refresh_leagues`: re-discover connected leagues and update Flaim's league records
- `get_league_info` (usually second): baseline league context for team-name resolution, owner/team mapping, scoring, and roster-slot context before downstream league tools
- `get_roster`
- `get_standings`
- `get_matchups`
- `get_free_agents`
- `get_players`
- `get_transactions`
- `get_ancient_history` (historical branch for non-current seasons or inactive leagues)

Supported today: ESPN, Yahoo, and Sleeper.
Sleeper support is currently football + basketball (Phase 1).
`get_transactions` note: ESPN/Sleeper support week filtering; Yahoo ignores explicit `week` and uses a recent 14-day timestamp window. Yahoo `type=waiver` filtering is not supported in v1.
`get_free_agents` note: ESPN and Yahoo include ownership percentages and sort by ownership. Sleeper returns available-player identities without ownership percentages.
`get_players` note: ESPN and Yahoo may return league ownership fields (`league_status`, `league_team_name`, `league_owner_name`) when available. Sleeper returns identity with unavailable ownership context. If league ownership fields are absent, null, or unavailable, verify with `get_league_info` plus `get_roster`.

## Working Examples (Copy/Paste)

These are intentionally short and easy to copy/paste.

1. **List leagues**
   - “What fantasy leagues do I have? Show platform, sport, league id, season.”

2. **Standings**
   - “Show me the standings in my default league.”
   - “Show me the standings for ESPN football league 12345678 in 2025.”

3. **Roster**
   - “Who is on my roster in my default league?”
   - “Show my roster for Yahoo football league 123.l.456789, season 2025.”

4. **Free agents**
   - “Who are the best available free agents in my league right now?”
   - “Show best available QBs in my league.”

5. **Player search**
   - "Search for Giancarlo Stanton and Ben Rice in my league context."
   - "Find matching players for 'Rice' and show market ownership context."

6. **Transactions**
   - “Show recent transactions in my default league.”
   - “Show week 8 transactions for ESPN football league 12345678 in 2025.”
   - “Show recent Yahoo transactions for league 423.l.193847 in 2025 (adds/drops/trades).”

For Yahoo in v1, avoid requesting `type=waiver` and avoid relying on explicit `week` filtering:
- Yahoo ignores explicit `week` and always uses a recent 14-day timestamp window.
- Yahoo `type=waiver` filtering is intentionally unsupported in v1.

## Troubleshooting

- **“Authentication required” / “token expired”**: re-run the client’s connect flow (Gemini CLI: `/mcp auth flaim`; manual MCP clients: click Connect and approve when prompted).
- **ESPN stopped working**: ESPN session cookies expire periodically; re-sync using the extension (or re-enter cookies).
- **No default league**: set one at `https://flaim.app/leagues` to avoid needing to specify IDs in prompts.
- **Rate limits**: Flaim enforces a per-user daily call limit.
- **`redirect_uri is not in the allowed list`**: your MCP client is sending an unsupported loopback path. Pin `"redirectUri": "http://127.0.0.1:7778/oauth/callback"` in your MCP config (any port works; only the path matters).

## Privacy + Support

- Privacy policy: `https://flaim.app/privacy`
- Terms of service: `https://flaim.app/terms`
- Support: `privacy@flaim.app`
