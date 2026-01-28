# Yahoo Football Feature Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `get_matchups` and `get_free_agents` handlers to yahoo-client to achieve 5/5 Yahoo Football feature parity with ESPN.

**Architecture:** Add two new handler functions to the existing `handlers.ts` file. Each handler calls the Yahoo Fantasy API, parses the quirky nested JSON using existing normalizers, and returns a response shape matching ESPN's format. Add position filter mapping to `mappings.ts` for free agents.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers, Yahoo Fantasy API

---

## Task 1: Add position filter mapping for free agents

**Files:**
- Modify: `workers/yahoo-client/src/sports/football/mappings.ts`

**Step 1: Add position filter mapping**

Open `workers/yahoo-client/src/sports/football/mappings.ts` and add after the existing `POSITION_MAP`:

```typescript
// Position abbreviations for Yahoo free agent filter
// Yahoo accepts these directly in the ;position= parameter
export const FA_POSITION_FILTER: Record<string, string> = {
  'ALL': '',           // No filter
  'QB': 'QB',
  'WR': 'WR',
  'RB': 'RB',
  'TE': 'TE',
  'K': 'K',
  'DEF': 'DEF',
  'FLEX': 'W/R/T',     // Maps to Yahoo's flex designation
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
git add workers/yahoo-client/src/sports/football/mappings.ts
git commit -m "feat(yahoo-client): add position filter mapping for free agents"
```

---

## Task 2: Implement get_matchups handler

**Files:**
- Modify: `workers/yahoo-client/src/sports/football/handlers.ts:13-17` (add to exports)
- Modify: `workers/yahoo-client/src/sports/football/handlers.ts` (add handler function)

**Step 1: Add get_matchups to the handlers export**

In `handlers.ts`, update the `footballHandlers` export (around line 13-17):

```typescript
export const footballHandlers: Record<string, HandlerFn> = {
  get_league_info: handleGetLeagueInfo,
  get_standings: handleGetStandings,
  get_roster: handleGetRoster,
  get_matchups: handleGetMatchups,
};
```

**Step 2: Add the handleGetMatchups function**

Add this function after `handleGetRoster` (after line 221):

```typescript
/**
 * Get league matchups/scoreboard for a week
 */
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

    // Yahoo uses semicolon params: /league/{key}/scoreboard;week=N
    const weekParam = week ? `;week=${week}` : '';
    const response = await yahooFetch(`/league/${league_id}/scoreboard${weekParam}`, { credentials });

    if (!response.ok) {
      handleYahooError(response);
    }

    const raw = await response.json();
    logStructure('get_matchups raw', raw);

    // Navigate: fantasy_content.league[0]=meta, [1]=scoreboard
    const leagueArray = getPath(raw, ['fantasy_content', 'league']);
    const league = unwrapLeague(leagueArray);

    // Get current week from league metadata
    const currentWeek = league.current_week as number | undefined;

    // scoreboard.matchups is numeric-keyed object
    const scoreboardData = league.scoreboard as Record<string, unknown> | undefined;
    const matchupsObj = getPath(scoreboardData, ['0', 'matchups']) as Record<string, unknown> | undefined;
    const matchupsArray = asArray(matchupsObj);

    const matchups = matchupsArray.map((matchupWrapper: unknown, index: number) => {
      // Each matchup is wrapped: {matchup: [[metadata], {teams: ...}]}
      const matchupData = getPath(matchupWrapper, ['matchup']) as unknown[];

      // First element is array with metadata
      const metaArray = matchupData?.[0] as unknown[];
      let matchupMeta: Record<string, unknown> = {};
      if (Array.isArray(metaArray)) {
        for (const item of metaArray) {
          if (typeof item === 'object' && item !== null) {
            matchupMeta = { ...matchupMeta, ...item };
          }
        }
      }

      // Second element has teams
      const teamsContainer = matchupData?.[1] as Record<string, unknown> | undefined;
      const teamsObj = teamsContainer?.teams as Record<string, unknown> | undefined;
      const teamsArray = asArray(teamsObj);

      // Parse the two teams (home = index 0, away = index 1)
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

      // Determine winner if matchup is complete
      let winner: string | undefined;
      if (matchupMeta.status === 'postevent' && home && away) {
        if (home.points > away.points) winner = 'home';
        else if (away.points > home.points) winner = 'away';
        else winner = 'tie';
      }

      return {
        matchupId: index + 1,
        week: matchupMeta.week as number || week || currentWeek,
        status: matchupMeta.status as string,
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
```

**Step 3: Verify types**

Run: `cd workers/yahoo-client && npm run type-check`
Expected: No type errors

**Step 4: Commit**

```bash
git add workers/yahoo-client/src/sports/football/handlers.ts
git commit -m "feat(yahoo-client): implement get_matchups handler for Yahoo Football"
```

---

## Task 3: Implement get_free_agents handler

**Files:**
- Modify: `workers/yahoo-client/src/sports/football/handlers.ts:13-18` (add to exports)
- Modify: `workers/yahoo-client/src/sports/football/handlers.ts` (add handler function)
- Modify: `workers/yahoo-client/src/sports/football/handlers.ts:5` (add import)

