# Yahoo Client Worker (Phase 2) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create `yahoo-client` worker with 3 MCP tools (get_league_info, get_standings, get_roster) for Yahoo Fantasy Football.

**Architecture:** New Cloudflare Worker mirrors `espn-client` structure. Service binding to auth-worker for Yahoo OAuth tokens. Shared normalizers handle Yahoo's quirky JSON format. Gateway (`fantasy-mcp`) routes `platform: "yahoo"` requests to this worker.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers, Vitest

---

## Task 1: Scaffold yahoo-client worker

**Files:**
- Create: `workers/yahoo-client/package.json`
- Create: `workers/yahoo-client/tsconfig.json`
- Create: `workers/yahoo-client/wrangler.jsonc`
- Create: `workers/yahoo-client/src/types.ts`
- Create: `workers/yahoo-client/src/index.ts`

**Step 1: Create package.json**

```json
{
  "name": "yahoo-client",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "WRANGLER_LOG_PATH=../../.wrangler/logs WRANGLER_REGISTRY_PATH=../../.wrangler/registry wrangler dev --env dev --port 8790",
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

**Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create wrangler.jsonc**

```jsonc
{
  "name": "yahoo-client",
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
      "name": "yahoo-client",
      "workers_dev": true,
      "services": [
        { "binding": "AUTH_WORKER", "service": "auth-worker" }
      ],
      "vars": {
        "NODE_ENV": "production",
        "ENVIRONMENT": "prod"
      }
    },
    "preview": {
      "name": "yahoo-client-preview",
      "workers_dev": true,
      "services": [
        { "binding": "AUTH_WORKER", "service": "auth-worker-preview" }
      ],
      "vars": {
        "NODE_ENV": "production",
        "ENVIRONMENT": "preview"
      }
    },
    "dev": {
      "name": "yahoo-client-dev",
      "workers_dev": true,
      "services": [
        { "binding": "AUTH_WORKER", "service": "auth-worker-dev" }
      ],
      "vars": {
        "NODE_ENV": "development",
        "ENVIRONMENT": "dev"
      }
    }
  }
}
```

**Step 4: Create src/types.ts**

```typescript
// workers/yahoo-client/src/types.ts
import type { BaseEnvWithAuth } from '@flaim/worker-shared';

export interface Env extends BaseEnvWithAuth {
  // Yahoo-client uses AUTH_WORKER from BaseEnvWithAuth
}

export type Sport = 'football' | 'baseball' | 'basketball' | 'hockey';

export interface ExecuteRequest {
  tool: string;
  params: ToolParams;
  authHeader?: string;
}

export interface ToolParams {
  sport: Sport;
  league_id: string;      // Yahoo league_key (e.g., "449.l.12345")
  season_year: number;
  team_id?: string;       // Yahoo team_key (e.g., "449.l.12345.t.3")
  week?: number;
  position?: string;
  count?: number;
}

export interface ExecuteResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  code?: string;
}
```

**Step 5: Create src/index.ts (minimal)**

```typescript
// workers/yahoo-client/src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, ExecuteRequest, ExecuteResponse } from './types';
import { CORRELATION_ID_HEADER, getCorrelationId } from '@flaim/worker-shared';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'yahoo-client',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Main execute endpoint - called by fantasy-mcp gateway
app.post('/execute', async (c) => {
  const correlationId = getCorrelationId(c.req.raw);
  const body = await c.req.json<ExecuteRequest>();
  const { tool, params } = body;

  console.log(`[yahoo-client] ${correlationId} ${tool} ${params.sport} league=${params.league_id}`);

  // Placeholder - will be implemented in Task 3
  const response = c.json({
    success: false,
    error: 'Yahoo client not yet implemented',
    code: 'NOT_IMPLEMENTED'
  } satisfies ExecuteResponse);
  response.headers.set(CORRELATION_ID_HEADER, correlationId);
  return response;
});

// 404 handler
app.notFound((c) => {
  return c.json({
    error: 'Endpoint not found',
    endpoints: {
      '/health': 'GET - Health check',
      '/execute': 'POST - Execute tool (called by gateway)'
    }
  }, 404);
});

