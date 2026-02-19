# Sleeper Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Sleeper as a third fantasy platform with 4 MCP tools (get_league_info, get_standings, get_roster, get_matchups) for NFL and NBA.

**Architecture:** New `sleeper-client` Cloudflare Worker following the ESPN/Yahoo client pattern. Service binding from fantasy-mcp gateway. League storage in Supabase via auth-worker. Username-based onboarding (no credentials needed — Sleeper API is public).

**Tech Stack:** Hono, TypeScript, Cloudflare Workers, Supabase, Vitest

**Design doc:** `docs/plans/2026-02-19-sleeper-integration-design.md`

---

### Task 1: Scaffold sleeper-client Worker

**Files:**
- Create: `workers/sleeper-client/package.json`
- Create: `workers/sleeper-client/tsconfig.json`
- Create: `workers/sleeper-client/wrangler.jsonc`
- Create: `workers/sleeper-client/vitest.config.ts`
- Create: `workers/sleeper-client/wrangler.test.jsonc`

**Step 1: Create `workers/sleeper-client/package.json`**

```json
{
  "name": "sleeper-client",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "WRANGLER_LOG_PATH=../../.wrangler/logs WRANGLER_REGISTRY_PATH=../../.wrangler/registry wrangler dev --env dev --port 8792",
    "deploy:dev": "wrangler deploy --env dev",
    "deploy:preview": "wrangler deploy --env preview",
    "deploy:prod": "wrangler deploy --env prod",
    "test": "vitest run",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@flaim/worker-shared": "*",
    "hono": "^4.7.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.7.0",
    "@cloudflare/workers-types": "^4.0.0",
    "typescript": "^5.7.0",
    "vitest": "~3.0.0",
    "wrangler": "^4.53.0"
  }
}
```

**Step 2: Create `workers/sleeper-client/tsconfig.json`**

Copy from `workers/yahoo-client/tsconfig.json` — identical content.

**Step 3: Create `workers/sleeper-client/wrangler.jsonc`**

```jsonc
{
  "name": "sleeper-client",
  "main": "src/index.ts",
  "compatibility_date": "2024-12-01",
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1,
    "logs": {
      "enabled": true,
      "head_sampling_rate": 1,
      "persist": true,
      "invocation_logs": true
    }
  },
  "env": {
    "prod": {
      "name": "sleeper-client",
      "workers_dev": true,
      "services": [
        { "binding": "AUTH_WORKER", "service": "auth-worker" }
      ],
      "vars": {
        "NODE_ENV": "production",
        "ENVIRONMENT": "prod",
        "AUTH_WORKER_URL": "https://auth-worker.gerrygugger.workers.dev"
      }
    },
    "preview": {
      "name": "sleeper-client-preview",
      "workers_dev": true,
      "services": [
        { "binding": "AUTH_WORKER", "service": "auth-worker-preview" }
      ],
      "vars": {
        "NODE_ENV": "production",
        "ENVIRONMENT": "preview",
        "AUTH_WORKER_URL": "https://auth-worker-preview.gerrygugger.workers.dev"
      }
    },
    "dev": {
      "name": "sleeper-client-dev",
      "workers_dev": true,
      "services": [
        { "binding": "AUTH_WORKER", "service": "auth-worker-dev" }
      ],
      "vars": {
        "NODE_ENV": "development",
        "ENVIRONMENT": "dev",
        "AUTH_WORKER_URL": "http://localhost:8786"
      }
    }
  }
}
```

**Step 4: Create `workers/sleeper-client/vitest.config.ts`**

```typescript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.test.jsonc' },
      },
    },
  },
});
```

**Step 5: Create `workers/sleeper-client/wrangler.test.jsonc`**

```jsonc
{
  "name": "sleeper-client-test",
  "main": "src/index.ts",
  "compatibility_date": "2024-12-01"
}
```

**Step 6: Install dependencies**

Run: `cd workers/sleeper-client && npm install`

**Step 7: Commit**

```bash
git add workers/sleeper-client/
git commit -m "chore: scaffold sleeper-client worker"
```

---

### Task 2: Core Types and Sleeper API Wrapper

**Files:**
- Create: `workers/sleeper-client/src/types.ts`
- Create: `workers/sleeper-client/src/shared/sleeper-api.ts`
- Create: `workers/sleeper-client/src/logging.ts`

**Step 1: Create `workers/sleeper-client/src/types.ts`**

```typescript
import type { BaseEnvWithAuth } from '@flaim/worker-shared';

export interface Env extends BaseEnvWithAuth {
  // Sleeper API is public — no extra bindings needed beyond auth-worker (for league storage)
}

export type Sport = 'football' | 'basketball';

export interface ExecuteRequest {
  tool: string;
  params: ToolParams;
  authHeader?: string;
}

export interface ToolParams {
  sport: Sport;
  league_id: string;      // Sleeper league_id (numeric string, e.g., "289646328504385536")
  season_year: number;
  team_id?: string;        // roster_id as string (e.g., "1")
  week?: number;
  position?: string;
  count?: number;
}

export type { ExecuteResponse } from '@flaim/worker-shared';

// --- Sleeper API response shapes ---

export interface SleeperUser {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  sport: string;               // "nfl" or "nba"
  season: string;              // e.g., "2025"
  status: string;              // "pre_draft" | "drafting" | "in_season" | "complete"
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  settings: Record<string, unknown>;
  previous_league_id: string | null;
  draft_id: string;
  avatar: string | null;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
    waiver_position?: number;
    waiver_budget_used?: number;
    total_moves?: number;
  };
}

export interface SleeperMatchup {
  roster_id: number;
  matchup_id: number;
  points: number;
  custom_points: number | null;
  players: string[] | null;
  starters: string[] | null;
  players_points: Record<string, number> | null;
  starters_points: number[] | null;
}

export interface SleeperLeagueUser {
  user_id: string;
  display_name: string;
  avatar: string | null;
  metadata?: Record<string, unknown>;
}

export interface SleeperState {
  week: number;
  season_type: string;
  season: string;
  display_week: number;
  league_season: string;
}
```

