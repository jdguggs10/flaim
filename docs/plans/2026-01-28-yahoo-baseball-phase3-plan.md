# Yahoo Baseball (Phase 3) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add all 5 baseball handlers to yahoo-client, achieving Yahoo Baseball feature parity with ESPN Baseball.

**Architecture:** Create `sports/baseball/` directory in yahoo-client mirroring the `sports/football/` structure. The Yahoo Fantasy API uses the same endpoint patterns regardless of sport — the `league_key` already encodes the sport (e.g., `458.l.120956` for baseball). All existing normalizers (`asArray`, `unwrapLeague`, `unwrapTeam`, `getPath`) work identically. Only position mappings differ.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers, Yahoo Fantasy API

**Test league:** "Car Ramrod" — `458.l.120956`, teamId `3`, season 2025

---

## Task 1: Create baseball position mappings

**Files:**
- Create: `workers/yahoo-client/src/sports/baseball/mappings.ts`

**Step 1: Create the mappings file**

```typescript
// workers/yahoo-client/src/sports/baseball/mappings.ts

// Yahoo position abbreviations for baseball
export const POSITION_MAP: Record<string, string> = {
  'C': 'Catcher',
  '1B': 'First Base',
  '2B': 'Second Base',
  '3B': 'Third Base',
  'SS': 'Shortstop',
  'OF': 'Outfield',
  'Util': 'Utility',
  'SP': 'Starting Pitcher',
  'RP': 'Relief Pitcher',
  'P': 'Pitcher',
  'BN': 'Bench',
  'IL': 'Injured List',
  'IL+': 'Injured List+',
  'NA': 'Not Active',
};

export function getPositionName(posAbbrev: string): string {
  return POSITION_MAP[posAbbrev] || posAbbrev;
}

// Position abbreviations for Yahoo free agent filter
export const FA_POSITION_FILTER: Record<string, string> = {
  'ALL': '',
  'C': 'C',
  '1B': '1B',
  '2B': '2B',
  '3B': '3B',
  'SS': 'SS',
  'OF': 'OF',
  'SP': 'SP',
  'RP': 'RP',
  'P': 'P',
};

export function getPositionFilter(position?: string): string {
  if (!position) return '';
  const key = position.toUpperCase();
  return FA_POSITION_FILTER[key] ?? '';
}
```

**Step 2: Verify types**

Run: `cd workers/yahoo-client && npm run type-check`
Expected: No type errors

**Step 3: Commit**

```bash
git add workers/yahoo-client/src/sports/baseball/mappings.ts
git commit -m "feat(yahoo-client): add baseball position mappings"
```

---

## Task 2: Create baseball handlers (all 5)

The baseball handlers are nearly identical to football. The Yahoo API uses the same endpoints and response structure — the `league_key` distinguishes the sport. Copy the football handler patterns with baseball-specific imports.

**Files:**
- Create: `workers/yahoo-client/src/sports/baseball/handlers.ts`

**Step 1: Create the handlers file**

Copy the structure from `workers/yahoo-client/src/sports/football/handlers.ts` but import from `./mappings` (baseball mappings).

