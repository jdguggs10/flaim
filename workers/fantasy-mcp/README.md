# Fantasy MCP Gateway

Unified MCP (Model Context Protocol) gateway for all fantasy sports platforms. Single endpoint for Claude, ChatGPT, and other AI assistants.

## Purpose

Provides a platform-agnostic MCP interface that:
- Exposes unified tools with explicit parameters (`platform`, `sport`, `league_id`, `season_year`)
- Routes requests to platform-specific workers via service bindings
- Handles OAuth authentication via auth-worker

## Architecture

```
Claude/ChatGPT
     |
     v (OAuth token)
fantasy-mcp (this worker)
     |
     +---> espn-client (service binding) ---> ESPN API
     +---> yahoo-client (service binding) --> Yahoo Fantasy API
     +---> sleeper-client (service binding) -> Sleeper API (public)
     +---> auth-worker (service binding) ---> Supabase
```

## Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check with binding status |
| `/fantasy/health` | GET | Same (for routed access) |
| `/.well-known/oauth-protected-resource` | GET | OAuth metadata (RFC 9728) |
| `/mcp` | POST | MCP protocol endpoint |
| `/mcp` | non-POST | Returns `405` with `Allow: POST` |
| `/mcp/r/:runId/t/:traceId` | POST | Eval-only traced MCP alias |
| `/mcp/r/*` (malformed) | any | Returns `400` malformed eval route |
| `/fantasy/mcp` | POST | Same (for routed access via `api.flaim.app/fantasy/*`) |
| `/fantasy/mcp` | non-POST | Returns `405` with `Allow: POST` |
| `/fantasy/mcp/r/:runId/t/:traceId` | POST | Eval-only traced MCP alias for routed access |
| `/fantasy/mcp/r/*` (malformed) | any | Returns `400` malformed eval route |

## MCP Tools

All tools take explicit parameters. Call `get_user_session` first in a normal chat to get league IDs and defaults. `get_league_info` is usually the second call for the selected league so team names, owner/team mapping, scoring, and roster-slot context are established before downstream league tools.

| Tool | Description |
|------|-------------|
| `get_user_session` | User's leagues across all platforms (call first) |
| `get_ancient_history` | Past seasons and historical leagues outside the current season |
| `get_league_info` | Baseline league context: settings, scoring, roster config, teams/owners |
| `get_standings` | League standings with records |
| `get_matchups` | Weekly matchups/scoreboard |
| `get_roster` | Team roster with player stats |
| `get_free_agents` | Available players; ESPN/Yahoo include ownership percentages, Sleeper returns identities without ownership percentages |
| `get_players` | Player lookup; ESPN and Yahoo can add league ownership, Sleeper ownership is unavailable |
| `get_transactions` | Recent transactions (adds, drops, waivers, trades) |

`get_transactions` uses platform-specific week semantics in v1: ESPN/Sleeper support explicit `week`, while Yahoo ignores explicit `week` and uses a recent 14-day timestamp window. Yahoo `type=waiver` filtering is intentionally unsupported in v1. ESPN responses include a `teams` map (team ID → display name) so the LLM can resolve numeric `team_ids` on each transaction to human-readable names. Player entries are enriched with name, position, and pro team.
`get_free_agents` returns platform-specific availability context: ESPN/Yahoo include ownership percentages and sort by ownership, while Sleeper returns available-player identities from the public player index without ownership percentages.
`get_players` always returns identity, but ownership context is platform-specific: ESPN and Yahoo include market/global ownership and may also include league ownership fields (`league_status`, `league_team_name`, `league_owner_name`); Sleeper returns identity with unavailable ownership context. If league ownership fields are absent, null, or unavailable, fall back to `get_league_info` + `get_roster`.

### Tool Parameters

```typescript
{
  platform: 'espn' | 'yahoo' | 'sleeper'; // Required
  sport: 'football' | 'baseball' | 'basketball' | 'hockey';
  league_id: string;             // From get_user_session
  season_year: number;           // e.g., 2024
  team_id?: string;              // Strongly recommended for roster queries; required on Yahoo
  week?: number;                 // For matchups; and transactions on ESPN/Sleeper (ignored by Yahoo transactions)
  type?: 'add' | 'drop' | 'trade' | 'waiver'; // Base transaction types; live tool metadata also supports ESPN lifecycle types and Yahoo pending_trade
  query?: string;                // For get_players (required when calling that tool)
  position?: string;             // For free agents filter
  count?: number;                // For free agents / get_players limits
}
```

## Authentication

Requires Bearer token in Authorization header. Tokens are:
- Clerk JWTs (from web app)
- OAuth tokens (from Claude/ChatGPT/Gemini)

Auth is validated by auth-worker via service binding.

## Development

```bash
# Run locally
npm run dev:fantasy-mcp  # Port 8790

# Or directly
cd workers/fantasy-mcp
wrangler dev --env dev --port 8790
```

## Production URLs

- **Custom route**: `https://api.flaim.app/mcp` (legacy alias: `https://api.flaim.app/fantasy/mcp`)
- **Workers.dev**: `https://fantasy-mcp.gerrygugger.workers.dev/mcp`
- **Transport behavior**: Streamable HTTP over POST with stream-mode responses (`text/event-stream`).
- **Eval-only traced route**: `https://api.flaim.app/mcp/r/<run_id>/t/<trace_id>` (legacy alias form also supported under `/fantasy/mcp/...`)
- **Auth/resource normalization**: OAuth metadata and auth validation remain scoped to the base MCP resource, not the traced eval route.

## Service Bindings

| Binding | Worker | Purpose |
|---------|--------|---------|
| `ESPN` | espn-client | ESPN API calls |
| `YAHOO` | yahoo-client | Yahoo Fantasy API calls |
| `SLEEPER` | sleeper-client | Sleeper API calls |
| `AUTH_WORKER` | auth-worker | Credentials and auth |

## Related

- [`espn-client`](../espn-client/) - ESPN platform worker
- [`sleeper-client`](../sleeper-client/) - Sleeper platform worker
- [`auth-worker`](../auth-worker/) - Authentication and credentials
- [Architecture docs](../../docs/ARCHITECTURE.md) - Full system design