**Step 2: Create `workers/sleeper-client/src/shared/sleeper-api.ts`**

```typescript
const SLEEPER_BASE_URL = 'https://api.sleeper.app/v1';

interface SleeperFetchOptions {
  timeout?: number;
}

/**
 * Make a request to the Sleeper API (public, no auth needed)
 */
export async function sleeperFetch(
  path: string,
  options: SleeperFetchOptions = {}
): Promise<Response> {
  const { timeout = 10000 } = options;
  const url = `${SLEEPER_BASE_URL}${path}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    console.log(`[sleeper-api] Fetching: ${path}`);
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'flaim-sleeper-client/1.0',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('SLEEPER_TIMEOUT: Request timed out');
    }
    throw error;
  }
}

/**
 * Handle Sleeper API error responses
 */
export function handleSleeperError(response: Response): never {
  switch (response.status) {
    case 404:
      throw new Error('SLEEPER_NOT_FOUND: League or resource not found');
    case 429:
      throw new Error('SLEEPER_RATE_LIMIT: Too many requests. Please wait.');
    case 400:
      throw new Error('SLEEPER_BAD_REQUEST: Invalid request');
    default:
      throw new Error(`SLEEPER_API_ERROR: Sleeper returned ${response.status}`);
  }
}

/**
 * Map Sleeper sport string to Flaim canonical sport
 */
export function sleeperSportToFlaim(sport: string): string {
  switch (sport) {
    case 'nfl': return 'football';
    case 'nba': return 'basketball';
    default: return sport;
  }
}

/**
 * Map Flaim canonical sport to Sleeper sport string
 */
export function flaimSportToSleeper(sport: string): string {
  switch (sport) {
    case 'football': return 'nfl';
    case 'basketball': return 'nba';
    default: return sport;
  }
}
```

**Step 3: Create `workers/sleeper-client/src/logging.ts`**

```typescript
interface TraceLogEvent {
  service: 'sleeper-client';
  phase: 'execute_start' | 'execute_end' | 'execute_error';
  correlation_id?: string;
  run_id?: string;
  trace_id?: string;
  tool?: string;
  sport?: string;
  league_id?: string;
  status?: string;
  duration_ms?: number;
  message?: string;
  error?: string;
}

/**
 * Structured eval logging for Cloudflare Observability filtering.
 */
export function logEvalEvent(event: TraceLogEvent): void {
  if (!event.trace_id && !event.run_id) {
    return;
  }
  console.log(JSON.stringify(event));
}
```

**Step 4: Commit**

```bash
git add workers/sleeper-client/src/
git commit -m "feat(sleeper): add core types, API wrapper, and logging"
```

---

### Task 3: Football Handlers + Mappings

**Files:**
- Create: `workers/sleeper-client/src/sports/football/mappings.ts`
- Create: `workers/sleeper-client/src/sports/football/handlers.ts`

**Step 1: Create `workers/sleeper-client/src/sports/football/mappings.ts`**

```typescript
// Sleeper NFL position abbreviations
export const POSITION_MAP: Record<string, string> = {
  'QB': 'Quarterback',
  'RB': 'Running Back',
  'WR': 'Wide Receiver',
  'TE': 'Tight End',
  'K': 'Kicker',
  'DEF': 'Defense/Special Teams',
  'DL': 'Defensive Lineman',
  'LB': 'Linebacker',
  'DB': 'Defensive Back',
  'FLEX': 'Flex (RB/WR/TE)',
  'SUPER_FLEX': 'Superflex (QB/RB/WR/TE)',
  'REC_FLEX': 'Receiving Flex (WR/TE)',
  'IDP_FLEX': 'IDP Flex',
  'BN': 'Bench',
  'IR': 'Injured Reserve',
  'TAXI': 'Taxi Squad',
};

export function getPositionName(posAbbrev: string): string {
  return POSITION_MAP[posAbbrev] || posAbbrev;
}
```

**Step 2: Create `workers/sleeper-client/src/sports/football/handlers.ts`**

```typescript
import type { Env, ToolParams, ExecuteResponse, SleeperLeague, SleeperRoster, SleeperMatchup, SleeperLeagueUser } from '../../types';
import { sleeperFetch, handleSleeperError } from '../../shared/sleeper-api';
import { extractErrorCode } from '@flaim/worker-shared';

type HandlerFn = (
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string
) => Promise<ExecuteResponse>;

export const footballHandlers: Record<string, HandlerFn> = {
  get_league_info: handleGetLeagueInfo,
  get_standings: handleGetStandings,
  get_roster: handleGetRoster,
  get_matchups: handleGetMatchups,
};