```typescript
// workers/yahoo-client/src/sports/baseball/handlers.ts
import type { Env, ToolParams, ExecuteResponse } from '../../types';
import { getYahooCredentials } from '../../shared/auth';
import { yahooFetch, handleYahooError, requireCredentials } from '../../shared/yahoo-api';
import { asArray, getPath, unwrapLeague, unwrapTeam, logStructure } from '../../shared/normalizers';
import { getPositionFilter } from './mappings';

type HandlerFn = (
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string
) => Promise<ExecuteResponse>;

export const baseballHandlers: Record<string, HandlerFn> = {
  get_league_info: handleGetLeagueInfo,
  get_standings: handleGetStandings,
  get_roster: handleGetRoster,
  get_matchups: handleGetMatchups,
  get_free_agents: handleGetFreeAgents,
};

function extractErrorCode(error: unknown): string {
  if (error instanceof Error) {
    const match = error.message.match(/^([A-Z_]+):/);
    if (match) return match[1];
  }
  return 'INTERNAL_ERROR';
}

async function handleGetLeagueInfo(
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  const { league_id } = params;

  try {
    const credentials = await getYahooCredentials(env, authHeader, correlationId);
    requireCredentials(credentials, 'get_league_info');

    const response = await yahooFetch(`/league/${league_id}`, { credentials });

    if (!response.ok) {
      handleYahooError(response);
    }

    const raw = await response.json();
    logStructure('get_league_info raw (baseball)', raw);

    const leagueArray = getPath(raw, ['fantasy_content', 'league']);
    const league = unwrapLeague(leagueArray);

    return {
      success: true,
      data: {
        leagueKey: league.league_key,
        leagueId: league.league_id,
        name: league.name,
        url: league.url,
        numTeams: league.num_teams,
        scoringType: league.scoring_type,
        currentWeek: league.current_week,
        startWeek: league.start_week,
        endWeek: league.end_week,
        startDate: league.start_date,
        endDate: league.end_date,
        isFinished: league.is_finished === 1,
        draftStatus: league.draft_status,
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: extractErrorCode(error)
    };
  }
}

async function handleGetStandings(
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  const { league_id } = params;

  try {
    const credentials = await getYahooCredentials(env, authHeader, correlationId);
    requireCredentials(credentials, 'get_standings');

    const response = await yahooFetch(`/league/${league_id}/standings`, { credentials });

    if (!response.ok) {
      handleYahooError(response);
    }

    const raw = await response.json();
    logStructure('get_standings raw (baseball)', raw);

    const leagueArray = getPath(raw, ['fantasy_content', 'league']);
    const league = unwrapLeague(leagueArray);

    const teamsObj = getPath(league, ['standings', 0, 'teams']) as Record<string, unknown> | undefined;
    const teamsArray = asArray(teamsObj);

    const standings = teamsArray.map((teamWrapper: unknown) => {
      const teamData = getPath(teamWrapper, ['team']) as unknown[];
      const team = unwrapTeam(teamData);
      const teamStandings = team.team_standings as Record<string, unknown> | undefined;
      const outcomeTotals = teamStandings?.outcome_totals as Record<string, unknown> | undefined;

      return {
        rank: teamStandings?.rank,
        teamKey: team.team_key,
        teamId: team.team_id,
        name: team.name,
        wins: outcomeTotals?.wins,
        losses: outcomeTotals?.losses,
        ties: outcomeTotals?.ties,
        percentage: outcomeTotals?.percentage,
        pointsFor: teamStandings?.points_for,
        pointsAgainst: teamStandings?.points_against,
      };
    });

    return {
      success: true,
      data: {
        leagueKey: league.league_key,
        leagueName: league.name,
        standings: standings.sort((a, b) => Number(a.rank) - Number(b.rank))
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: extractErrorCode(error)
    };
  }
}

async function handleGetRoster(
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  const { team_id, week } = params;

  if (!team_id) {
    return {
      success: false,
      error: 'team_id is required for get_roster',
      code: 'MISSING_PARAM'
    };
  }

  try {
    const credentials = await getYahooCredentials(env, authHeader, correlationId);
    requireCredentials(credentials, 'get_roster');

    const weekParam = week ? `;week=${week}` : '';
    const response = await yahooFetch(`/team/${team_id}/roster${weekParam}`, { credentials });

    if (!response.ok) {
      handleYahooError(response);
    }

    const raw = await response.json();
    logStructure('get_roster raw (baseball)', raw);

    const teamArray = getPath(raw, ['fantasy_content', 'team']);
    const team = unwrapTeam(teamArray as unknown[]);

    const rosterData = team.roster as Record<string, unknown> | undefined;
    const playersObj = getPath(rosterData, ['0', 'players']) as Record<string, unknown> | undefined;
    const playersArray = asArray(playersObj);

    const players = playersArray.map((playerWrapper: unknown) => {
      const playerData = getPath(playerWrapper, ['player']) as unknown[];

      const metaArray = playerData?.[0] as unknown[];
      let playerMeta: Record<string, unknown> = {};
      if (Array.isArray(metaArray)) {
        for (const item of metaArray) {
          if (typeof item === 'object' && item !== null) {
            playerMeta = { ...playerMeta, ...item };
          }
        }
      }

      const positionData = playerData?.[1] as Record<string, unknown> | undefined;
      const selectedPosition = positionData?.selected_position as Record<string, unknown>[] | undefined;
      const position = selectedPosition?.[1]?.position;

      return {
        playerKey: playerMeta.player_key,
        playerId: playerMeta.player_id,
        name: (playerMeta.name as Record<string, unknown>)?.full,
        team: playerMeta.editorial_team_abbr,
        position: playerMeta.display_position,
        selectedPosition: position,
        status: playerMeta.status,
      };
    });

    return {
      success: true,
      data: {
        teamKey: team.team_key,
        teamName: team.name,
        week: week || 'current',
        players
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: extractErrorCode(error)
    };
  }
}

async function handleGetMatchups(
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  const { league_id, week } = params;

  try {
    const credentials = await getYahooCredentials(env, authHeader, correlationId);
    requireCredentials(credentials, 'get_matchups');

    const weekParam = week ? `;week=${week}` : '';
    const response = await yahooFetch(`/league/${league_id}/scoreboard${weekParam}`, { credentials });

    if (!response.ok) {
      handleYahooError(response);
    }

    const raw = await response.json();
    logStructure('get_matchups raw (baseball)', raw);

    const leagueArray = getPath(raw, ['fantasy_content', 'league']);
    const league = unwrapLeague(leagueArray);

    const currentWeek = league.current_week as number | undefined;

    const scoreboardData = league.scoreboard as Record<string, unknown> | undefined;
    const matchupsObj = getPath(scoreboardData, ['0', 'matchups']) as Record<string, unknown> | undefined;
    const matchupsArray = asArray(matchupsObj);

    const matchups = matchupsArray.map((matchupWrapper: unknown, index: number) => {
      // Yahoo structure: {matchup: {"0": {teams: {...}}}}
      const matchupObj = getPath(matchupWrapper, ['matchup']) as Record<string, unknown> | undefined;
      const matchupContent = matchupObj?.['0'] as Record<string, unknown> | undefined;

      const teamsObj = matchupContent?.teams as Record<string, unknown> | undefined;
      const teamsArray = asArray(teamsObj);

      const parseTeam = (teamWrapper: unknown) => {
        const teamData = getPath(teamWrapper, ['team']) as unknown[];
        const team = unwrapTeam(teamData);
        const teamPoints = team.team_points as Record<string, unknown> | undefined;
        const teamProjectedPoints = team.team_projected_points as Record<string, unknown> | undefined;

        return {
          teamKey: team.team_key as string,
          teamId: team.team_id as string,
          teamName: team.name as string,
          points: teamPoints?.total ? parseFloat(String(teamPoints.total)) : 0,
          projectedPoints: teamProjectedPoints?.total ? parseFloat(String(teamProjectedPoints.total)) : undefined,
        };
      };

      const home = teamsArray[0] ? parseTeam(teamsArray[0]) : null;
      const away = teamsArray[1] ? parseTeam(teamsArray[1]) : null;

      let winner: string | undefined;
      if (home && away && (home.points > 0 || away.points > 0)) {
        if (home.points > away.points) winner = 'home';
        else if (away.points > home.points) winner = 'away';
        else winner = 'tie';
      }

      return {
        matchupId: index + 1,
        week: week || currentWeek,
        home,
        away,
        winner,
      };
    });

    return {
      success: true,
      data: {
        leagueKey: league.league_key,
        leagueName: league.name,
        currentWeek,
        matchupWeek: week || currentWeek,
        matchups
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: extractErrorCode(error)
    };
  }
}

async function handleGetFreeAgents(
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  const { league_id, position, count } = params;

  try {
    const credentials = await getYahooCredentials(env, authHeader, correlationId);
    requireCredentials(credentials, 'get_free_agents');

    const limit = Math.min(Math.max(1, count || 25), 100);
    let queryParams = `;status=FA;count=${limit}`;

    const posFilter = getPositionFilter(position);
    if (posFilter) {
      queryParams += `;position=${posFilter}`;
    }

    const response = await yahooFetch(`/league/${league_id}/players${queryParams}`, { credentials });

    if (!response.ok) {
      handleYahooError(response);
    }

    const raw = await response.json();
    logStructure('get_free_agents raw (baseball)', raw);

    const leagueArray = getPath(raw, ['fantasy_content', 'league']);
    const league = unwrapLeague(leagueArray);

    const playersObj = league.players as Record<string, unknown> | undefined;
    const playersArray = asArray(playersObj);

    const freeAgents = playersArray.map((playerWrapper: unknown) => {
      const playerData = getPath(playerWrapper, ['player']) as unknown[];

      const metaArray = playerData?.[0] as unknown[];
      let playerMeta: Record<string, unknown> = {};
      if (Array.isArray(metaArray)) {
        for (const item of metaArray) {
          if (typeof item === 'object' && item !== null) {
            playerMeta = { ...playerMeta, ...item };
          }
        }
      }

      const ownershipData = playerData?.[1] as Record<string, unknown> | undefined;
      const ownership = ownershipData?.ownership as Record<string, unknown> | undefined;

      return {
        playerKey: playerMeta.player_key as string,
        playerId: playerMeta.player_id as string,
        name: (playerMeta.name as Record<string, unknown>)?.full as string,
        team: playerMeta.editorial_team_abbr as string,
        position: playerMeta.display_position as string,
        percentOwned: ownership?.percent_owned ? parseFloat(String(ownership.percent_owned)) : undefined,
        status: playerMeta.status as string | undefined,
      };
    });

    return {
      success: true,
      data: {
        leagueKey: league.league_key,
        leagueName: league.name,
        position: position?.toUpperCase() || 'ALL',
        count: freeAgents.length,
        freeAgents
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: extractErrorCode(error)
    };
  }
}
```