export default app;
```

**Step 6: Install dependencies and verify**

Run: `cd workers/yahoo-client && npm install`
Expected: Dependencies installed

Run: `npm run type-check`
Expected: No type errors

**Step 7: Commit**

```bash
git add workers/yahoo-client/
git commit -m "feat(yahoo-client): scaffold worker with health endpoint"
```

---

## Task 2: Add shared helpers (auth + yahoo-api + normalizers)

**Files:**
- Create: `workers/yahoo-client/src/shared/auth.ts`
- Create: `workers/yahoo-client/src/shared/yahoo-api.ts`
- Create: `workers/yahoo-client/src/shared/normalizers.ts`

**Step 1: Create src/shared/auth.ts**

```typescript
// workers/yahoo-client/src/shared/auth.ts
import type { Env } from '../types';
import { authWorkerFetch } from '@flaim/worker-shared';

export interface YahooCredentials {
  accessToken: string;
}

export async function getYahooCredentials(
  env: Env,
  authHeader?: string,
  correlationId?: string
): Promise<YahooCredentials | null> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authHeader) {
    headers['Authorization'] = authHeader;
  }
  if (correlationId) {
    headers['X-Correlation-ID'] = correlationId;
  }

  // Call auth-worker to get Yahoo token (handles refresh automatically)
  const response = await authWorkerFetch(env, '/connect/yahoo/credentials', {
    method: 'GET',
    headers
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(`Auth-worker error: ${errorData.error || response.statusText}`);
  }

  const data = await response.json() as { accessToken?: string };
  if (!data.accessToken) {
    throw new Error('Invalid credentials response from auth-worker');
  }

  return { accessToken: data.accessToken };
}
```

**Step 2: Create src/shared/yahoo-api.ts**

```typescript
// workers/yahoo-client/src/shared/yahoo-api.ts
import type { YahooCredentials } from './auth';

const YAHOO_BASE_URL = 'https://fantasysports.yahooapis.com/fantasy/v2';

interface YahooFetchOptions {
  credentials: YahooCredentials;
  timeout?: number;
}

/**
 * Make a request to the Yahoo Fantasy API
 * @param path - API path (e.g., /league/449.l.12345/standings)
 * @param options - Request options including credentials and timeout
 */
