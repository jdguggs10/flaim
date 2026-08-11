# ESPN Client Worker

Internal ESPN API client used by the unified gateway (`fantasy-mcp`). Handles all ESPN Fantasy sports data fetching.

> **Note**: Primarily called via service binding from `fantasy-mcp`. It exposes only the internal `/execute` contract plus `/health`.

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

### `/execute` Request Format

```typescript
interface ExecuteRequest {
  tool: string;           // e.g., "get_league_info"
  params: {
    sport: 'football' | 'baseball' | 'basketball' | 'hockey';
    league_id: string;
    season_year: number;  // canonical start year (e.g., 2024 for the 2024-25 NBA season)
    team_id?: string;
    week?: number;        // Public matchup period for get_transactions (0 = preseason)
    position?: string;
    count?: number;
    type?: string;        // Transaction type filter; the activity-feed fallback rejects structured-only types
  };
}
```

`/execute` reads end-user auth from the HTTP `Authorization` header and requires `X-Flaim-Internal-Token` for internal calls. ESPN setup uses the Flaim Chrome extension; credential sync flows through the web and auth-worker layers, not public ESPN worker routes.

**Season year convention:** Callers always pass canonical start-year (e.g., 2024 for the 2024-25 NBA season). `/execute` preserves that external `params.season_year` value and adds explicit internal season context before dispatching to handlers. ESPN uses end-year for basketball and hockey (e.g., 2025 for 2024-25); football and baseball are unchanged.

**Handler contract:** Routed handlers receive canonical request params plus explicit season context:

```typescript
interface RoutedToolParams extends ToolParams {
  seasonContext: {
    canonicalYear: number; // same value as params.season_year
    espnYear: number;      // ESPN-native year for API calls
  };
}
```

Handlers should use `params.seasonContext.espnYear` for ESPN URLs, cache keys, and ESPN stat-season matches, while keeping `params.season_year` / `params.seasonContext.canonicalYear` for outward-facing logic and season-phase comparisons. For cross-calendar sports, outward `get_league_info` year fields such as `seasonId` and `status.previousSeasons` should stay canonical even though ESPN returns end-year values. Production callers should route through `/execute`; direct tests should add `seasonContext` explicitly with `withSeasonContext()`.

## Supported Tools

All four sports (football, baseball, basketball, hockey) support the same 7 tools:

- `get_league_info` - League settings and members
- `get_standings` - League standings
- `get_matchups` - Weekly matchups
- `get_roster` - Team roster with player stats
- `get_free_agents` - Available free agents
- `get_players` - Player lookup with market/global ownership context
- `get_transactions` - Recent league transactions (adds, drops, waivers, trades, failed bids, trade lifecycle) from the structured primary source with an activity-feed fallback

### ESPN Period Fields

ESPN exposes both `scoringPeriodId` and `currentMatchupPeriod`. Treat `currentMatchupPeriod` as the current fantasy matchup/week when normalizing standings or defaulting `get_matchups`; `scoringPeriodId` can be daily for sports such as baseball and may be much larger than the weekly matchup period.

When callers pass an explicit `week`, use it. Otherwise prefer `currentMatchupPeriod` from the league response or `status.currentMatchupPeriod`, then fall back to `scoringPeriodId`.

### Roster Snapshots (`get_roster`)

`get_roster` consumes a normalized snapshot request instead of a raw `week`. Football maps `week` directly to `scoringPeriodId` (one NFL week per scoring period). Daily sports (baseball/basketball/hockey) take an `as_of_date` instead: a matchup week is *not* a scoring period there — scoring periods are calendar days — so a `week` selector fails closed with a corrective error rather than silently returning a months-old roster.

Dates resolve through `shared/scoring-period.ts`: the public `proTeamSchedules_wl` season calendar is fetched once per sport+season (ESPN-native year), validated to have a constant Eastern-time day-offset between calendar date and `scoringPeriodId` across every game-bearing period, and cached as a three-field anchor. Resolution is then pure arithmetic, so off-days (e.g. the All-Star break) resolve without a game entry; out-of-season dates and any invariant violation fail closed. Historical responses include the resolved `providerScoringPeriodId` as diagnostic metadata plus `acquisitionMetadataAvailable: false` when ESPN's older snapshots omit acquisition type/date (observed on snapshots more than a few days old).