**Important note:** The handlers are intentionally near-identical to football. The Yahoo API uses the same response structure across sports — only the `league_key` and position names differ. Do NOT try to DRY these into a shared handler. Keeping them separate per sport allows sport-specific adjustments later (e.g., baseball stat categories, rotisserie scoring).

**Step 2: Verify types**

Run: `cd workers/yahoo-client && npm run type-check`
Expected: No type errors

**Step 3: Commit**

```bash
git add workers/yahoo-client/src/sports/baseball/
git commit -m "feat(yahoo-client): add baseball handlers (5/5 tools)"
```

---

## Task 3: Wire up baseball routing in index.ts

**Files:**
- Modify: `workers/yahoo-client/src/index.ts:4` (add import)
- Modify: `workers/yahoo-client/src/index.ts:75-76` (update baseball case)

**Step 1: Add baseball handlers import**

At line 4, add the baseball import:

```typescript
import { baseballHandlers } from './sports/baseball/handlers';
```

**Step 2: Update the baseball case in routeToSport**

Replace the baseball case (line 75-76):

```typescript
    case 'baseball': {
      const handler = baseballHandlers[tool];
      if (!handler) {
        return {
          success: false,
          error: `Unknown baseball tool: ${tool}`,
          code: 'UNKNOWN_TOOL'
        };
      }
      return handler(env, params, authHeader, correlationId);
    }
```