export async function yahooFetch(
  path: string,
  options: YahooFetchOptions
): Promise<Response> {
  const { credentials, timeout = 10000 } = options;

  // Always request JSON format
  const separator = path.includes('?') ? '&' : '?';
  const url = `${YAHOO_BASE_URL}${path}${separator}format=json`;

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${credentials.accessToken}`,
    'Accept': 'application/json',
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    console.log(`[yahoo-api] Fetching: ${path}`);
    const response = await fetch(url, {
      headers,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('YAHOO_TIMEOUT: Request timed out');
    }
    throw error;
  }
}

/**
 * Handle Yahoo API error responses
 */
export function handleYahooError(response: Response): never {
  switch (response.status) {
    case 401:
      throw new Error('YAHOO_AUTH_ERROR: Yahoo token expired or invalid');
    case 403:
      throw new Error('YAHOO_ACCESS_DENIED: Access denied to this resource');
    case 404:
      throw new Error('YAHOO_NOT_FOUND: League or resource not found');
    case 429:
      throw new Error('YAHOO_RATE_LIMITED: Too many requests. Please wait.');
    default:
      throw new Error(`YAHOO_API_ERROR: Yahoo returned ${response.status}`);
  }
}

/**
 * Require credentials to be present
 */
export function requireCredentials(
  credentials: YahooCredentials | null,
  context: string
): asserts credentials is YahooCredentials {
  if (!credentials) {
    throw new Error(
      `YAHOO_NOT_CONNECTED: Yahoo account not connected. ` +
      `Connect Yahoo at /leagues to use ${context}.`
    );
  }
}
```

**Step 3: Create src/shared/normalizers.ts**

```typescript
// workers/yahoo-client/src/shared/normalizers.ts

/**
 * Convert Yahoo's numeric-keyed objects to arrays.
 * Yahoo returns: {"0": {...}, "1": {...}, "count": 2}
 * We want: [{...}, {...}]
 */
export function asArray<T>(obj: Record<string, T> | T[] | undefined | null): T[] {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;

  const result: T[] = [];
  for (const key of Object.keys(obj)) {
    // Skip non-numeric keys like "count"
    if (/^\d+$/.test(key)) {
      result.push(obj[key]);
    }
  }
  return result;
}

/**
 * Safe deep path traversal.
 * getPath(data, ['fantasy_content', 'league', 0, 'name'])
 */
export function getPath(obj: unknown, path: (string | number)[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === 'object') {
      current = (current as Record<string | number, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Yahoo returns league data as: [metadata, nested_resources]
 * This extracts and merges them into a single object.
 */
export function unwrapLeague(leagueArray: unknown): Record<string, unknown> {
  if (!Array.isArray(leagueArray)) {
    console.warn('[normalizers] unwrapLeague: expected array, got', typeof leagueArray);
    return {};
  }

  // Index 0 is metadata (league_key, name, etc.)
  // Index 1+ are nested resources (standings, scoreboard, etc.)
  const metadata = (leagueArray[0] || {}) as Record<string, unknown>;
  const nested = (leagueArray[1] || {}) as Record<string, unknown>;

  return { ...metadata, ...nested };
}

/**
 * Yahoo returns team data as: [[metadata_array], other_data]
 * This extracts the team metadata.
 */
export function unwrapTeam(teamArray: unknown): Record<string, unknown> {
  if (!Array.isArray(teamArray)) {
    console.warn('[normalizers] unwrapTeam: expected array, got', typeof teamArray);
    return {};
  }

  // First element is array of metadata objects
  const metadataArray = teamArray[0];
  if (!Array.isArray(metadataArray)) {
    return {};
  }

  // Merge all metadata objects
  let result: Record<string, unknown> = {};
  for (const item of metadataArray) {
    if (typeof item === 'object' && item !== null) {
      result = { ...result, ...item };
    }
  }

  // Merge any additional data from index 1+
  for (let i = 1; i < teamArray.length; i++) {
    if (typeof teamArray[i] === 'object' && teamArray[i] !== null) {
      result = { ...result, ...teamArray[i] };
    }
  }

  return result;
}

/**
 * Debug helper - log raw Yahoo response structure
 */
export function logStructure(label: string, obj: unknown, depth = 2): void {
  const seen = new WeakSet();
  const replacer = (_key: string, value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  };
  console.log(`[yahoo-debug] ${label}:`, JSON.stringify(obj, replacer, 2).slice(0, 2000));
}
```

**Step 4: Verify types**

Run: `cd workers/yahoo-client && npm run type-check`
Expected: No type errors

**Step 5: Commit**

```bash
git add workers/yahoo-client/src/shared/
git commit -m "feat(yahoo-client): add auth, yahoo-api, and normalizer helpers"
```

---

## Task 3: Implement football handlers

**Files:**
- Create: `workers/yahoo-client/src/sports/football/handlers.ts`
- Create: `workers/yahoo-client/src/sports/football/mappings.ts`
- Modify: `workers/yahoo-client/src/index.ts`

**Step 1: Create src/sports/football/mappings.ts**

```typescript
// workers/yahoo-client/src/sports/football/mappings.ts

// Yahoo position IDs to readable names (football)
export const POSITION_MAP: Record<string, string> = {
  'QB': 'Quarterback',
  'WR': 'Wide Receiver',
  'RB': 'Running Back',
  'TE': 'Tight End',
  'K': 'Kicker',
  'DEF': 'Defense/Special Teams',
  'W/R': 'WR/RB Flex',
  'W/R/T': 'WR/RB/TE Flex',
  'W/T': 'WR/TE Flex',
  'Q/W/R/T': 'Superflex',
  'BN': 'Bench',
  'IR': 'Injured Reserve',
};

export function getPositionName(posAbbrev: string): string {
  return POSITION_MAP[posAbbrev] || posAbbrev;
}
```

**Step 2: Create src/sports/football/handlers.ts**

```typescript
// workers/yahoo-client/src/sports/football/handlers.ts
import type { Env, ToolParams, ExecuteResponse } from '../../types';
import { getYahooCredentials } from '../../shared/auth';
import { yahooFetch, handleYahooError, requireCredentials } from '../../shared/yahoo-api';
import { asArray, getPath, unwrapLeague, unwrapTeam, logStructure } from '../../shared/normalizers';
import { getPositionName } from './mappings';

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
};

function extractErrorCode(error: unknown): string {
  if (error instanceof Error) {
    const match = error.message.match(/^([A-Z_]+):/);
    if (match) return match[1];
  }
  return 'INTERNAL_ERROR';
}

/**
 * Get league information and settings
 */
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
    logStructure('get_league_info raw', raw);

    // Navigate Yahoo's structure: fantasy_content.league[0] = metadata
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

/**
 * Get league standings
 */
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
    logStructure('get_standings raw', raw);

    // Navigate: fantasy_content.league[0]=meta, [1]=standings
    const leagueArray = getPath(raw, ['fantasy_content', 'league']);
    const league = unwrapLeague(leagueArray);

    // standings.teams is numeric-keyed object
    const teamsObj = getPath(league, ['standings', 0, 'teams']) as Record<string, unknown> | undefined;
    const teamsArray = asArray(teamsObj);

    const standings = teamsArray.map((teamWrapper: unknown) => {
      // Each team is wrapped: {team: [[metadata], {team_standings: ...}]}
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

/**
 * Get team roster
 */
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

    // Optional week parameter
    const weekParam = week ? `;week=${week}` : '';
    const response = await yahooFetch(`/team/${team_id}/roster${weekParam}`, { credentials });

    if (!response.ok) {
      handleYahooError(response);
    }

    const raw = await response.json();
    logStructure('get_roster raw', raw);

    // Navigate: fantasy_content.team[0]=meta, [1]=roster
    const teamArray = getPath(raw, ['fantasy_content', 'team']);
    const team = unwrapTeam(teamArray as unknown[]);

    // roster.players is numeric-keyed object
    const rosterData = team.roster as Record<string, unknown> | undefined;
    const playersObj = getPath(rosterData, ['0', 'players']) as Record<string, unknown> | undefined;
    const playersArray = asArray(playersObj);

    const players = playersArray.map((playerWrapper: unknown) => {
      // Each player is wrapped: {player: [[metadata], {...}]}
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

      // Selected position is in second element
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
```

**Step 3: Update src/index.ts to route to handlers**

```typescript
// workers/yahoo-client/src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, ExecuteRequest, ExecuteResponse, Sport } from './types';
import { footballHandlers } from './sports/football/handlers';
import { CORRELATION_ID_HEADER, getCorrelationId } from '@flaim/worker-shared';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'yahoo-client',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Main execute endpoint - called by fantasy-mcp gateway
app.post('/execute', async (c) => {
  const correlationId = getCorrelationId(c.req.raw);
  const body = await c.req.json<ExecuteRequest>();
  const { tool, params, authHeader } = body;
  const { sport, league_id, season_year } = params;

  const startTime = Date.now();
  console.log(`[yahoo-client] ${correlationId} ${tool} ${sport} league=${league_id} season=${season_year}`);

  try {
    const result = await routeToSport(c.env, sport, tool, params, authHeader, correlationId);
    const duration = Date.now() - startTime;
    console.log(`[yahoo-client] ${correlationId} ${tool} ${sport} completed in ${duration}ms success=${result.success}`);
    const response = c.json(result);
    response.headers.set(CORRELATION_ID_HEADER, correlationId);
    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[yahoo-client] ${correlationId} ${tool} ${sport} failed in ${duration}ms: ${message}`);
    const response = c.json({
      success: false,
      error: message,
      code: 'INTERNAL_ERROR'
    } satisfies ExecuteResponse, 500);
    response.headers.set(CORRELATION_ID_HEADER, correlationId);
    return response;
  }
});