For current ESPN seasons, derive `seasonPhase` from matchup context before trusting final-rank-like fields. Fields such as `rankFinal` and `rankCalculatedFinal` prove season completion for historical seasons, but active leagues can expose them before live play is complete. Keep outcome fields such as `finalRank`, `championshipWon`, and `playoffOutcome` null unless `seasonComplete` is true.

When a completed season's championship game is marked `TIE` (or `UNDECIDED`), the champion is resolved from the league's `playoffMatchupTieRule` setting: `NONE` (ESPN's platform default) advances the higher playoff seed, and `HOME_TEAM_WINS` advances the home team. Any other rule, or missing/equal seeds, leaves the outcome null. These results keep `outcomeConfidence: 'derived'` because league managers can manually override brackets via ESPN's Edit Playoffs page, so a rule-based resolution is not guaranteed to match what actually happened.

### `get_transactions` Response Shape

The `get_transactions` response includes:
- **`transactions`**: Array of normalized transactions with enriched player entries (name, position, pro team) and numeric `team_ids`.
- **`teams`**: A `Record<string, string>` map of team ID → display name, so consumers can resolve `team_ids` to human-readable names.
- **`window`**: Matchup-period semantics plus the exact underlying provider scoring periods, Eastern-time date bounds when available, and any legacy scoring-period normalization.
- **`source`**: `mTransactions2` (structured primary), `mTransactions2_with_activity_trade_details` (structured rows whose trade sides were filled from the activity feed), or `activity_feed` (fallback).
- **`limitations`**: `structured_details_incomplete` appears only when trade detail is actually incomplete or the activity-feed fallback served the rows; activity-sourced responses also count rows omitted because their scope was missing or contradictory.
- **`truncated`**: `true` when the caller's count cap cut results, or — on the activity fallback — when the operation deadline or eight-page cap prevented proof that the full requested window was covered.

The public `week` selector always means an ESPN matchup period. This matters for baseball, basketball, and hockey, where one matchup normally spans several daily scoring periods. Omitting `week` selects the current and previous matchup periods; `0` explicitly selects preseason. A narrowly bounded compatibility shim recognizes a daily scoring-period value only when it cannot be a usable current/historical matchup, is not any known future matchup in ESPN's schedule, and maps uniquely to one.

Daily matchup membership comes from the keys in each `mMatchupScore` schedule side's `pointsByScoringPeriod` object. Those are the scoring days ESPN actually assigned to the matchup, including extended periods such as baseball's All-Star matchup. Do not use `scheduleSettings.matchupPeriods` as this map: that field groups weekly/playoff periods and its values are not daily scoring IDs. If ESPN has not posted a score key for the current day yet, the validated current `scoringPeriodId` is added only to the current matchup.

The structured `mTransactions2` view is the primary source. Its transport sends only the minimal `filterType` fantasy-filter: ESPN returns HTTP 400 for any filter carrying `limit`/`offset` (with or without sort fields), and the view exposes no pagination — each pinned scoring period returns ESPN's full result set for that period in one request. Structured rows carry failed bids, FAAB amounts, trade proposal/decline/veto/uphold lifecycle states, and — when movement items are complete — directional `trade_sides`; trades missing directional detail are filled from the activity feed. Any structured failure (including partial window coverage) falls back entirely to the activity feed rather than serving silent gaps.

The activity feed (`kona_league_communication`) is the fallback source. Rows are included only when message/topic evidence, or a daily-sport Eastern-time timestamp fallback, proves membership in the requested matchup window. Conflicting or unscoped rows are omitted and counted. Activity data cannot prove failed bids, FAAB amounts, or lifecycle states, so on the fallback those explicit filters fail with `ESPN_TRANSACTION_TYPE_UNAVAILABLE` rather than returning a misleading empty result. Player enrichment uses ESPN's public global `/players?view=players_wl` endpoint, and team names come from `mTeam`.

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
# Run locally from the repository root
corepack pnpm --dir workers/espn-client run dev  # Port 8789

# Or directly
corepack pnpm --dir workers/espn-client exec wrangler dev --env dev --port 8789
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