**Step 3: Verify types**

Run: `cd workers/yahoo-client && npm run type-check`
Expected: No type errors

**Step 4: Commit**

```bash
git add workers/yahoo-client/src/index.ts
git commit -m "feat(yahoo-client): wire up baseball routing in index.ts"
```

---

## Task 4: Deploy and test end-to-end

**Step 1: Deploy yahoo-client to production**

Run: `cd workers/yahoo-client && npm run deploy:prod`
Expected: Deployed successfully

**Step 2: Test get_league_info via chat app**

In the Flaim chat app, ask about the Yahoo baseball league:
- "Tell me about my Yahoo baseball league Car Ramrod"

Check Cloudflare logs for `[yahoo-debug] get_league_info raw (baseball)`.

**Step 3: Test get_standings via chat app**

- "Show me the standings for Car Ramrod"

**Step 4: Test get_roster via chat app**

- "Show me my roster in Car Ramrod"

**Step 5: Test get_matchups via chat app**

- "Show me the matchups in Car Ramrod"

Note: If the baseball league uses rotisserie scoring (no head-to-head matchups), the scoreboard endpoint may return empty matchups. This is expected and correct behavior.

**Step 6: Test get_free_agents via chat app**

- "Show me free agent starting pitchers in Car Ramrod"

**Step 7: Iterate if needed**