async function routeToSport(
  env: Env,
  sport: Sport,
  tool: string,
  params: ExecuteRequest['params'],
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  switch (sport) {
    case 'football': {
      const handler = footballHandlers[tool];
      if (!handler) {
        return {
          success: false,
          error: `Unknown football tool: ${tool}`,
          code: 'UNKNOWN_TOOL'
        };
      }
      return handler(env, params, authHeader, correlationId);
    }

    case 'baseball':
      return { success: false, error: 'Yahoo baseball not yet supported', code: 'NOT_SUPPORTED' };

    case 'basketball':
      return { success: false, error: 'Yahoo basketball not yet supported', code: 'NOT_SUPPORTED' };

    case 'hockey':
      return { success: false, error: 'Yahoo hockey not yet supported', code: 'NOT_SUPPORTED' };

    default:
      return { success: false, error: `Unknown sport: ${sport}`, code: 'INVALID_SPORT' };
  }
}

// 404 handler
app.notFound((c) => {
  return c.json({
    error: 'Endpoint not found',
    endpoints: {
      '/health': 'GET - Health check',
      '/execute': 'POST - Execute tool (called by gateway)'
    }
  }, 404);
});

export default app;
```

**Step 4: Verify types**

Run: `cd workers/yahoo-client && npm run type-check`
Expected: No type errors

**Step 5: Commit**

```bash
git add workers/yahoo-client/src/
git commit -m "feat(yahoo-client): implement football handlers (get_league_info, get_standings, get_roster)"
```

---

## Task 4: Add normalizer unit tests

**Files:**
- Create: `workers/yahoo-client/vitest.config.ts`
- Create: `workers/yahoo-client/src/__tests__/normalizers.test.ts`

**Step 1: Create vitest.config.ts**

```typescript
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
  },
});
```

**Step 2: Create src/__tests__/normalizers.test.ts**

```typescript
// workers/yahoo-client/src/__tests__/normalizers.test.ts
import { describe, it, expect } from 'vitest';
import { asArray, getPath, unwrapLeague, unwrapTeam } from '../shared/normalizers';

