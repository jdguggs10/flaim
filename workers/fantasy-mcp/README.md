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
| `/` | GET/HEAD | API metadata response for `api.flaim.app` root |
| `/health` | GET | Health check with binding status |
| `/fantasy/health` | GET | Same (for routed access) |
| `/.well-known/oauth-protected-resource` | GET | OAuth metadata (RFC 9728) |
| `/mcp` | POST | MCP protocol endpoint |
| `/mcp` | non-POST | Returns `405` with `Allow: POST` |
| `/fantasy/mcp` | POST | Same (for routed access via `api.flaim.app/fantasy/*`) |
| `/fantasy/mcp` | non-POST | Returns `405` with `Allow: POST` |

## MCP Tools

All tools take explicit parameters. Call `get_user_session` first in a normal chat to get league IDs and defaults. `get_league_info` is usually the second call for the selected league so team names, owner/team mapping, scoring, and roster-slot context are established before downstream league tools.

Most tools are read-only analysis calls. `refresh_leagues` requires `mcp:write` because it can add or update Flaim league records after provider discovery, but it never makes roster moves, trades, drops, or lineup changes.

| Tool | Description |
|------|-------------|
| `get_user_session` | User's leagues across all platforms (call first) |
| `refresh_leagues` | Re-discover connected leagues and update Flaim's league records |
| `get_ancient_history` | Past seasons and historical leagues outside the current season |
| `get_league_info` | Baseline league context: settings, scoring, roster config, teams/owners |
| `get_standings` | League standings with records |
| `get_matchups` | Weekly matchups/scoreboard |
| `get_roster` | Team roster with player stats — current by default, historical via `week` or `as_of_date` |
| `get_free_agents` | Available players; ESPN/Yahoo include ownership percentages, Sleeper returns identities without ownership percentages |
| `get_players` | Player lookup; ESPN and Yahoo can add league ownership, Sleeper ownership is unavailable |
| `get_transactions` | Recent transactions (adds, drops, waivers, trades) |

`get_roster` returns the current roster when no selector is passed. Historical snapshots take exactly one selector, validated against a per-(platform, sport) capability map: `week` for football on every platform and for Sleeper basketball (matchup week/leg), `as_of_date` (`YYYY-MM-DD`, calendar-valid) for ESPN and Yahoo baseball/basketball/hockey, whose provider rosters are daily. Wrong or conflicting selectors return a corrective `INVALID_ROSTER_SNAPSHOT_SELECTOR` error before any provider call, with one deliberate exception — published-client compatibility (FLA-209): a well-formed `week` (positive integer, no `as_of_date`) on an ESPN/Yahoo daily sport returns the current roster instead of an error, because clients pinned to an older tool schema (where `week` was valid for every sport) can only send `week`. The response's `snapshot` block then carries `requested_week` and a human-readable `note` stating the selector was ignored and that this sport tracks roster history by date — never silently. This compatibility behavior must remain until no published client depends on the week-for-daily-sports request shape. Valid input is normalized to an internal snapshot object that platform workers consume; raw ESPN `scoringPeriodId` is never part of the public contract (it appears only as `providerScoringPeriodId` diagnostic metadata). Every roster response carries a `snapshot` block (`type: current | week | date`), and historical responses may add limitation flags: `acquisitionMetadataAvailable: false` when ESPN's older snapshots omit acquisition data, `reserveAndTaxiClassificationAvailable: false` for Sleeper weekly history (membership is complete; IR/taxi classification is not recoverable).
`get_transactions` uses platform-specific week semantics in v1: ESPN/Sleeper support explicit `week`, while Yahoo ignores explicit `week` and uses a recent 14-day timestamp window. Yahoo `type=waiver` filtering is intentionally unsupported in v1. ESPN responses include a `teams` map (team ID → display name) so the LLM can resolve numeric `team_ids` on each transaction to human-readable names. Player entries are enriched with name, position, and pro team.
`get_free_agents` returns platform-specific availability context: ESPN/Yahoo include ownership percentages and sort by ownership, while Sleeper returns available-player identities from the public player index without ownership percentages.
`get_players` always returns identity, but ownership context is platform-specific: ESPN and Yahoo include market/global ownership and may also include league ownership fields (`league_status`, `league_team_name`, `league_owner_name`); Sleeper returns identity with unavailable ownership context. If league ownership fields are absent, null, or unavailable, fall back to `get_league_info` + `get_roster`.
Retryable platform errors preserve `status`, `retryable`, and `retry_after` metadata in tool `structuredContent` and in the `_meta` compatibility extension. Flaim intentionally emits `_meta` only when metadata is present so clients that read retry hints can use it while plain MCP clients can ignore it. Yahoo rate limits and transient token-refresh contention should be retried after the provided delay instead of treated as a reconnect prompt.
Recurring seasons are grouped by stable league identity before active/history selection. Yahoo derives that from the stable league ID inside `league_key`; Sleeper uses auth-worker's `recurringLeagueId`, which is computed from Sleeper's `previous_league_id` chain while keeping the season-specific `leagueId` intact for direct calls.

### Tool Parameters

```typescript
{
  platform: 'espn' | 'yahoo' | 'sleeper'; // Required
  sport: 'football' | 'baseball' | 'basketball' | 'hockey';
  league_id: string;             // From get_user_session
  season_year: number;           // e.g., 2024
  team_id?: string;              // Strongly recommended for roster queries; required on Yahoo and for historical Sleeper rosters
  week?: number;                 // For matchups; transactions on ESPN/Sleeper; historical get_roster on football (all platforms) + Sleeper basketball. On ESPN/Yahoo daily sports, get_roster week is ignored (current roster + snapshot note) for published-client compatibility
  as_of_date?: string;           // Historical get_roster on ESPN/Yahoo daily sports (YYYY-MM-DD); at most one of week/as_of_date
  type?: 'add' | 'drop' | 'trade' | 'waiver'; // Base transaction types; live tool metadata also supports ESPN lifecycle types and Yahoo pending_trade
  query?: string;                // For get_players (required when calling that tool)
  position?: string;             // For free agents filter
  count?: number;                // For free agents / get_players limits
}
```

## Authentication

Tool calls and user data require a Bearer token in the Authorization header. Tokens are:
- Clerk JWTs (from web app)
- OAuth tokens (from Claude/ChatGPT/Gemini)

Auth is validated by auth-worker via service binding. The MCP handshake and discovery methods (`initialize`, `notifications/initialized`, `tools/list`, `resources/list`) and the two static widget template resources are intentionally public so clients can complete discovery before user auth.

## Development

```bash
# Run locally from the repository root
corepack pnpm --dir workers/fantasy-mcp run dev  # Port 8790

# Or directly
corepack pnpm --dir workers/fantasy-mcp exec wrangler dev --env dev --port 8790
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
