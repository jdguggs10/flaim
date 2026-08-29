# Flaim Connection Docs (ChatGPT, Claude + Optional Custom Connectors)

This page is the single user-facing reference for using Flaim Fantasy in ChatGPT or Claude, plus a secondary manual connection path for compatible AI platforms that accept custom remote MCP connectors. The public web version is [flaim.app/docs](https://flaim.app/docs) (AI apps: [flaim.app/docs/ai](https://flaim.app/docs/ai)).

## What Flaim Is

Flaim is a read-only fantasy analysis service for ESPN, Yahoo, and Sleeper leagues. It provides tools for rosters, standings, matchups, league info, available players, and recent moves with explicit platform and season context.

Flaim cannot make trades, add or drop players, edit lineups, or change league settings.

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
2. Connect your fantasy leagues at `https://flaim.app/leagues`:
   - ESPN: install the Chrome extension and click Sync.
   - Yahoo: complete Yahoo sign-in from your leagues page.
   - Sleeper: connect your Sleeper username in the Flaim UI.
3. Connect your AI client using the appropriate path below, authorize Flaim, and ask what fantasy leagues you have.

After setup, use `https://flaim.app/leagues` to add leagues, sync new seasons, or choose optional defaults. Defaults are not required to finish setup.

## Connect Your AI Client

| Client | Status | Setup path |
|--------|--------|------------|
| ChatGPT | Published in ChatGPT's Plugin Store | [Open Flaim Fantasy in ChatGPT](https://chatgpt.com/plugins/plugin_asdk_app_69a8f78087e081919e52cacacf00ff36) |
| Claude | Published in Claude's Connector Directory | [Open Flaim Fantasy in Claude](https://claude.ai/directory/connectors/f1a5b6a4-1f5b-470c-af23-71fc7ab13754) |
| Perplexity | Manual custom connector | Add Flaim where your Perplexity account supports custom remote connectors |
| Other compatible AI platforms | Advanced, unofficial setup | Add Flaim with the custom connector URL `https://api.flaim.app/mcp` |

### ChatGPT

Open [Flaim Fantasy in ChatGPT](https://chatgpt.com/plugins/plugin_asdk_app_69a8f78087e081919e52cacacf00ff36), choose **Try in chat**, and authorize your Flaim account if asked.

### Claude

Open [Flaim Fantasy in Claude's connector directory](https://claude.ai/directory/connectors/f1a5b6a4-1f5b-470c-af23-71fc7ab13754), choose **Connect**, and authorize your Flaim account. Claude shows the connector as **Connected** when it is ready.

### Manual Custom Connectors

Some AI platforms can connect directly to Flaim where they support custom remote MCP servers and OAuth. This is an advanced path alongside Flaim's direct ChatGPT and Claude directory links.

### Perplexity (Custom Remote Connector)

Perplexity custom remote connectors require HTTPS. Availability may depend on your account or workspace settings.

1. Open [Perplexity connector settings](https://www.perplexity.ai/account/connectors).
2. Choose **Custom connector**, then choose **Remote**.
3. Name it **Flaim Fantasy** and enter `https://api.flaim.app/mcp`.
4. Choose **OAuth** for authentication and **Streamable HTTP** for transport.
5. Accept the acknowledgement and choose **Add**.
6. Open the Flaim Fantasy connector, complete authorization, and enable it.

See [Perplexity's current custom remote connector instructions](https://www.perplexity.ai/help-center/en/articles/13915507-adding-custom-remote-connectors) if its interface changes.

### Other Compatible AI Platforms

If your AI platform supports custom remote MCP connectors with OAuth, add `https://api.flaim.app/mcp` as the connector URL and complete the browser authorization flow. Compatibility varies by platform, and Flaim does not promise support for every MCP client.

## Tools

All tools take explicit parameters: `platform`, `sport`, `league_id`, `season_year` (plus optional fields where applicable).

Analysis tools are read-only. `refresh_leagues` requires `mcp:write` because it can add or update Flaim league records after provider discovery, but it does not make roster moves, trades, drops, or lineup changes.

- `get_user_session` (required first call in a normal chat): your leagues and defaults
- `refresh_leagues`: re-discover connected leagues and update Flaim's league records
- `get_league_info` (usually second): baseline league context for team-name resolution, owner/team mapping, scoring, and roster-slot context before downstream league tools
- `get_draft`: confirmed draft results and provider-grounded draft-pick ownership
- `get_roster`
- `get_standings`
- `get_matchups`
- `get_free_agents`
- `get_players`
- `get_transactions`
- `get_ancient_history` (historical branch for non-current seasons or inactive leagues)

Supported today: ESPN, Yahoo, and Sleeper.
Sleeper supports football and basketball.
`get_transactions` note: ESPN `week` always means matchup period, including daily sports; omit it for the current and previous matchup periods. ESPN serves rows from its structured source and reports source/window/limitation metadata; failed-bid and trade-lifecycle filters are supported, becoming unavailable only if ESPN falls back to its activity feed. Sleeper supports week filtering. Yahoo ignores explicit `week` and uses a recent 14-day timestamp window for completed league transactions. On Yahoo, `type=waiver` and `type=pending_trade` return pending items for the authenticated user's own team.
`get_free_agents` note: every response carries a normalized envelope (`leagueId`, `seasonYear`, `position`, `count`, `ordering`, `capabilities`, `ownershipScope`) plus normalized per-player fields where derivable (`acquisitionState` and `waiverClearsAt` on ESPN only, `id`, `team`); prefer these over the legacy provider fields, which remain present. ESPN and Yahoo include platform-wide ownership percentages and sort by ownership. Sleeper returns available-player identities without ownership percentages.
`get_players` note: ESPN and Yahoo may return league ownership fields (`league_status`, `league_team_name`, `league_owner_name`) when available. Sleeper returns identity with unavailable ownership context. If league ownership fields are absent, null, or unavailable, verify with `get_league_info` plus `get_roster`.
`get_draft` note: round slot, stable board column, historical selecting team, and current pick owner are separate fields. Flaim omits exact future round slots when the provider does not expose enough draft-order evidence.

## Working Examples (Copy/Paste)

These are intentionally short and easy to copy/paste.

1. **List leagues**
   - “What fantasy leagues do I have? Show platform, sport, league id, season.”

2. **Standings**
   - “Show me the standings in my default league.”
   - “Show me the standings for ESPN football league 12345678 in 2025.”

3. **Draft picks**
   - “Which picks do I currently own, and where are they projected on the draft board?”

4. **Roster**
   - “Who is on my roster in my default league?”
   - “Show my roster for Yahoo football league 123.l.456789, season 2025.”

5. **Available players**
   - “Who are the best available players in my league right now?”
   - “Show best available QBs in my league.”

6. **Player search**
   - "Search for Giancarlo Stanton and Ben Rice in my league context."
   - "Find matching players for 'Rice' and show market ownership context."

7. **Transactions**
   - “Show recent transactions in my default league.”
   - “Show week 8 transactions for ESPN football league 12345678 in 2025.”
   - “Show recent Yahoo transactions for league 423.l.193847 in 2025 (adds/drops/trades).”

For Yahoo, avoid relying on explicit `week` filtering:
- Yahoo ignores explicit `week` and always uses a recent 14-day timestamp window.
- Yahoo `type=waiver` and `type=pending_trade` return pending items for the authenticated user's own team; other supported types use Yahoo's recent league transaction feed.

## Troubleshooting

- **“Authentication required” / “token expired”**: re-run the platform's connector flow, then approve access when prompted.
- **ESPN stopped working**: re-sync using the extension, then confirm the league appears at `https://flaim.app/leagues`.
- **No default league**: set one at `https://flaim.app/leagues` to avoid needing to specify IDs in prompts.
- **`redirect_uri is not in the allowed list`**: your MCP client is sending an unsupported loopback path. Pin `"redirectUri": "http://127.0.0.1:7778/oauth/callback"` in your MCP config (any port works; only the path matters).

## Privacy + Support

- Privacy policy: `https://flaim.app/privacy`
- Terms of service: `https://flaim.app/terms`
- Support: `privacy@flaim.app`
