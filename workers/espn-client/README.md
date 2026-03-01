# ESPN Client Worker

Internal ESPN API client used by the unified gateway (`fantasy-mcp`). Handles all ESPN Fantasy sports data fetching.

> **Note**: Primarily called via service binding from `fantasy-mcp`. It also exposes onboarding endpoints used by the web app (manual ESPN setup).

## Purpose

Consolidates all ESPN API interactions for multiple sports into a single worker:
- Football handlers
- Baseball handlers
- Basketball handlers
- Hockey handlers

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
| `/onboarding/initialize` | POST | Initialize onboarding with league data (requires Authorization header) |
| `/onboarding/discover-seasons` | POST | Discover and save historical seasons (requires Authorization header) |

### `/execute` Request Format

```typescript
interface ExecuteRequest {
  tool: string;           // e.g., "get_league_info"
  params: {
    sport: 'football' | 'baseball' | 'basketball' | 'hockey';
    league_id: string;
    season_year: number;
    team_id?: string;
    week?: number;
    position?: string;
    count?: number;
    type?: string;        // Transaction type filter (add, drop, trade, waiver)
  };
  authHeader?: string;    // Bearer token for auth-worker
}
```

## Supported Tools

All four sports (football, baseball, basketball, hockey) support the same 7 tools:

- `get_league_info` - League settings and members
- `get_standings` - League standings
- `get_matchups` - Weekly matchups
- `get_roster` - Team roster with player stats
- `get_free_agents` - Available free agents
- `search_players` - Player lookup with market/global ownership context
- `get_transactions` - Recent transactions (adds, drops, waivers, trades)

### `get_transactions` Response Shape

The `get_transactions` response includes:
- **`transactions`**: Array of normalized transactions with enriched player entries (name, position, pro team) and numeric `team_ids`.
- **`teams`**: A `Record<string, string>` map of team ID → display name, so consumers can resolve `team_ids` to human-readable names.
- **`window`**: The week window used (`explicit_week` or `recent_two_weeks`).

Player enrichment uses ESPN's global `/players?view=players_wl` endpoint (public, no auth required). Team names come from the league's `mTeam` view.

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
| Football | `src/sports/football/mappings.ts` | [MAPPINGS.md](./src/sports/football/MAPPINGS.md) |
| Baseball | `src/sports/baseball/mappings.ts` | [MAPPINGS.md](./src/sports/baseball/MAPPINGS.md) |
| Basketball | `src/sports/basketball/mappings.ts` | — |
| Hockey | `src/sports/hockey/mappings.ts` | — |

### Standard mapping structure

Each sport's mappings.ts exports:

| Export | Purpose |
|--------|---------|
| `POSITION_MAP` | Player's natural position (`defaultPositionId` → name) |
| `LINEUP_SLOT_MAP` | Roster slot positions (`lineupSlotId` → name) |
| `PRO_TEAM_MAP` | Pro team abbreviations (`proTeamId` → abbrev) |
| `INJURY_STATUS_MAP` | Injury status display names |
| `POSITION_SLOTS` | Free agent filter groups (position → slot IDs) |
| `STATS_MAP` | Stat IDs to readable names (or split maps for baseball) |
| `getPositionName()` | Transform position ID with fallback |
| `getLineupSlotName()` | Transform slot ID with fallback |
| `getProTeamAbbrev()` | Transform team ID with fallback |
| `getInjuryStatus()` | Transform injury code |
| `transformEligiblePositions()` | Transform eligibleSlots array |
| `transformStats()` | Transform stats object keys to readable names |

**Stats organization differs by sport:**
- Football: Single `STATS_MAP` (players can have passing + rushing + receiving)
- Baseball: Split `BATTING_STATS_MAP` and `PITCHING_STATS_MAP` (players are typically one or the other)

### Adding a new sport

1. Create `src/sports/{sport}/mappings.ts` following the standard structure
2. Create `src/sports/{sport}/MAPPINGS.md` documenting the ID mappings and verification sources
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

- Consider adding Zod validation for `/execute` request body

## Related

- [`fantasy-mcp`](../fantasy-mcp/) - Unified MCP gateway that calls this worker
- [`auth-worker`](../auth-worker/) - Provides ESPN credentials

### Mapping Documentation

- [Football MAPPINGS.md](./src/sports/football/MAPPINGS.md) - ESPN Fantasy Football mapping notes
- [Baseball MAPPINGS.md](./src/sports/baseball/MAPPINGS.md) - ESPN Fantasy Baseball mapping notes
- Basketball and hockey mappings are in code only (sourced from `cwendt94/espn-api`, unverified pending live credentials)
