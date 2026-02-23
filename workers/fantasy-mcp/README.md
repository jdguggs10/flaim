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
| `/fantasy/mcp` | POST | Same (for routed access via `api.flaim.app/fantasy/*`) |
| `/fantasy/mcp` | non-POST | Returns `405` with `Allow: POST` |

## MCP Tools

All tools take explicit parameters. Call `get_user_session` first to get league IDs.

| Tool | Description |
|------|-------------|
| `get_user_session` | User's leagues across all platforms (call first) |
| `get_ancient_history` | Historical leagues and seasons (2+ years old) |
| `get_league_info` | League settings, scoring, roster config |
| `get_standings` | League standings with records |
| `get_matchups` | Weekly matchups/scoreboard |
| `get_roster` | Team roster with player stats |
| `get_free_agents` | Available free agents |
| `get_transactions` | Recent transactions (adds, drops, waivers, trades) |

`get_transactions` uses platform-specific week semantics in v1: ESPN/Sleeper support explicit `week`, while Yahoo ignores explicit `week` and uses a recent 14-day timestamp window. Yahoo `type=waiver` filtering is intentionally unsupported in v1.

### Tool Parameters

```typescript
{
  platform: 'espn' | 'yahoo' | 'sleeper'; // Required
  sport: 'football' | 'baseball' | 'basketball' | 'hockey';
  league_id: string;             // From get_user_session
  season_year: number;           // e.g., 2024
  team_id?: string;              // For roster queries
  week?: number;                 // For matchups; and transactions on ESPN/Sleeper (ignored by Yahoo transactions)
  type?: 'add' | 'drop' | 'trade' | 'waiver'; // For transactions (Yahoo "waiver" unsupported in v1)
  position?: string;             // For free agents filter
  count?: number;                // For free agents limit
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