describe('normalizers', () => {
  describe('asArray', () => {
    it('converts numeric-keyed object to array', () => {
      const input = { '0': { id: 'a' }, '1': { id: 'b' }, 'count': 2 };
      const result = asArray(input);
      expect(result).toEqual([{ id: 'a' }, { id: 'b' }]);
    });

    it('returns empty array for null/undefined', () => {
      expect(asArray(null)).toEqual([]);
      expect(asArray(undefined)).toEqual([]);
    });

    it('returns array unchanged', () => {
      const input = [{ id: 'a' }, { id: 'b' }];
      expect(asArray(input)).toEqual(input);
    });

    it('skips non-numeric keys', () => {
      const input = { '0': 'first', 'meta': 'skip', '1': 'second' };
      expect(asArray(input)).toEqual(['first', 'second']);
    });
  });

  describe('getPath', () => {
    it('traverses nested objects', () => {
      const obj = { a: { b: { c: 'value' } } };
      expect(getPath(obj, ['a', 'b', 'c'])).toBe('value');
    });

    it('traverses arrays by index', () => {
      const obj = { items: [{ name: 'first' }, { name: 'second' }] };
      expect(getPath(obj, ['items', 1, 'name'])).toBe('second');
    });

    it('returns undefined for missing path', () => {
      const obj = { a: { b: 1 } };
      expect(getPath(obj, ['a', 'c', 'd'])).toBeUndefined();
    });

    it('returns undefined for null in path', () => {
      const obj = { a: null };
      expect(getPath(obj, ['a', 'b'])).toBeUndefined();
    });
  });

  describe('unwrapLeague', () => {
    it('merges metadata and nested resources', () => {
      const input = [
        { league_key: '449.l.123', name: 'My League' },
        { standings: [{ teams: {} }] }
      ];
      const result = unwrapLeague(input);
      expect(result.league_key).toBe('449.l.123');
      expect(result.name).toBe('My League');
      expect(result.standings).toEqual([{ teams: {} }]);
    });

    it('handles empty array', () => {
      expect(unwrapLeague([])).toEqual({});
    });

    it('handles non-array input', () => {
      expect(unwrapLeague('not an array')).toEqual({});
    });
  });

  describe('unwrapTeam', () => {
    it('extracts team metadata from nested arrays', () => {
      const input = [
        [{ team_key: '449.l.123.t.1' }, { name: 'Team Name' }],
        { team_standings: { rank: 1 } }
      ];
      const result = unwrapTeam(input);
      expect(result.team_key).toBe('449.l.123.t.1');
      expect(result.name).toBe('Team Name');
      expect(result.team_standings).toEqual({ rank: 1 });
    });

    it('handles empty array', () => {
      expect(unwrapTeam([])).toEqual({});
    });
  });
});
```

**Step 3: Run tests**

Run: `cd workers/yahoo-client && npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add workers/yahoo-client/vitest.config.ts workers/yahoo-client/src/__tests__/
git commit -m "test(yahoo-client): add normalizer unit tests"
```

---

## Task 5: Wire up gateway (fantasy-mcp)

**Files:**
- Modify: `workers/fantasy-mcp/wrangler.jsonc`
- Modify: `workers/fantasy-mcp/src/types.ts`
- Modify: `workers/fantasy-mcp/src/router.ts`

**Step 1: Update wrangler.jsonc to add YAHOO binding**

In each env section (prod, preview, dev), add the Yahoo service binding:

```jsonc
// workers/fantasy-mcp/wrangler.jsonc
// In "prod" services array, add:
{ "binding": "YAHOO", "service": "yahoo-client" }

// In "preview" services array, add:
{ "binding": "YAHOO", "service": "yahoo-client-preview" }

// In "dev" services array, add:
{ "binding": "YAHOO", "service": "yahoo-client-dev" }
```

**Step 2: Update types.ts to include YAHOO**

```typescript
// workers/fantasy-mcp/src/types.ts
import type { BaseEnvWithAuth } from '@flaim/worker-shared';

export interface Env extends BaseEnvWithAuth {
  ESPN: Fetcher;        // Service binding to espn-client
  YAHOO: Fetcher;       // Service binding to yahoo-client
  AUTH_WORKER: Fetcher; // Service binding to auth-worker
}

