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
     +---> Sleeper API (api.sleeper.com — public, no auth)
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
  authHeader?: string; // Bearer token forwarded to auth-worker for user lookup
}
```

## Supported Tools

### Football (NFL)
- `get_league_info` — League settings and members
- `get_standings` — League standings (computed from matchup win/loss records)
- `get_roster` — Team roster with player details
- `get_matchups` — Weekly matchups (paired by `matchup_id`)

### Basketball (NBA)
- `get_league_info` — League settings and members
- `get_standings` — League standings (computed from matchup win/loss records)
- `get_roster` — Team roster with player details
- `get_matchups` — Weekly matchups (paired by `matchup_id`)

## Sleeper API Notes

- **Public API**: No authentication is required. All endpoints are open (no API key, no OAuth).
- **No standings endpoint**: Sleeper does not expose a dedicated standings endpoint. Standings are computed by fetching all matchups across completed weeks and tallying wins/losses/points.
- **Matchup pairing**: Matchup results are returned as a flat list; opponents are paired by matching `matchup_id` values.
- **Username-based onboarding**: Users connect via Sleeper username. The worker resolves the username to a numeric `sleeper_user_id` via `GET /user/{username}`.
- **Historical season discovery**: Onboarding discovers up to 5 years of past leagues via the Sleeper user leagues endpoint.
- **Base URL**: `https://api.sleeper.app/v1`

## Development

```bash
# Run locally (port 8792)
npm run dev

# Or directly
cd workers/sleeper-client
wrangler dev --env dev --port 8792

# Run tests
npm test

# Type check
npm run type-check
```

## Related

- [`fantasy-mcp`](../fantasy-mcp/) — Unified MCP gateway that calls this worker
- [`auth-worker`](../auth-worker/) — Provides user identity lookup (Sleeper connections stored here)
- [`espn-client`](../espn-client/) — Parallel ESPN client worker
- [`yahoo-client`](../yahoo-client/) — Parallel Yahoo client worker
