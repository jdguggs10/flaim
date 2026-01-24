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
- `get_free_agents` - Available free agents

### Baseball
- `get_league_info` - League settings and members
- `get_standings` - League standings
- `get_matchups` - Weekly matchups
- `get_roster` - Team roster with player stats
- `get_free_agents` - Available free agents

## Mappings Architecture

Each sport has a dedicated `mappings.ts` file that transforms ESPN's internal numeric IDs into human-readable names. This is a **deliberate design choice for consistency** across all sports.

### Why mappings exist

ESPN Fantasy APIs use internal numeric IDs for positions, teams, roster slots, and stats. These IDs:
- Don't match public ESPN API IDs
- Don't match league-specific IDs (NFL, MLB, etc.)
- Use different ID spaces for player positions vs roster slots

### Per-sport mapping files

| Sport | File | Documentation |
|-------|------|---------------|
| Football | `src/sports/football/mappings.ts` | [FOOTBALL_MAPPINGS.md](./FOOTBALL_MAPPINGS.md) |
| Baseball | `src/sports/baseball/mappings.ts` | [BASEBALL_MAPPINGS.md](./BASEBALL_MAPPINGS.md) |

### Standard mapping structure

Each sport's mappings.ts exports:

| Export | Purpose |
|--------|---------|
| `POSITION_MAP` | Player's natural position (`defaultPositionId` → name) |
| `LINEUP_SLOT_MAP` | Roster slot positions (`lineupSlotId` → name) |
| `PRO_TEAM_MAP` | Pro team abbreviations (`proTeamId` → abbrev) |
| `INJURY_STATUS_MAP` | Injury status display names |
| `POSITION_SLOTS` | Free agent filter groups (position → slot IDs) |
| `getPositionName()` | Transform position ID with fallback |
| `getLineupSlotName()` | Transform slot ID with fallback |
| `getProTeamAbbrev()` | Transform team ID with fallback |
| `getInjuryStatus()` | Transform injury code |
| `transformEligiblePositions()` | Transform eligibleSlots array |

Baseball additionally exports stat mappings (`BATTING_STATS_MAP`, `PITCHING_STATS_MAP`, `transformStats()`).

### Adding a new sport

When adding basketball or hockey:
1. Create `src/sports/{sport}/mappings.ts` following the standard structure
2. Create `{SPORT}_MAPPINGS.md` documenting the ID mappings and verification sources
3. Add handlers in `src/sports/{sport}/handlers.ts`

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

### Mapping Documentation

- [`FOOTBALL_MAPPINGS.md`](./FOOTBALL_MAPPINGS.md) - ESPN Fantasy Football mapping notes
- [`BASEBALL_MAPPINGS.md`](./BASEBALL_MAPPINGS.md) - ESPN Fantasy Baseball mapping notes
