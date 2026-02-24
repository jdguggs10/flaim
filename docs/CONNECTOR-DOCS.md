# Flaim Setup Docs (Claude + ChatGPT + Gemini)

This page is the single user-facing guide for connecting Flaim to AI clients (Claude, ChatGPT, Gemini CLI) and using read-only fantasy analysis tools.

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

## Setup (Once)

1. Create an account at `https://flaim.app`.
2. Add fantasy credentials:
   - ESPN: install the Chrome extension and click Sync, or enter cookies manually in the Flaim UI.
   - Yahoo: connect via OAuth in the Flaim UI (if applicable for your setup).
   - Sleeper: connect your Sleeper username in the Flaim UI.
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
- `get_transactions`
- `get_ancient_history`

Supported today: ESPN, Yahoo, and Sleeper.
Sleeper support is currently football + basketball (Phase 1) and does not include a Sleeper free-agent endpoint.
`get_transactions` note: ESPN/Sleeper support week filtering; Yahoo ignores explicit `week` and uses a recent 14-day timestamp window. Yahoo `type=waiver` filtering is not supported in v1.

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

5. **Transactions**
   - “Show recent transactions in my default league.”
   - “Show week 8 transactions for ESPN football league 12345678 in 2025.”
   - “Show recent Yahoo transactions for league 423.l.193847 in 2025 (adds/drops/trades).”

For Yahoo in v1, avoid requesting `type=waiver` and avoid relying on explicit `week` filtering:
- Yahoo ignores explicit `week` and always uses a recent 14-day timestamp window.
- Yahoo `type=waiver` filtering is intentionally unsupported in v1.

## Troubleshooting

- **“Authentication required” / “token expired”**: re-run the client’s connect flow (Gemini CLI: `/mcp auth flaim`; Claude/ChatGPT: click Connect and approve).
- **ESPN stopped working**: ESPN session cookies expire periodically; re-sync using the extension (or re-enter cookies).
- **No default league**: set one at `https://flaim.app/leagues` to avoid needing to specify IDs in prompts.
- **Rate limits**: Flaim enforces a per-user daily call limit.

## Privacy + Support

- Privacy policy: `https://flaim.app/privacy`
- Terms of service: `https://flaim.app/terms`
- Support: `privacy@flaim.app`
