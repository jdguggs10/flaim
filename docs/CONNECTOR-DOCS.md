# Flaim Connector Docs (Claude + ChatGPT + Gemini)

This page is the single, user-facing guide for connecting Flaim to AI clients (Claude, ChatGPT, Gemini CLI) via MCP.

## What Flaim Is

Flaim connects your fantasy leagues to AI assistants using the Model Context Protocol (MCP). It provides **read-only** tools for rosters, standings, matchups, league info, and free agents.

## Server + Auth

- **MCP URL:** `https://api.flaim.app/mcp`
- **Transport:** HTTP `POST` (non-POST returns `405` with `Allow: POST`)
- **Auth:** OAuth 2.1 + PKCE (S256)
- **Dynamic client registration:** `https://api.flaim.app/auth/register`
- **Authorization URL:** `https://api.flaim.app/auth/authorize`
- **Token URL:** `https://api.flaim.app/auth/token`
- **Revocation URL:** `https://api.flaim.app/auth/revoke`
- **Discovery:** `https://api.flaim.app/.well-known/oauth-authorization-server`

## Setup (Once)

1. Create an account at `https://flaim.app`.
2. Add fantasy credentials:
   - ESPN: install the Chrome extension and click Sync, or enter cookies manually in the Flaim UI.
   - Yahoo: connect via OAuth in the Flaim UI (if applicable for your setup).
3. Visit `https://flaim.app/leagues` and set a **default** league (recommended).

## Connect Your AI Client

### ChatGPT (Custom Action / MCP)

1. Add an MCP Action/connector and set the **MCP server URL** to `https://api.flaim.app/mcp`.
2. Complete the OAuth consent screen when prompted.

### Claude (Claude Desktop or claude.ai)

1. Add a remote MCP server with URL `https://api.flaim.app/mcp`.
2. Complete the OAuth consent screen when prompted.

### Gemini CLI

1. `gemini mcp add flaim https://api.flaim.app/mcp --transport http`
2. In Gemini: `/mcp auth flaim` and complete the OAuth consent screen.

## Tools (Read-Only)

All tools take explicit parameters: `platform`, `sport`, `league_id`, `season_year` (plus optional fields where applicable).

- `get_user_session` (start here): your leagues and defaults
- `get_roster`
- `get_standings`
- `get_matchups`
- `get_league_info`
- `get_free_agents`
- `get_ancient_history`

Supported today: ESPN + Yahoo; football, baseball, basketball, and hockey.

## Working Examples (Copy/Paste)

These are intentionally short and “directory reviewer friendly”.

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

## Troubleshooting

- **“Authentication required” / “token expired”**: re-run the client’s connect flow (Gemini CLI: `/mcp auth flaim`; Claude/ChatGPT: click Connect and approve).
- **ESPN stopped working**: ESPN session cookies expire periodically; re-sync using the extension (or re-enter cookies).
- **No default league**: set one at `https://flaim.app/leagues` to avoid needing to specify IDs in prompts.
- **Rate limits**: Flaim enforces a per-user daily call limit.

## Privacy + Support

- Privacy policy: `https://flaim.app/privacy`
- Terms of service: `https://flaim.app/terms`
- Support: `privacy@flaim.app`