If Yahoo response structure differs from expectations:
1. Check Cloudflare logs for actual structure
2. Adjust handler parsing
3. Re-deploy and re-test

**Step 8: Commit any fixes**

```bash
git add workers/yahoo-client/
git commit -m "fix(yahoo-client): adjust baseball handlers based on actual Yahoo API responses"
```

---

## Task 5: Update documentation

**Files:**
- Modify: `docs/STATUS.md`
- Modify: `docs/CHANGELOG.md`
- Modify: `docs/dev/ADD_YAHOO_PLATFORM.md`

**Step 1: Update STATUS.md**

Update the Yahoo Baseball column from all ❌ to all ✅:

```markdown
| `get_league_info` | ✅ | ✅ | ✅ | ✅ |
| `get_standings` | ✅ | ✅ | ✅ | ✅ |
| `get_matchups` | ✅ | ✅ | ✅ | ✅ |
| `get_roster` | ✅ | ✅ | ✅ | ✅ |
| `get_free_agents` | ✅ | ✅ | ✅ | ✅ |
```

Update the Yahoo Baseball checklist:

```markdown
### Yahoo Baseball (Phase 3) — 5/5 Complete ✅
- [x] `get_league_info`
- [x] `get_standings`
- [x] `get_matchups`
- [x] `get_roster`
- [x] `get_free_agents`
```

Update the Phase Roadmap to mark Phase 3 as complete.

Update the architecture diagram:

```
└── yahoo-client/sports/baseball/handlers.ts (5/5 tools)
```

**Step 2: Add CHANGELOG entry**

Update the existing Yahoo Fantasy Platform Support section under `[Unreleased]` to add:

```markdown
- **Added**: Yahoo baseball handlers: `get_league_info`, `get_standings`, `get_matchups`, `get_roster`, `get_free_agents`
- **Changed**: Yahoo Baseball now at full feature parity with ESPN (5/5 tools)
```

**Step 3: Update ADD_YAHOO_PLATFORM.md**

Mark Phase 3 as complete.

**Step 4: Commit**

```bash
git add docs/
git commit -m "docs: Yahoo Baseball at full feature parity (5/5 tools) - Phase 3 complete"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Create baseball position mappings |
| 2 | Create baseball handlers (all 5) |
| 3 | Wire up baseball routing in index.ts |
| 4 | Deploy and test E2E with "Car Ramrod" league |
| 5 | Update documentation |

**Total: 5 tasks**

After completion:
- ESPN Football: 5/5 ✅
- ESPN Baseball: 5/5 ✅
- Yahoo Football: 5/5 ✅
- Yahoo Baseball: 5/5 ✅ (NEW)
- **Full cross-platform parity achieved for all implemented sports**