**Step 1: Add import for position filter**

At the top of `handlers.ts`, update the import from mappings (around line 5, if not already importing):

```typescript
import { getPositionFilter } from './mappings';
```

**Step 2: Add get_free_agents to the handlers export**

Update the `footballHandlers` export:

```typescript
export const footballHandlers: Record<string, HandlerFn> = {
  get_league_info: handleGetLeagueInfo,
  get_standings: handleGetStandings,
  get_roster: handleGetRoster,
  get_matchups: handleGetMatchups,
  get_free_agents: handleGetFreeAgents,
};
```

**Step 3: Add the handleGetFreeAgents function**

Add this function after `handleGetMatchups`:

```typescript
/**
 * Get available free agents
 */
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

    // Build Yahoo query params
    // ;status=FA for free agents, ;count=N for limit, ;position=POS for filter
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
    logStructure('get_free_agents raw', raw);

    // Navigate: fantasy_content.league[0]=meta, [1]=players
    const leagueArray = getPath(raw, ['fantasy_content', 'league']);
    const league = unwrapLeague(leagueArray);

    // players is numeric-keyed object
    const playersObj = league.players as Record<string, unknown> | undefined;
    const playersArray = asArray(playersObj);

    const freeAgents = playersArray.map((playerWrapper: unknown) => {
      // Each player is wrapped: {player: [[metadata], ...]}
      const playerData = getPath(playerWrapper, ['player']) as unknown[];

      // Player metadata is in first array
      const metaArray = playerData?.[0] as unknown[];
      let playerMeta: Record<string, unknown> = {};
      if (Array.isArray(metaArray)) {
        for (const item of metaArray) {
          if (typeof item === 'object' && item !== null) {
            playerMeta = { ...playerMeta, ...item };
          }
        }
      }

      // Ownership data may be in second element
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

**Step 4: Verify types**

Run: `cd workers/yahoo-client && npm run type-check`
Expected: No type errors

**Step 5: Commit**

```bash
git add workers/yahoo-client/src/sports/football/handlers.ts
git commit -m "feat(yahoo-client): implement get_free_agents handler for Yahoo Football"
```

---

## Task 4: Deploy and test end-to-end

**Step 1: Deploy yahoo-client to production**

Run: `cd workers/yahoo-client && npm run deploy:prod`
Expected: Deployed successfully to yahoo-client.gerrygugger.workers.dev

**Step 2: Test get_matchups via chat app**

In the Flaim chat app:
1. Select your Yahoo Football league
2. Ask: "Show me this week's matchups"
3. Verify response shows matchup data

Check Cloudflare logs for `[yahoo-debug] get_matchups raw` to see the Yahoo response structure.

**Step 3: Test get_free_agents via chat app**

In the Flaim chat app:
1. Ask: "Show me available free agent quarterbacks"
2. Verify response shows QB free agents

Check Cloudflare logs for `[yahoo-debug] get_free_agents raw` to see the Yahoo response structure.

**Step 4: Iterate if needed**

If the Yahoo response structure differs from expectations:
1. Check logs for actual structure
2. Update normalizer calls in handlers
3. Re-deploy and re-test

**Step 5: Commit any fixes**

```bash
git add workers/yahoo-client/
git commit -m "fix(yahoo-client): adjust handlers based on actual Yahoo API responses"
```

---

## Task 5: Update documentation

**Files:**
- Modify: `docs/FEATURE_PARITY.md`
- Modify: `docs/CHANGELOG.md`

**Step 1: Update FEATURE_PARITY.md**

Update the Yahoo Football row to show 5/5:

```markdown
| `get_matchups` | ✅ | ✅ | ✅ | ❌ |
| `get_free_agents` | ✅ | ✅ | ✅ | ❌ |
```

Update the checklist:

```markdown
### Yahoo Football (Phase 2) — 5/5 Complete
- [x] `get_league_info`
- [x] `get_standings`
- [x] `get_matchups`
- [x] `get_roster`
- [x] `get_free_agents`
```

**Step 2: Add CHANGELOG entry**

Add under `[Unreleased]`:

```markdown
### Yahoo Football Feature Parity
- **Added**: `get_matchups` handler for Yahoo Football scoreboard data
- **Added**: `get_free_agents` handler for Yahoo Football free agent search
- **Changed**: Yahoo Football now at full feature parity with ESPN (5/5 tools)
```

**Step 3: Commit**

```bash
git add docs/FEATURE_PARITY.md docs/CHANGELOG.md
git commit -m "docs: Yahoo Football at full feature parity (5/5 tools)"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Add position filter mapping |
| 2 | Implement get_matchups handler |
| 3 | Implement get_free_agents handler |
| 4 | Deploy and test E2E |
| 5 | Update documentation |

**Total: 5 tasks**

After completion:
- Yahoo Football: 5/5 tools ✅
- ESPN Football: 5/5 tools ✅
- Full feature parity achieved for football