export type Platform = 'espn' | 'yahoo';
export type Sport = 'football' | 'baseball' | 'basketball' | 'hockey';

export interface ToolParams {
  platform: Platform;
  sport: Sport;
  league_id: string;
  season_year: number;
  team_id?: string;
  week?: number;
  position?: string;
  count?: number;
}
```

**Step 3: Update router.ts to route to Yahoo**

```typescript
// workers/fantasy-mcp/src/router.ts - update selectClient function
function selectClient(env: Env, platform: Platform): Fetcher | null {
  switch (platform) {
    case 'espn':
      return env.ESPN;
    case 'yahoo':
      return env.YAHOO;
    default:
      return null;
  }
}
```

**Step 4: Verify types**

Run: `cd workers/fantasy-mcp && npm run type-check`
Expected: No type errors

**Step 5: Commit**

```bash
git add workers/fantasy-mcp/
git commit -m "feat(fantasy-mcp): add Yahoo routing via service binding"
```

---

## Task 6: Deploy and test end-to-end

**Step 1: Deploy yahoo-client to preview**

Run: `cd workers/yahoo-client && npm run deploy:preview`
Expected: Deployed to yahoo-client-preview.gerrygugger.workers.dev

**Step 2: Deploy fantasy-mcp to preview**

Run: `cd workers/fantasy-mcp && npm run deploy:preview`
Expected: Deployed with YAHOO binding

**Step 3: Test via MCP tool call**

Use Claude/ChatGPT connected to the preview MCP endpoint, or test directly:

```bash
# Test health endpoint
curl https://yahoo-client-preview.gerrygugger.workers.dev/health

# Test via gateway (requires auth) - use browser/app to trigger a Yahoo tool call
```

**Step 4: Check Cloudflare logs for Yahoo API responses**

Go to Cloudflare Dashboard → Workers → yahoo-client-preview → Logs

Look for `[yahoo-debug]` log lines showing raw Yahoo JSON structure.

**Step 5: Iterate on normalizers if needed**

Based on actual Yahoo responses, adjust normalizers in `shared/normalizers.ts` and handlers in `sports/football/handlers.ts`.

**Step 6: Deploy to production when working**

```bash
cd workers/yahoo-client && npm run deploy:prod
cd workers/fantasy-mcp && npm run deploy:prod
```

**Step 7: Final commit**

```bash
git add .
git commit -m "feat: yahoo-client Phase 2 complete - football tools working"
```

---

## Task 7: Update documentation

**Files:**
- Modify: `docs/dev/ADD_YAHOO_PLATFORM.md`
- Modify: `docs/CHANGELOG.md`

**Step 1: Update ADD_YAHOO_PLATFORM.md Phase 2 status**

Mark Phase 2 as complete:

```markdown
### Phase 2: yahoo-client worker (Football) ✅ COMPLETE

1. ✅ Created `yahoo-client` worker with service binding
2. ✅ Added football handlers (get_league_info, get_standings, get_roster)
3. ✅ Built Yahoo JSON normalizers
4. ✅ Wired gateway routing for platform: "yahoo"
5. ✅ Tested end-to-end
```

**Step 2: Add CHANGELOG entry**

Add under `[Unreleased]`:

```markdown
### Yahoo Fantasy Football Support (Phase 2)
- **Added**: `yahoo-client` worker for Yahoo Fantasy API calls
- **Added**: Football tools: `get_league_info`, `get_standings`, `get_roster`
- **Added**: Yahoo JSON normalizers for API response parsing
- **Changed**: Gateway (`fantasy-mcp`) now routes `platform: "yahoo"` to yahoo-client
```

**Step 3: Commit**

```bash
git add docs/
git commit -m "docs: update for Yahoo Phase 2 completion"
```

---

## Summary

| Task | Description | Estimated |
|------|-------------|-----------|
| 1 | Scaffold yahoo-client worker | 10 min |
| 2 | Add shared helpers (auth, api, normalizers) | 15 min |
| 3 | Implement football handlers | 20 min |
| 4 | Add normalizer unit tests | 10 min |
| 5 | Wire up gateway | 10 min |
| 6 | Deploy and test e2e | 20 min |
| 7 | Update documentation | 5 min |

**Total: 7 tasks, ~90 min**

After completion, Yahoo Fantasy Football users can use:
- `get_league_info` - League settings and metadata
- `get_standings` - Team rankings and records
- `get_roster` - Player roster for a team
