# Sleeper Client Worker

Internal Sleeper fantasy API client used by the unified gateway (`fantasy-mcp`). Handles all Sleeper fantasy sports data fetching for NFL and NBA leagues.

> **Note**: Primarily called via service binding from `fantasy-mcp`. Sleeper's API is entirely public — no OAuth or API key is required.

## Purpose

Consolidates all Sleeper API interactions for supported sports into a single worker:
- Football (NFL) handlers ✅
- Basketball (NBA) handlers ✅

## Architecture

```
fantasy-mcp (gateway)
     |
     v (service binding)
sleeper-client
     |
     +---> Sleeper API (api.sleeper.app/v1 — public, no auth)
     +---> auth-worker (user lookup via service binding)
```

## Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/execute` | POST | Execute tool (internal only) |

### `/execute` Request Format

```typescript
interface ExecuteRequest {
  tool: string;        // e.g., "get_league_info"
  params: {
    sport: 'football' | 'basketball';
    league_id: string; // Sleeper league ID (numeric string)
    season_year: number;
    team_id?: string;  // Sleeper roster/user ID within the league
    week?: number;
  };
}
```

`/execute` requires `X-Flaim-Internal-Token` for internal calls.

## Supported Tools

### Football (NFL)
- `get_league_info` — League settings and members
- `get_standings` — League standings (computed from roster settings: wins, losses, ties, points)
- `get_roster` — Team roster with player details
- `get_matchups` — Weekly matchups (paired by `matchup_id`)
- `get_free_agents` — Available free agents (uses KV-backed player index cache)
- `get_players` — Player lookup with ownership unavailable semantics (`market_percent_owned: null`, `ownership_scope: "unavailable"`)
- `get_transactions` — Recent transactions with player name/position enrichment

### Basketball (NBA)
- `get_league_info` — League settings and members
- `get_standings` — League standings (computed from roster settings: wins, losses, ties, points)
- `get_roster` — Team roster with player details
- `get_matchups` — Weekly matchups (paired by `matchup_id`)
- `get_free_agents` — Available free agents (uses KV-backed player index cache)
- `get_players` — Player lookup with ownership unavailable semantics (`market_percent_owned: null`, `ownership_scope: "unavailable"`)
- `get_transactions` — Recent transactions with player name/position enrichment

## Roster/Matchup Player Enrichment and Team Names

`get_roster` (current and historical) and `get_matchups` resolve Sleeper's bare player-ID strings into enriched entries using the same KV-backed player index described below:
- Current roster (`starters`, `bench`, `reserve`, `taxi`) and matchups (`starters`, per side): index hit → `{ id, name, position, team }` (`team` omitted when the record has none).
- Historical week roster (`starters`, `bench` — reserve/taxi classification isn't available historically): index hit → `{ id, name, position }`, **never** `team`. The player index only tracks each player's CURRENT club, so a past-week roster omits `team` rather than risk showing a club the player joined after that week; `limitations.playerProTeamAvailable: false` marks this explicitly alongside the existing `reserveAndTaxiClassificationAvailable: false`.
- Sleeper's `"0"` empty-lineup-slot sentinel: `{ id: "0", empty: true }` — no lookup is attempted.
- Unknown ID or an unavailable player index: `{ id }` only — array order and length are always preserved, and the request never fails because of enrichment.
- When the player index is unavailable, the response still succeeds and adds a top-level `warnings: string[]` explaining player names/positions are unavailable for that call.

`get_league_info`, `get_standings`, `get_roster`, and `get_matchups` all add `teamName` alongside the existing `ownerName`. Unlike ESPN/Yahoo, Sleeper only exposes a manager-set fantasy team name via `users[].metadata.team_name`; `teamName` is present only when the manager actually set one — it is never fabricated as a fallback.

## Player Cache (KV)

`get_free_agents`, `get_transactions`, `get_roster`, and `get_matchups` enrichment all use a shared KV-backed player index (`SLEEPER_PLAYERS_CACHE`):
- Fetches `GET /v1/players/{sport}` (NFL or NBA) on cache miss.
- Caches every player Sleeper returns (active and inactive, with an `active` flag) for 24 hours; only `get_free_agents` filters to active players, so rostered IR/retired players still resolve to names.
- Cache key format: `players:{sport}:v1`.
- Falls back to in-memory cache if the KV binding is unavailable.
- Gracefully degrades: if the player index fails, transactions still return player IDs, `get_free_agents` returns an empty list with a `warning` field, and `get_roster`/`get_matchups` return `{ id }`-only entries with a top-level `warnings` array.

## Sleeper API Notes

- **Public API**: No authentication is required. All endpoints are open (no API key, no OAuth).
- **No standings endpoint**: Sleeper does not expose a dedicated standings endpoint. Standings are computed from each roster's `settings` (wins, losses, ties, fpts) which Sleeper keeps current.
- **Matchup pairing**: Matchup results are returned as a flat list; opponents are paired by matching `matchup_id` values.
- **Username-based onboarding**: Users connect via Sleeper username. The worker resolves the username to a numeric `sleeper_user_id` via `GET /user/{username}`.
- **Historical season discovery**: Onboarding discovers up to 5 years of past leagues via the Sleeper user leagues endpoint.
- **Base URL**: `https://api.sleeper.app/v1`

## Development

```bash
# Run locally from the repository root (port 8792)
corepack pnpm --dir workers/sleeper-client run dev

# Or directly
corepack pnpm --dir workers/sleeper-client exec wrangler dev --env dev --port 8792

# Run tests
corepack pnpm --dir workers/sleeper-client run test

# Type check
corepack pnpm --dir workers/sleeper-client run type-check
```

## Related

- [`fantasy-mcp`](../fantasy-mcp/) — Unified MCP gateway that calls this worker
- [`auth-worker`](../auth-worker/) — Provides user identity lookup (Sleeper connections stored here)
- [`espn-client`](../espn-client/) — Parallel ESPN client worker
- [`yahoo-client`](../yahoo-client/) — Parallel Yahoo client worker