async function handleGetLeagueInfo(
  _env: Env,
  params: ToolParams,
): Promise<ExecuteResponse> {
  const { league_id } = params;

  try {
    const response = await sleeperFetch(`/league/${league_id}`);
    if (!response.ok) handleSleeperError(response);

    const league: SleeperLeague = await response.json();

    return {
      success: true,
      data: {
        leagueId: league.league_id,
        name: league.name,
        sport: league.sport,
        season: league.season,
        status: league.status,
        totalRosters: league.total_rosters,
        rosterPositions: league.roster_positions,
        scoringSettings: league.scoring_settings,
        previousLeagueId: league.previous_league_id,
        draftId: league.draft_id,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: extractErrorCode(error),
    };
  }
}

async function handleGetStandings(
  _env: Env,
  params: ToolParams,
): Promise<ExecuteResponse> {
  const { league_id } = params;

  try {
    // Fetch rosters (contains W/L/T/PF) and users (contains display names)
    const [rostersRes, usersRes] = await Promise.all([
      sleeperFetch(`/league/${league_id}/rosters`),
      sleeperFetch(`/league/${league_id}/users`),
    ]);

    if (!rostersRes.ok) handleSleeperError(rostersRes);
    if (!usersRes.ok) handleSleeperError(usersRes);

    const rosters: SleeperRoster[] = await rostersRes.json();
    const users: SleeperLeagueUser[] = await usersRes.json();

    // Build owner_id → display_name map
    const userMap = new Map<string, string>();
    for (const user of users) {
      userMap.set(user.user_id, user.display_name);
    }

    // Compute standings from roster settings
    const standings = rosters
      .map((roster) => {
        const { wins, losses, ties, fpts, fpts_decimal, fpts_against, fpts_against_decimal } = roster.settings;
        const pointsFor = fpts + (fpts_decimal ?? 0) / 100;
        const pointsAgainst = (fpts_against ?? 0) + (fpts_against_decimal ?? 0) / 100;
        const totalGames = wins + losses + ties;
        const winPct = totalGames > 0 ? wins / totalGames : 0;

        return {
          rosterId: roster.roster_id,
          ownerId: roster.owner_id,
          ownerName: userMap.get(roster.owner_id) ?? 'Unknown',
          wins,
          losses,
          ties,
          winPercentage: Math.round(winPct * 1000) / 1000,
          pointsFor: Math.round(pointsFor * 100) / 100,
          pointsAgainst: Math.round(pointsAgainst * 100) / 100,
        };
      })
      .sort((a, b) => {
        // Sort by wins desc, then points_for desc
        if (b.wins !== a.wins) return b.wins - a.wins;
        return b.pointsFor - a.pointsFor;
      })
      .map((entry, index) => ({ ...entry, rank: index + 1 }));

    return {
      success: true,
      data: {
        leagueId: league_id,
        standings,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: extractErrorCode(error),
    };
  }
}

async function handleGetRoster(
  _env: Env,
  params: ToolParams,
): Promise<ExecuteResponse> {
  const { league_id, team_id } = params;

  try {
    // Fetch rosters and users
    const [rostersRes, usersRes] = await Promise.all([
      sleeperFetch(`/league/${league_id}/rosters`),
      sleeperFetch(`/league/${league_id}/users`),
    ]);

    if (!rostersRes.ok) handleSleeperError(rostersRes);
    if (!usersRes.ok) handleSleeperError(usersRes);

    const rosters: SleeperRoster[] = await rostersRes.json();
    const users: SleeperLeagueUser[] = await usersRes.json();

    // Find the requested roster
    let roster: SleeperRoster | undefined;
    if (team_id) {
      roster = rosters.find((r) => String(r.roster_id) === team_id || r.owner_id === team_id);
    } else {
      // If no team_id provided, return all rosters summary
      const userMap = new Map<string, string>();
      for (const user of users) {
        userMap.set(user.user_id, user.display_name);
      }

      return {
        success: true,
        data: {
          leagueId: league_id,
          rosters: rosters.map((r) => ({
            rosterId: r.roster_id,
            ownerId: r.owner_id,
            ownerName: userMap.get(r.owner_id) ?? 'Unknown',
            playerCount: r.players?.length ?? 0,
            starterCount: r.starters?.length ?? 0,
          })),
        },
      };
    }

    if (!roster) {
      return {
        success: false,
        error: `Roster not found for team_id: ${team_id}`,
        code: 'SLEEPER_NOT_FOUND',
      };
    }

    // Find owner name
    const owner = users.find((u) => u.user_id === roster!.owner_id);
    const starters = roster.starters ?? [];
    const allPlayers = roster.players ?? [];
    const reserve = roster.reserve ?? [];
    const bench = allPlayers.filter((p) => !starters.includes(p) && !reserve.includes(p));

    return {
      success: true,
      data: {
        leagueId: league_id,
        rosterId: roster.roster_id,
        ownerId: roster.owner_id,
        ownerName: owner?.display_name ?? 'Unknown',
        starters,
        bench,
        reserve,
        record: {
          wins: roster.settings.wins,
          losses: roster.settings.losses,
          ties: roster.settings.ties,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: extractErrorCode(error),
    };
  }
}

async function handleGetMatchups(
  _env: Env,
  params: ToolParams,
): Promise<ExecuteResponse> {
  const { league_id, week } = params;

  try {
    // If no week specified, get current week from sport state
    let matchupWeek = week;
    if (!matchupWeek) {
      const stateRes = await sleeperFetch('/state/nfl');
      if (stateRes.ok) {
        const state = await stateRes.json() as { week: number; display_week: number };
        matchupWeek = state.week;
      } else {
        matchupWeek = 1; // fallback
      }
    }

    // Fetch matchups, rosters, and users in parallel
    const [matchupsRes, rostersRes, usersRes] = await Promise.all([
      sleeperFetch(`/league/${league_id}/matchups/${matchupWeek}`),
      sleeperFetch(`/league/${league_id}/rosters`),
      sleeperFetch(`/league/${league_id}/users`),
    ]);

    if (!matchupsRes.ok) handleSleeperError(matchupsRes);
    if (!rostersRes.ok) handleSleeperError(rostersRes);
    if (!usersRes.ok) handleSleeperError(usersRes);

    const matchups: SleeperMatchup[] = await matchupsRes.json();
    const rosters: SleeperRoster[] = await rostersRes.json();
    const users: SleeperLeagueUser[] = await usersRes.json();

    // Build roster_id → owner display name map
    const rosterOwnerMap = new Map<number, string>();
    const userMap = new Map<string, string>();
    for (const user of users) {
      userMap.set(user.user_id, user.display_name);
    }
    for (const roster of rosters) {
      rosterOwnerMap.set(roster.roster_id, userMap.get(roster.owner_id) ?? 'Unknown');
    }

    // Group by matchup_id to pair opponents
    const matchupGroups = new Map<number, SleeperMatchup[]>();
    for (const m of matchups) {
      if (!matchupGroups.has(m.matchup_id)) {
        matchupGroups.set(m.matchup_id, []);
      }
      matchupGroups.get(m.matchup_id)!.push(m);
    }

    // Build paired matchups
    const pairedMatchups = Array.from(matchupGroups.entries()).map(([matchupId, pair]) => {
      const team1 = pair[0];
      const team2 = pair[1];

      const formatTeam = (m: SleeperMatchup) => ({
        rosterId: m.roster_id,
        ownerName: rosterOwnerMap.get(m.roster_id) ?? 'Unknown',
        points: m.points ?? 0,
        starters: m.starters ?? [],
      });

      const home = team1 ? formatTeam(team1) : null;
      const away = team2 ? formatTeam(team2) : null;

      let winner: string | undefined;
      if (home && away && (home.points > 0 || away.points > 0)) {
        if (home.points > away.points) winner = 'home';
        else if (away.points > home.points) winner = 'away';
        else winner = 'tie';
      }

      return { matchupId, home, away, winner };
    });

    return {
      success: true,
      data: {
        leagueId: league_id,
        week: matchupWeek,
        matchups: pairedMatchups,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: extractErrorCode(error),
    };
  }
}
```

**Step 3: Commit**

```bash
git add workers/sleeper-client/src/sports/football/
git commit -m "feat(sleeper): add football handlers and position mappings"
```

---

### Task 4: Basketball Handlers + Mappings

**Files:**
- Create: `workers/sleeper-client/src/sports/basketball/mappings.ts`
- Create: `workers/sleeper-client/src/sports/basketball/handlers.ts`

**Step 1: Create `workers/sleeper-client/src/sports/basketball/mappings.ts`**

```typescript
// Sleeper NBA position abbreviations
export const POSITION_MAP: Record<string, string> = {
  'PG': 'Point Guard',
  'SG': 'Shooting Guard',
  'SF': 'Small Forward',
  'PF': 'Power Forward',
  'C': 'Center',
  'G': 'Guard',
  'F': 'Forward',
  'UTIL': 'Utility',
  'BN': 'Bench',
  'IR': 'Injured Reserve',
  'TAXI': 'Taxi Squad',
};

export function getPositionName(posAbbrev: string): string {
  return POSITION_MAP[posAbbrev] || posAbbrev;
}
```

**Step 2: Create `workers/sleeper-client/src/sports/basketball/handlers.ts`**

This is nearly identical to football handlers but uses `'nba'` for the state endpoint. Since the handler logic is the same (Sleeper's API shape is sport-agnostic), create handlers that reference `'nba'` for state lookup.

```typescript
import type { Env, ToolParams, ExecuteResponse, SleeperLeague, SleeperRoster, SleeperMatchup, SleeperLeagueUser } from '../../types';
import { sleeperFetch, handleSleeperError } from '../../shared/sleeper-api';
import { extractErrorCode } from '@flaim/worker-shared';

type HandlerFn = (
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string
) => Promise<ExecuteResponse>;

export const basketballHandlers: Record<string, HandlerFn> = {
  get_league_info: handleGetLeagueInfo,
  get_standings: handleGetStandings,
  get_roster: handleGetRoster,
  get_matchups: handleGetMatchups,
};

// Handlers are identical to football except get_matchups uses /state/nba
// for the default week. Since Sleeper's league/roster/matchup endpoints
// are sport-agnostic (keyed by league_id), the logic is the same.

async function handleGetLeagueInfo(
  _env: Env,
  params: ToolParams,
): Promise<ExecuteResponse> {
  const { league_id } = params;

  try {
    const response = await sleeperFetch(`/league/${league_id}`);
    if (!response.ok) handleSleeperError(response);
    const league: SleeperLeague = await response.json();

    return {
      success: true,
      data: {
        leagueId: league.league_id,
        name: league.name,
        sport: league.sport,
        season: league.season,
        status: league.status,
        totalRosters: league.total_rosters,
        rosterPositions: league.roster_positions,
        scoringSettings: league.scoring_settings,
        previousLeagueId: league.previous_league_id,
        draftId: league.draft_id,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: extractErrorCode(error),
    };
  }
}

async function handleGetStandings(
  _env: Env,
  params: ToolParams,
): Promise<ExecuteResponse> {
  const { league_id } = params;

  try {
    const [rostersRes, usersRes] = await Promise.all([
      sleeperFetch(`/league/${league_id}/rosters`),
      sleeperFetch(`/league/${league_id}/users`),
    ]);

    if (!rostersRes.ok) handleSleeperError(rostersRes);
    if (!usersRes.ok) handleSleeperError(usersRes);

    const rosters: SleeperRoster[] = await rostersRes.json();
    const users: SleeperLeagueUser[] = await usersRes.json();

    const userMap = new Map<string, string>();
    for (const user of users) {
      userMap.set(user.user_id, user.display_name);
    }

    const standings = rosters
      .map((roster) => {
        const { wins, losses, ties, fpts, fpts_decimal, fpts_against, fpts_against_decimal } = roster.settings;
        const pointsFor = fpts + (fpts_decimal ?? 0) / 100;
        const pointsAgainst = (fpts_against ?? 0) + (fpts_against_decimal ?? 0) / 100;
        const totalGames = wins + losses + ties;
        const winPct = totalGames > 0 ? wins / totalGames : 0;

        return {
          rosterId: roster.roster_id,
          ownerId: roster.owner_id,
          ownerName: userMap.get(roster.owner_id) ?? 'Unknown',
          wins, losses, ties,
          winPercentage: Math.round(winPct * 1000) / 1000,
          pointsFor: Math.round(pointsFor * 100) / 100,
          pointsAgainst: Math.round(pointsAgainst * 100) / 100,
        };
      })
      .sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        return b.pointsFor - a.pointsFor;
      })
      .map((entry, index) => ({ ...entry, rank: index + 1 }));

    return { success: true, data: { leagueId: league_id, standings } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: extractErrorCode(error),
    };
  }
}

async function handleGetRoster(
  _env: Env,
  params: ToolParams,
): Promise<ExecuteResponse> {
  const { league_id, team_id } = params;

  try {
    const [rostersRes, usersRes] = await Promise.all([
      sleeperFetch(`/league/${league_id}/rosters`),
      sleeperFetch(`/league/${league_id}/users`),
    ]);

    if (!rostersRes.ok) handleSleeperError(rostersRes);
    if (!usersRes.ok) handleSleeperError(usersRes);

    const rosters: SleeperRoster[] = await rostersRes.json();
    const users: SleeperLeagueUser[] = await usersRes.json();

    let roster: SleeperRoster | undefined;
    if (team_id) {
      roster = rosters.find((r) => String(r.roster_id) === team_id || r.owner_id === team_id);
    } else {
      const userMap = new Map<string, string>();
      for (const user of users) {
        userMap.set(user.user_id, user.display_name);
      }
      return {
        success: true,
        data: {
          leagueId: league_id,
          rosters: rosters.map((r) => ({
            rosterId: r.roster_id,
            ownerId: r.owner_id,
            ownerName: userMap.get(r.owner_id) ?? 'Unknown',
            playerCount: r.players?.length ?? 0,
            starterCount: r.starters?.length ?? 0,
          })),
        },
      };
    }

    if (!roster) {
      return { success: false, error: `Roster not found for team_id: ${team_id}`, code: 'SLEEPER_NOT_FOUND' };
    }

    const owner = users.find((u) => u.user_id === roster!.owner_id);
    const starters = roster.starters ?? [];
    const allPlayers = roster.players ?? [];
    const reserve = roster.reserve ?? [];
    const bench = allPlayers.filter((p) => !starters.includes(p) && !reserve.includes(p));

    return {
      success: true,
      data: {
        leagueId: league_id,
        rosterId: roster.roster_id,
        ownerId: roster.owner_id,
        ownerName: owner?.display_name ?? 'Unknown',
        starters, bench, reserve,
        record: { wins: roster.settings.wins, losses: roster.settings.losses, ties: roster.settings.ties },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: extractErrorCode(error),
    };
  }
}

async function handleGetMatchups(
  _env: Env,
  params: ToolParams,
): Promise<ExecuteResponse> {
  const { league_id, week } = params;

  try {
    let matchupWeek = week;
    if (!matchupWeek) {
      const stateRes = await sleeperFetch('/state/nba');
      if (stateRes.ok) {
        const state = await stateRes.json() as { week: number };
        matchupWeek = state.week;
      } else {
        matchupWeek = 1;
      }
    }

    const [matchupsRes, rostersRes, usersRes] = await Promise.all([
      sleeperFetch(`/league/${league_id}/matchups/${matchupWeek}`),
      sleeperFetch(`/league/${league_id}/rosters`),
      sleeperFetch(`/league/${league_id}/users`),
    ]);

    if (!matchupsRes.ok) handleSleeperError(matchupsRes);
    if (!rostersRes.ok) handleSleeperError(rostersRes);
    if (!usersRes.ok) handleSleeperError(usersRes);

    const matchups: SleeperMatchup[] = await matchupsRes.json();
    const rosters: SleeperRoster[] = await rostersRes.json();
    const users: SleeperLeagueUser[] = await usersRes.json();

    const rosterOwnerMap = new Map<number, string>();
    const userMap = new Map<string, string>();
    for (const user of users) { userMap.set(user.user_id, user.display_name); }
    for (const roster of rosters) { rosterOwnerMap.set(roster.roster_id, userMap.get(roster.owner_id) ?? 'Unknown'); }

    const matchupGroups = new Map<number, SleeperMatchup[]>();
    for (const m of matchups) {
      if (!matchupGroups.has(m.matchup_id)) matchupGroups.set(m.matchup_id, []);
      matchupGroups.get(m.matchup_id)!.push(m);
    }

    const pairedMatchups = Array.from(matchupGroups.entries()).map(([matchupId, pair]) => {
      const formatTeam = (m: SleeperMatchup) => ({
        rosterId: m.roster_id,
        ownerName: rosterOwnerMap.get(m.roster_id) ?? 'Unknown',
        points: m.points ?? 0,
        starters: m.starters ?? [],
      });

      const home = pair[0] ? formatTeam(pair[0]) : null;
      const away = pair[1] ? formatTeam(pair[1]) : null;

      let winner: string | undefined;
      if (home && away && (home.points > 0 || away.points > 0)) {
        if (home.points > away.points) winner = 'home';
        else if (away.points > home.points) winner = 'away';
        else winner = 'tie';
      }

      return { matchupId, home, away, winner };
    });

    return { success: true, data: { leagueId: league_id, week: matchupWeek, matchups: pairedMatchups } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: extractErrorCode(error),
    };
  }
}
```

**Step 3: Commit**

```bash
git add workers/sleeper-client/src/sports/basketball/
git commit -m "feat(sleeper): add basketball handlers and position mappings"
```

---

### Task 5: Worker Entry Point (index.ts)

**Files:**
- Create: `workers/sleeper-client/src/index.ts`

**Step 1: Create `workers/sleeper-client/src/index.ts`**

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, ExecuteRequest, ExecuteResponse, Sport } from './types';
import { footballHandlers } from './sports/football/handlers';
import { basketballHandlers } from './sports/basketball/handlers';
import {
  CORRELATION_ID_HEADER,
  EVAL_RUN_HEADER,
  EVAL_TRACE_HEADER,
  getCorrelationId,
  getEvalContext,
} from '@flaim/worker-shared';
import { logEvalEvent } from './logging';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'sleeper-client',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

app.post('/execute', async (c) => {
  const correlationId = getCorrelationId(c.req.raw);
  const { evalRunId, evalTraceId } = getEvalContext(c.req.raw);
  const startTime = Date.now();

  try {
    const body = await c.req.json<ExecuteRequest>();
    const { tool, params } = body;
    const { sport, league_id, season_year } = params;

    console.log(`[sleeper-client] ${correlationId} ${tool} ${sport} league=${league_id} season=${season_year}`);
    logEvalEvent({
      service: 'sleeper-client',
      phase: 'execute_start',
      correlation_id: correlationId,
      run_id: evalRunId,
      trace_id: evalTraceId,
      tool,
      sport,
      league_id,
      message: `${tool} ${sport} league=${league_id} season=${season_year}`,
    });

    const result = await routeToSport(sport, tool, params);

    const duration = Date.now() - startTime;
    console.log(`[sleeper-client] ${correlationId} ${tool} ${sport} completed in ${duration}ms success=${result.success}`);
    logEvalEvent({
      service: 'sleeper-client',
      phase: 'execute_end',
      correlation_id: correlationId,
      run_id: evalRunId,
      trace_id: evalTraceId,
      tool,
      sport,
      league_id,
      duration_ms: duration,
      status: String(result.success),
      message: `${tool} ${sport} completed success=${result.success}`,
    });

    const response = c.json(result);
    response.headers.set(CORRELATION_ID_HEADER, correlationId);
    if (evalRunId) response.headers.set(EVAL_RUN_HEADER, evalRunId);
    if (evalTraceId) response.headers.set(EVAL_TRACE_HEADER, evalTraceId);
    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[sleeper-client] ${correlationId} error in ${duration}ms: ${message}`);
    logEvalEvent({
      service: 'sleeper-client',
      phase: 'execute_error',
      correlation_id: correlationId,
      run_id: evalRunId,
      trace_id: evalTraceId,
      duration_ms: duration,
      status: 'error',
      message: 'execute failed',
      error: message,
    });

    const response = c.json({
      success: false,
      error: message,
      code: 'INTERNAL_ERROR',
    } satisfies ExecuteResponse, 500);
    response.headers.set(CORRELATION_ID_HEADER, correlationId);
    if (evalRunId) response.headers.set(EVAL_RUN_HEADER, evalRunId);
    if (evalTraceId) response.headers.set(EVAL_TRACE_HEADER, evalTraceId);
    return response;
  }
});

async function routeToSport(
  sport: Sport,
  tool: string,
  params: ExecuteRequest['params'],
): Promise<ExecuteResponse> {
  switch (sport) {
    case 'football': {
      const handler = footballHandlers[tool];
      if (!handler) return { success: false, error: `Unknown football tool: ${tool}`, code: 'UNKNOWN_TOOL' };
      // Sleeper API is public — no env/authHeader needed by handlers
      return handler({} as Env, params);
    }
    case 'basketball': {
      const handler = basketballHandlers[tool];
      if (!handler) return { success: false, error: `Unknown basketball tool: ${tool}`, code: 'UNKNOWN_TOOL' };
      return handler({} as Env, params);
    }
    default:
      return { success: false, error: `Sport "${sport}" is not supported for Sleeper`, code: 'SPORT_NOT_SUPPORTED' };
  }
}

app.notFound((c) => {
  return c.json({
    error: 'Endpoint not found',
    endpoints: {
      '/health': 'GET - Health check',
      '/execute': 'POST - Execute tool (called by gateway)',
    },
  }, 404);
});

export default app;
```

**Step 2: Verify type-check passes**

Run: `cd workers/sleeper-client && npm run type-check`
Expected: No errors

**Step 3: Commit**

```bash
git add workers/sleeper-client/src/index.ts
git commit -m "feat(sleeper): add worker entry point with sport routing"
```

---

### Task 6: Gateway Changes (fantasy-mcp)

**Files:**
- Modify: `workers/fantasy-mcp/src/types.ts`
- Modify: `workers/fantasy-mcp/src/router.ts`
- Modify: `workers/fantasy-mcp/wrangler.jsonc`
- Modify: `workers/fantasy-mcp/src/mcp/tools.ts` (platform enum on 5 tools)
- Modify: `workers/fantasy-mcp/src/mcp/tools.ts` (get_user_session Sleeper league fetch)

**Step 1: Update `workers/fantasy-mcp/src/types.ts`**

Add `'sleeper'` to Platform and `SLEEPER: Fetcher` to Env:

```typescript
// Change line 11
export type Platform = 'espn' | 'yahoo' | 'sleeper';

// Add to Env interface after YAHOO line
  SLEEPER: Fetcher;     // Service binding to sleeper-client
```

**Step 2: Update `workers/fantasy-mcp/src/router.ts`**

Add sleeper case in `selectClient()`:

```typescript
// After case 'yahoo': return env.YAHOO;
    case 'sleeper':
      return env.SLEEPER;
```

**Step 3: Update `workers/fantasy-mcp/wrangler.jsonc`**

Add SLEEPER service binding in all 3 envs:

- prod: `{ "binding": "SLEEPER", "service": "sleeper-client" }`
- preview: `{ "binding": "SLEEPER", "service": "sleeper-client-preview" }`
- dev: `{ "binding": "SLEEPER", "service": "sleeper-client-dev" }`

**Step 4: Update platform Zod enums in `tools.ts`**

Find all occurrences of `z.enum(['espn', 'yahoo'])` in the 5 routed tool definitions and change to `z.enum(['espn', 'yahoo', 'sleeper'])`.

**Step 5: Add Sleeper league fetch to `get_user_session` handler**

After the Yahoo leagues fetch block (~line 375), add a parallel Sleeper leagues fetch following the same pattern:

```typescript
// Fetch Sleeper leagues
const sleeperLeagues: UserLeague[] = [];
try {
  const sleeperResponse = await env.AUTH_WORKER.fetch(
    new Request('https://internal/leagues/sleeper', { headers })
  );
  if (sleeperResponse.ok) {
    const sleeperData = (await sleeperResponse.json()) as {
      leagues?: Array<{
        sport: string;
        leagueId: string;
        leagueName: string;
        rosterId?: number;
        seasonYear: number;
      }>;
    };
    if (sleeperData.leagues) {
      for (const league of sleeperData.leagues) {
        sleeperLeagues.push({
          platform: 'sleeper',
          sport: league.sport,
          leagueId: league.leagueId,
          leagueName: league.leagueName,
          teamId: league.rosterId ? String(league.rosterId) : '',
          seasonYear: league.seasonYear,
        });
      }
    }
  }
} catch (error) {
  console.error('[get_user_session] Failed to fetch Sleeper leagues:', error);
}
```

Update the combine line:
```typescript
const allLeagues = [...espnLeagues, ...yahooLeagues, ...sleeperLeagues];
```

Also update `get_ancient_history` if it has the same pattern (~line 569).

**Step 6: Commit**

```bash
git add workers/fantasy-mcp/
git commit -m "feat(gateway): add Sleeper platform routing and league fetch"
```

---

### Task 7: Database Migration

**Files:**
- Create: `docs/migrations/014_sleeper_tables.sql`

**Step 1: Create migration file**

```sql
-- Sleeper connections (user identity, no credentials needed)
CREATE TABLE sleeper_connections (
  clerk_user_id TEXT PRIMARY KEY,
  sleeper_user_id TEXT NOT NULL,
  sleeper_username TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE sleeper_connections ENABLE ROW LEVEL SECURITY;

-- Sleeper leagues
CREATE TABLE sleeper_leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  league_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  season_year INTEGER NOT NULL,
  league_name TEXT NOT NULL,
  roster_id INTEGER,
  sleeper_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT sleeper_leagues_unique
    UNIQUE (clerk_user_id, league_id, season_year)
);

ALTER TABLE sleeper_leagues ENABLE ROW LEVEL SECURITY;

-- Index for league lookups by user
CREATE INDEX idx_sleeper_leagues_user ON sleeper_leagues(clerk_user_id);
```

**Step 2: Run migration in Supabase**

Apply via Supabase dashboard SQL editor or CLI.

**Step 3: Commit**

```bash
git add docs/migrations/014_sleeper_tables.sql
git commit -m "feat(db): add sleeper_connections and sleeper_leagues tables"
```

---

### Task 8: Auth-Worker — Sleeper Storage + Endpoints

**Files:**
- Create: `workers/auth-worker/src/sleeper-storage.ts`
- Create: `workers/auth-worker/src/sleeper-connect-handlers.ts`
- Modify: `workers/auth-worker/src/index-hono.ts` (add routes)

**Step 1: Create `workers/auth-worker/src/sleeper-storage.ts`**

Implement Supabase CRUD for `sleeper_connections` and `sleeper_leagues`. Follow the pattern from existing Yahoo storage. Methods needed:

- `getSleeperConnection(clerkUserId)` → returns `{ sleeper_user_id, sleeper_username }` or null
- `saveSleeperConnection(clerkUserId, sleeperUserId, sleeperUsername)` → upsert
- `deleteSleeperConnection(clerkUserId)` → delete connection + all leagues
- `getSleeperLeagues(clerkUserId)` → returns league rows
- `saveSleeperLeague(league)` → upsert by unique constraint
- `deleteSleeperLeague(id, clerkUserId)` → delete one league

**Step 2: Create `workers/auth-worker/src/sleeper-connect-handlers.ts`**

Implement handlers:

- `handleSleeperDiscover(request, env, userId)`: Accept `{ username }`, call Sleeper API to resolve user, discover leagues for NFL + NBA for current season, traverse `previous_league_id` chain (max 5 years), save all to DB.
- `handleSleeperStatus(env, userId)`: Return connection status.
- `handleSleeperDisconnect(env, userId)`: Remove connection + leagues.
- `handleSleeperLeagues(env, userId)`: Return leagues list.
- `handleSleeperLeagueDelete(env, userId, leagueId)`: Delete one league.

The discovery handler calls the Sleeper API directly (it's public):
```
GET https://api.sleeper.app/v1/user/{username}
GET https://api.sleeper.app/v1/user/{user_id}/leagues/nfl/{season}
GET https://api.sleeper.app/v1/user/{user_id}/leagues/nba/{season}
For each league with previous_league_id → GET /league/{prev_id} → save, repeat
```

**Step 3: Add routes to `index-hono.ts`**

```typescript
// Sleeper connect routes
app.post('/connect/sleeper/discover', authMiddleware, handleSleeperDiscover);
app.get('/connect/sleeper/status', authMiddleware, handleSleeperStatus);
app.delete('/connect/sleeper/disconnect', authMiddleware, handleSleeperDisconnect);
app.get('/leagues/sleeper', authMiddleware, handleSleeperLeagues);
app.delete('/leagues/sleeper/:id', authMiddleware, handleSleeperLeagueDelete);
```

**Step 4: Commit**

```bash
git add workers/auth-worker/src/sleeper-storage.ts workers/auth-worker/src/sleeper-connect-handlers.ts
git add workers/auth-worker/src/index-hono.ts
git commit -m "feat(auth): add Sleeper connection, discovery, and league endpoints"
```

---

### Task 9: Frontend — Connect Sleeper UI

**Files:**
- Modify: Landing page or settings component to add Sleeper connection section
- Follow `docs/STYLE-GUIDE.md` for design tokens

**Step 1: Add Sleeper connection section**

Match the existing ESPN and Yahoo connection patterns on the landing/settings page. Components needed:

- Username text input with "Connect" button
- Status display (connected username or "Not connected")
- Discovery results message ("Found N leagues + M past seasons")
- Disconnect button

Use semantic design tokens (not hard-coded Tailwind palette). Match the layout pattern of the existing ESPN and Yahoo sections exactly.

**Step 2: Add Next.js API proxy routes**

```
POST /api/connect/sleeper/discover → auth-worker
GET  /api/connect/sleeper/status → auth-worker
DELETE /api/connect/sleeper/disconnect → auth-worker
```

Follow the existing proxy pattern in `web/app/api/`.

**Step 3: Commit**

```bash
git add web/
git commit -m "feat(web): add Sleeper connection UI and API proxy routes"
```

---

### Task 10: CI/CD Pipeline Update

**Files:**
- Modify: `.github/workflows/deploy-workers.yml`

**Step 1: Add `sleeper-client` to the worker matrix**

```yaml
strategy:
  matrix:
    worker: [auth-worker, espn-client, yahoo-client, sleeper-client, fantasy-mcp]
```

Add to both the `test` and `deploy` job matrices.

**Step 2: Commit**

```bash
git add .github/workflows/deploy-workers.yml
git commit -m "ci: add sleeper-client to worker deploy pipeline"
```

---

### Task 11: Documentation Updates

**Files:**
- Modify: `docs/STATUS.md` (add Sleeper platform)
- Modify: `docs/CHANGELOG.md` (add Sleeper entry under Unreleased)
- Modify: `docs/ARCHITECTURE.md` (add sleeper-client to architecture)
- Modify: `docs/DATABASE.md` (add new tables)
- Create: `workers/sleeper-client/README.md`

**Step 1: Update each doc per `docs/INDEX.md` routing**

- `STATUS.md`: Add Sleeper column to platform/sport support matrix
- `CHANGELOG.md`: Add "Sleeper Fantasy Platform Support" section under Unreleased
- `ARCHITECTURE.md`: Add sleeper-client to directory structure and architecture diagram
- `DATABASE.md`: Add `sleeper_connections` and `sleeper_leagues` table descriptions
- `workers/sleeper-client/README.md`: Describe the worker, endpoints, and Sleeper API details

**Step 2: Commit**

```bash
git add docs/ workers/sleeper-client/README.md
git commit -m "docs: add Sleeper platform to architecture, status, and changelog"
```

---

### Task 12: End-to-End Verification

**Step 1: Type-check all modified workers**

```bash
cd workers/sleeper-client && npm run type-check
cd ../fantasy-mcp && npm run type-check
cd ../auth-worker && npm run type-check
```

**Step 2: Run tests**

```bash
cd workers/sleeper-client && npm test
cd ../fantasy-mcp && npm test
cd ../auth-worker && npm test
```

**Step 3: Local smoke test**

Start local dev servers and verify:
- `curl http://localhost:8792/health` returns healthy
- Gateway routes `platform: 'sleeper'` to sleeper-client
- Sleeper API calls return real data for a known public league

**Step 4: Final commit if any fixes needed**

```bash
git add -A && git commit -m "fix: address e2e verification issues"
```
