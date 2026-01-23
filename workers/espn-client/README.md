# ESPN Client Worker

Internal ESPN API client used by the unified gateway (`fantasy-mcp`). Handles all ESPN Fantasy sports data fetching.

> **Note**: This worker is called via service binding from `fantasy-mcp`. It has no public custom route.

## Purpose

Consolidates all ESPN API interactions for multiple sports into a single worker:
- Football handlers
- Baseball handlers
- (Future: Basketball, Hockey)

## Architecture

```
fantasy-mcp (gateway)
     |
     v (service binding)
espn-client
     |
     +---> ESPN API (lm-api-reads.fantasy.espn.com)
     +---> auth-worker (credentials via service binding)
```

## Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/execute` | POST | Execute tool (internal only) |

### `/execute` Request Format

```typescript
interface ExecuteRequest {
  tool: string;           // e.g., "get_league_info"
  params: {
    sport: 'football' | 'baseball';
    league_id: string;
    season_year: number;
    team_id?: string;
    week?: number;
    position?: string;
    count?: number;
  };
  authHeader?: string;    // Bearer token for auth-worker
}
```

## Supported Tools

### Football
- `get_league_info` - League settings and members
- `get_standings` - League standings
- `get_matchups` - Weekly matchups
- `get_roster` - Team roster with player stats

### Baseball
- `get_league_info` - League settings and members
- `get_standings` - League standings
- `get_matchups` - Weekly matchups
- `get_roster` - Team roster with player stats
- `get_free_agents` - Available free agents

## Development

```bash
# Run locally
npm run dev:espn-client  # Port 8789

# Or directly
cd workers/espn-client
wrangler dev --env dev --port 8789
```

## Tech Debt

- ESPN API responses use `as any` typing (see TODO in `src/types.ts`)
- Consider adding Zod validation for `/execute` request body

## Related

- [`fantasy-mcp`](../fantasy-mcp/) - Unified MCP gateway that calls this worker
- [`auth-worker`](../auth-worker/) - Provides ESPN credentials
- [`BASEBALL_MAPPINGS`](./BASEBALL_MAPPINGS.md) - ESPN Fantasy Baseball mapping notes (IDs, verification, rationale)
