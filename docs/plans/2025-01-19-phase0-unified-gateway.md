# Phase 0: Unified Gateway Scaffolding Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the unified gateway architecture (`fantasy-mcp` + `espn-client`) while maintaining backward compatibility, so existing ESPN functionality works through the new gateway before adding Yahoo support.

**Architecture:** Create a `fantasy-mcp` gateway worker that exposes unified MCP tools and routes to platform-specific workers (`espn-client`) via service bindings. The gateway handles MCP protocol, auth pass-through, and routing. Platform workers handle sport-specific API calls.

**Tech Stack:** Cloudflare Workers, Hono, MCP SDK, TypeScript, Service Bindings, Zod

---

## Overview

Phase 0 is the foundation for multi-platform support. We're creating:
1. `fantasy-mcp` - Gateway worker exposing unified tools
2. `espn-client` - Internal worker handling all ESPN sports

The old workers (`baseball-espn-mcp`, `football-espn-mcp`) continue working during migration. We'll deprecate them after the gateway is validated.

**Key principle:** No user-facing changes. The gateway must produce identical outputs to the current workers.

---

## Task 1: Create espn-client worker scaffold

**Files:**
- Create: `workers/espn-client/wrangler.jsonc`
- Create: `workers/espn-client/package.json`
- Create: `workers/espn-client/tsconfig.json`
- Create: `workers/espn-client/src/index.ts`
- Create: `workers/espn-client/src/types.ts`

**Step 1: Create wrangler.jsonc**

```jsonc
// workers/espn-client/wrangler.jsonc
{
  "name": "espn-client",
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
      "name": "espn-client",
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
      "name": "espn-client-preview",
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
      "name": "espn-client-dev",
      "workers_dev": true,
      "services": [
        { "binding": "AUTH_WORKER", "service": "auth-worker-dev" }
      ],
      "vars": {
        "NODE_ENV": "development",
        "ENVIRONMENT": "dev",
        "AUTH_WORKER_URL": "https://auth-worker-dev.gerrygugger.workers.dev"
      }
    }
  }
}
```

**Step 2: Create package.json**

```json
{
  "name": "espn-client",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev --env dev --port 8789",
    "deploy:dev": "wrangler deploy --env dev",
    "deploy:preview": "wrangler deploy --env preview",
    "deploy:prod": "wrangler deploy --env prod"
  },
  "dependencies": {
    "@flaim/worker-shared": "*",
    "hono": "^4.7.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.0.0",
    "typescript": "^5.7.0",
    "wrangler": "^4.53.0"
  }
}
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "paths": {
      "@flaim/worker-shared": ["../shared/src"]
    }
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**Step 4: Create types.ts**

```typescript
// workers/espn-client/src/types.ts
import type { BaseEnvWithAuth } from '@flaim/worker-shared';

export interface Env extends BaseEnvWithAuth {
  // ESPN-client specific vars if needed
}

export type Sport = 'football' | 'baseball' | 'basketball' | 'hockey';

export interface ExecuteRequest {
  tool: string;
  params: ToolParams;
  authHeader?: string;
}

export interface ToolParams {
  sport: Sport;
  league_id: string;
  season_year: number;
  team_id?: string;
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

**Step 5: Create index.ts entry point**

```typescript
// workers/espn-client/src/index.ts
import { Hono } from 'hono';
import type { Env, ExecuteRequest, ExecuteResponse, Sport } from './types';

const app = new Hono<{ Bindings: Env }>();

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'espn-client',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Main execute endpoint - called by fantasy-mcp gateway via service binding
app.post('/execute', async (c) => {
  const body = await c.req.json<ExecuteRequest>();
  const { tool, params, authHeader } = body;
  const { sport } = params;

  // Route to sport-specific handler
  try {
    const result = await routeToSport(c.env, sport, tool, params, authHeader);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({
      success: false,
      error: message,
      code: 'INTERNAL_ERROR'
    } satisfies ExecuteResponse, 500);
  }
});

async function routeToSport(
  env: Env,
  sport: Sport,
  tool: string,
  params: ExecuteRequest['params'],
  authHeader?: string
): Promise<ExecuteResponse> {
  switch (sport) {
    case 'football':
      // TODO: Import and call football handlers
      return { success: false, error: 'Football handlers not yet implemented', code: 'NOT_IMPLEMENTED' };
    case 'baseball':
      // TODO: Import and call baseball handlers
      return { success: false, error: 'Baseball handlers not yet implemented', code: 'NOT_IMPLEMENTED' };
    case 'basketball':
      return { success: false, error: 'Basketball not yet supported', code: 'NOT_SUPPORTED' };
    case 'hockey':
      return { success: false, error: 'Hockey not yet supported', code: 'NOT_SUPPORTED' };
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

**Step 6: Run npm install in espn-client**

Run: `cd workers/espn-client && npm install`
Expected: Dependencies installed successfully

**Step 7: Test local dev server starts**

Run: `cd workers/espn-client && npm run dev`
Expected: Server starts on port 8789

**Step 8: Test health endpoint**

Run: `curl http://localhost:8789/health`
Expected: JSON with `status: "healthy"`, `service: "espn-client"`

**Step 9: Commit**

```bash
git add workers/espn-client/
git commit -m "feat: scaffold espn-client worker

- Add wrangler.jsonc with service bindings
- Add package.json with dependencies
- Add basic Hono app with /health and /execute endpoints
- Add types for ExecuteRequest/Response
- Sport routing stub (handlers not yet implemented)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Create fantasy-mcp gateway worker scaffold

**Files:**
- Create: `workers/fantasy-mcp/wrangler.jsonc`
- Create: `workers/fantasy-mcp/package.json`
- Create: `workers/fantasy-mcp/tsconfig.json`
- Create: `workers/fantasy-mcp/src/index.ts`
- Create: `workers/fantasy-mcp/src/types.ts`
- Create: `workers/fantasy-mcp/src/router.ts`

**Step 1: Create wrangler.jsonc**

```jsonc
// workers/fantasy-mcp/wrangler.jsonc
{
  "name": "fantasy-mcp",
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
      "name": "fantasy-mcp",
      "workers_dev": true,
      "routes": [
        {
          "pattern": "api.flaim.app/fantasy/*",
          "zone_name": "flaim.app"
        }
      ],
      "services": [
        { "binding": "ESPN", "service": "espn-client" },
        { "binding": "AUTH", "service": "auth-worker" }
      ],
      "vars": {
        "NODE_ENV": "production",
        "ENVIRONMENT": "prod",
        "AUTH_WORKER_URL": "https://auth-worker.gerrygugger.workers.dev"
      }
    },
    "preview": {
      "name": "fantasy-mcp-preview",
      "workers_dev": true,
      "services": [
        { "binding": "ESPN", "service": "espn-client-preview" },
        { "binding": "AUTH", "service": "auth-worker-preview" }
      ],
      "vars": {
        "NODE_ENV": "production",
        "ENVIRONMENT": "preview",
        "AUTH_WORKER_URL": "https://auth-worker-preview.gerrygugger.workers.dev"
      }
    },
    "dev": {
      "name": "fantasy-mcp-dev",
      "workers_dev": true,
      "services": [
        { "binding": "ESPN", "service": "espn-client-dev" },
        { "binding": "AUTH", "service": "auth-worker-dev" }
      ],
      "vars": {
        "NODE_ENV": "development",
        "ENVIRONMENT": "dev",
        "AUTH_WORKER_URL": "https://auth-worker-dev.gerrygugger.workers.dev"
      }
    }
  }
}
```

**Step 2: Create package.json**

```json
{
  "name": "fantasy-mcp",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev --env dev --port 8790",
    "deploy:dev": "wrangler deploy --env dev",
    "deploy:preview": "wrangler deploy --env preview",
    "deploy:prod": "wrangler deploy --env prod"
  },
  "dependencies": {
    "@flaim/worker-shared": "*",
    "@modelcontextprotocol/sdk": "^1.25.2",
    "hono": "^4.7.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.0.0",
    "typescript": "^5.7.0",
    "wrangler": "^4.53.0"
  }
}
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "paths": {
      "@flaim/worker-shared": ["../shared/src"]
    }
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

**Step 4: Create types.ts**

```typescript
// workers/fantasy-mcp/src/types.ts
import type { BaseEnvWithAuth } from '@flaim/worker-shared';

export interface Env extends BaseEnvWithAuth {
  ESPN: Fetcher;      // Service binding to espn-client
  AUTH: Fetcher;      // Service binding to auth-worker
  // YAHOO: Fetcher;  // Future: Yahoo client binding
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

**Step 5: Create router.ts**

```typescript
// workers/fantasy-mcp/src/router.ts
import type { Env, Platform, ToolParams } from './types';

export interface RouteResult {
  success: boolean;
  data?: unknown;
  error?: string;
  code?: string;
}

/**
 * Route a tool call to the appropriate platform worker via service binding.
 */
export async function routeToClient(
  env: Env,
  tool: string,
  params: ToolParams,
  authHeader?: string
): Promise<RouteResult> {
  const { platform } = params;

  // Select the service binding based on platform
  const client = selectClient(env, platform);
  if (!client) {
    return {
      success: false,
      error: `Platform "${platform}" is not yet supported`,
      code: 'PLATFORM_NOT_SUPPORTED'
    };
  }

  // Forward request to platform worker
  try {
    const response = await client.fetch(
      new Request('https://internal/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tool,
          params,
          authHeader
        })
      })
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error?: string; code?: string };
      return {
        success: false,
        error: errorData.error || `Platform worker returned ${response.status}`,
        code: errorData.code || 'PLATFORM_ERROR'
      };
    }

    return await response.json() as RouteResult;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to reach platform worker',
      code: 'ROUTING_ERROR'
    };
  }
}

function selectClient(env: Env, platform: Platform): Fetcher | null {
  switch (platform) {
    case 'espn':
      return env.ESPN;
    case 'yahoo':
      // Future: return env.YAHOO;
      return null;
    default:
      return null;
  }
}
```

**Step 6: Create index.ts entry point**

```typescript
// workers/fantasy-mcp/src/index.ts
import { Hono } from 'hono';
import {
  createMcpCorsHeaders,
  isCorsPreflightRequest,
} from '@flaim/worker-shared';
import type { Env } from './types';
import { routeToClient } from './router';

const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use('*', async (c, next) => {
  if (isCorsPreflightRequest(c.req.raw)) {
    return new Response(null, {
      status: 200,
      headers: createMcpCorsHeaders(c.req.raw),
    });
  }
  await next();
  const corsHeaders = createMcpCorsHeaders(c.req.raw);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    if (!c.res.headers.has(key)) {
      c.res.headers.set(key, value);
    }
  });
  return undefined;
});

// Health check
app.get('/health', async (c) => {
  const healthData: Record<string, unknown> = {
    status: 'healthy',
    service: 'fantasy-mcp',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    bindings: {
      espn: !!c.env.ESPN,
      auth: !!c.env.AUTH,
    }
  };

  // Test ESPN client connectivity
  if (c.env.ESPN) {
    try {
      const espnHealth = await c.env.ESPN.fetch(
        new Request('https://internal/health')
      );
      healthData.espn_status = espnHealth.ok ? 'connected' : 'error';
    } catch {
      healthData.espn_status = 'unreachable';
      healthData.status = 'degraded';
    }
  } else {
    healthData.espn_status = 'no_binding';
    healthData.status = 'degraded';
  }

  const statusCode = healthData.status === 'healthy' ? 200 : 503;
  return c.json(healthData, statusCode);
});

// OAuth Protected Resource Metadata (RFC 9728)
app.get('/.well-known/oauth-protected-resource', (c) => {
  return c.json({
    resource: 'https://api.flaim.app/fantasy/mcp',
    authorization_servers: ['https://api.flaim.app'],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp:read', 'mcp:write']
  }, 200, {
    'Cache-Control': 'public, max-age=3600'
  });
});

// MCP endpoints - placeholder until MCP SDK integration
app.all('/mcp', async (c) => {
  return c.json({
    error: 'MCP endpoint not yet implemented',
    message: 'This gateway will expose unified MCP tools'
  }, 501);
});

app.all('/mcp/*', async (c) => {
  return c.json({
    error: 'MCP endpoint not yet implemented'
  }, 501);
});

// 404 handler
app.notFound((c) => {
  return c.json({
    error: 'Endpoint not found',
    endpoints: {
      '/health': 'GET - Health check with binding status',
      '/.well-known/oauth-protected-resource': 'GET - OAuth metadata',
      '/mcp': 'POST - MCP protocol (not yet implemented)'
    }
  }, 404);
});

export default app;
```

**Step 7: Run npm install in fantasy-mcp**

Run: `cd workers/fantasy-mcp && npm install`
Expected: Dependencies installed successfully

**Step 8: Test local dev server starts**

Run: `cd workers/fantasy-mcp && npm run dev`
Expected: Server starts on port 8790

**Step 9: Test health endpoint**

Run: `curl http://localhost:8790/health`
Expected: JSON with `status: "healthy"` or `"degraded"`, `service: "fantasy-mcp"`

**Step 10: Commit**

```bash
git add workers/fantasy-mcp/
git commit -m "feat: scaffold fantasy-mcp gateway worker

- Add wrangler.jsonc with ESPN and AUTH service bindings
- Add router.ts for platform routing via service bindings
- Add basic Hono app with /health and MCP endpoint stubs
- Add types for Platform, Sport, ToolParams

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Update root package.json scripts

**Files:**
- Modify: `package.json` (root)

**Step 1: Add new worker scripts to root package.json**

Add these scripts to the `scripts` section in root `package.json`:

```json
{
  "scripts": {
    "dev:espn-client": "cd workers/espn-client && npm run dev",
    "dev:fantasy-mcp": "cd workers/fantasy-mcp && npm run dev",
    "deploy:espn-client:preview": "cd workers/espn-client && npm run deploy:preview",
    "deploy:espn-client:prod": "cd workers/espn-client && npm run deploy:prod",
    "deploy:fantasy-mcp:preview": "cd workers/fantasy-mcp && npm run deploy:preview",
    "deploy:fantasy-mcp:prod": "cd workers/fantasy-mcp && npm run deploy:prod"
  }
}
```

Also update `dev:workers` if it exists to include the new workers (or keep them separate for now during migration).

**Step 2: Commit**

```bash
git add package.json
git commit -m "chore: add scripts for new gateway workers

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Migrate baseball handlers to espn-client

**Files:**
- Create: `workers/espn-client/src/sports/baseball/handlers.ts`
- Create: `workers/espn-client/src/sports/baseball/mappings.ts`
- Create: `workers/espn-client/src/shared/espn-api.ts`
- Create: `workers/espn-client/src/shared/auth.ts`
- Modify: `workers/espn-client/src/index.ts`

This task extracts the baseball-specific code from `baseball-espn-mcp` into the new `espn-client` structure.

**Step 1: Create shared/auth.ts for credential fetching**

```typescript
// workers/espn-client/src/shared/auth.ts
import type { Env } from '../types';
import { authWorkerFetch, type EspnCredentials } from '@flaim/worker-shared';

export async function getCredentials(
  env: Env,
  authHeader?: string
): Promise<EspnCredentials | null> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authHeader) {
    headers['Authorization'] = authHeader;
  }

  const response = await authWorkerFetch(env, '/credentials/espn?raw=true', {
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

  const data = await response.json() as { success?: boolean; credentials?: EspnCredentials };
  if (!data.success || !data.credentials) {
    throw new Error('Invalid credentials response from auth-worker');
  }

  return data.credentials;
}
```

**Step 2: Create shared/espn-api.ts for ESPN API calls**

```typescript
// workers/espn-client/src/shared/espn-api.ts
import type { EspnCredentials } from '@flaim/worker-shared';

const ESPN_BASE_URL = 'https://lm-api-reads.fantasy.espn.com/apis/v3';

interface EspnFetchOptions {
  credentials?: EspnCredentials;
  timeout?: number;
}

export async function espnFetch(
  path: string,
  gameId: string,
  options: EspnFetchOptions = {}
): Promise<Response> {
  const { credentials, timeout = 5000 } = options;

  const url = `${ESPN_BASE_URL}/games/${gameId}${path}`;

  const headers: Record<string, string> = {
    'User-Agent': 'espn-client/1.0',
    'Accept': 'application/json',
    'X-Fantasy-Source': 'kona',
    'X-Fantasy-Platform': 'kona-web-2.0.0',
  };

  if (credentials) {
    headers['Cookie'] = `SWID=${credentials.swid}; espn_s2=${credentials.s2}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

export function handleEspnError(response: Response): never {
  switch (response.status) {
    case 401:
      throw new Error('ESPN_COOKIES_EXPIRED: ESPN session expired');
    case 403:
      throw new Error('ESPN_ACCESS_DENIED: Access denied to this league');
    case 404:
      throw new Error('ESPN_NOT_FOUND: League or resource not found');
    case 429:
      throw new Error('ESPN_RATE_LIMIT: Too many requests to ESPN');
    default:
      throw new Error(`ESPN_API_ERROR: ESPN returned ${response.status}`);
  }
}
```

**Step 3: Create sports/baseball/mappings.ts**

Copy the mappings from `workers/baseball-espn-mcp/src/transforms/baseball.ts`:

```typescript
// workers/espn-client/src/sports/baseball/mappings.ts

export const POSITION_MAP: Record<number, string> = {
  0: 'C', 1: '1B', 2: '2B', 3: '3B', 4: 'SS', 5: 'LF',
  6: 'CF', 7: 'RF', 8: 'DH', 9: 'UTIL', 10: 'P',
  11: 'SP', 12: 'RP', 13: 'OF', 14: 'BENCH', 15: 'IL',
  16: 'IL+', 17: 'NA', 19: 'NA'
};

export const LINEUP_SLOT_MAP: Record<number, string> = {
  0: 'C', 1: '1B', 2: '2B', 3: '3B', 4: 'SS', 5: 'LF',
  6: 'CF', 7: 'RF', 12: 'DH', 13: 'UTIL', 14: 'P',
  15: 'SP', 16: 'RP', 19: 'OF', 20: 'BE', 21: 'IL',
  24: 'IL+', 25: 'NA'
};

export const PRO_TEAM_MAP: Record<number, string> = {
  0: 'FA', 1: 'BAL', 2: 'BOS', 3: 'LAA', 4: 'CHW', 5: 'CLE',
  6: 'DET', 7: 'KC', 8: 'MIL', 9: 'MIN', 10: 'NYY',
  11: 'OAK', 12: 'SEA', 13: 'TEX', 14: 'TOR', 15: 'ATL',
  16: 'CHC', 17: 'CIN', 18: 'HOU', 19: 'LAD', 20: 'WSH',
  21: 'NYM', 22: 'PHI', 23: 'PIT', 24: 'STL', 25: 'SD',
  26: 'SF', 27: 'COL', 28: 'MIA', 29: 'ARI', 30: 'TB'
};

export function getPositionName(positionId: number): string {
  return POSITION_MAP[positionId] || `POS_${positionId}`;
}

export function getLineupSlotName(slotId: number): string {
  return LINEUP_SLOT_MAP[slotId] || `SLOT_${slotId}`;
}

export function getProTeamAbbrev(teamId: number): string {
  return PRO_TEAM_MAP[teamId] || `TEAM_${teamId}`;
}

export function transformEligiblePositions(slots: number[]): string[] {
  return slots
    .map(slot => LINEUP_SLOT_MAP[slot])
    .filter((name): name is string => !!name && !['BE', 'IL', 'IL+', 'NA'].includes(name));
}
```

**Step 4: Create sports/baseball/handlers.ts**

```typescript
// workers/espn-client/src/sports/baseball/handlers.ts
import type { Env, ToolParams, ExecuteResponse } from '../../types';
import { getCredentials } from '../../shared/auth';
import { espnFetch, handleEspnError } from '../../shared/espn-api';
import {
  getPositionName,
  getLineupSlotName,
  getProTeamAbbrev,
  transformEligiblePositions
} from './mappings';

const GAME_ID = 'flb';

type HandlerFn = (
  env: Env,
  params: ToolParams,
  authHeader?: string
) => Promise<ExecuteResponse>;

export const baseballHandlers: Record<string, HandlerFn> = {
  get_league_info: handleGetLeagueInfo,
  get_standings: handleGetStandings,
  get_matchups: handleGetMatchups,
  get_roster: handleGetRoster,
  get_free_agents: handleGetFreeAgents,
};

async function handleGetLeagueInfo(
  env: Env,
  params: ToolParams,
  authHeader?: string
): Promise<ExecuteResponse> {
  const { league_id, season_year } = params;

  const credentials = await getCredentials(env, authHeader);
  if (!credentials) {
    return { success: false, error: 'ESPN credentials not found', code: 'CREDENTIALS_MISSING' };
  }

  const path = `/seasons/${season_year}/segments/0/leagues/${league_id}?view=mSettings`;
  const response = await espnFetch(path, GAME_ID, { credentials });

  if (!response.ok) {
    handleEspnError(response);
  }

  const data = await response.json();
  return { success: true, data };
}

async function handleGetStandings(
  env: Env,
  params: ToolParams,
  authHeader?: string
): Promise<ExecuteResponse> {
  const { league_id, season_year } = params;

  const credentials = await getCredentials(env, authHeader);
  if (!credentials) {
    return { success: false, error: 'ESPN credentials not found', code: 'CREDENTIALS_MISSING' };
  }

  const path = `/seasons/${season_year}/segments/0/leagues/${league_id}?view=mStandings`;
  const response = await espnFetch(path, GAME_ID, { credentials });

  if (!response.ok) {
    handleEspnError(response);
  }

  const data = await response.json();
  return { success: true, data };
}

async function handleGetMatchups(
  env: Env,
  params: ToolParams,
  authHeader?: string
): Promise<ExecuteResponse> {
  const { league_id, season_year, week } = params;

  const credentials = await getCredentials(env, authHeader);
  if (!credentials) {
    return { success: false, error: 'ESPN credentials not found', code: 'CREDENTIALS_MISSING' };
  }

  let path = `/seasons/${season_year}/segments/0/leagues/${league_id}?view=mMatchup`;
  if (week) {
    path += `&scoringPeriodId=${week}`;
  }
  const response = await espnFetch(path, GAME_ID, { credentials });

  if (!response.ok) {
    handleEspnError(response);
  }

  const data = await response.json();
  return { success: true, data };
}

async function handleGetRoster(
  env: Env,
  params: ToolParams,
  authHeader?: string
): Promise<ExecuteResponse> {
  const { league_id, season_year, team_id } = params;

  if (!team_id) {
    return { success: false, error: 'team_id is required for get_roster', code: 'MISSING_PARAM' };
  }

  const credentials = await getCredentials(env, authHeader);
  if (!credentials) {
    return { success: false, error: 'ESPN credentials not found', code: 'CREDENTIALS_MISSING' };
  }

  const path = `/seasons/${season_year}/segments/0/leagues/${league_id}?view=mRoster&forTeamId=${team_id}`;
  const response = await espnFetch(path, GAME_ID, { credentials });

  if (!response.ok) {
    handleEspnError(response);
  }

  const rawData = await response.json() as { teams?: Array<{ roster?: { entries?: unknown[] } }> };
  const team = rawData.teams?.find((t: any) => t.id?.toString() === team_id);

  if (!team) {
    return { success: false, error: `Team ${team_id} not found`, code: 'TEAM_NOT_FOUND' };
  }

  // Transform roster entries
  const entries = team.roster?.entries || [];
  const players = entries.map((entry: any) => {
    const player = entry?.playerPoolEntry?.player || entry?.player;
    if (!player?.id) return null;

    return {
      playerId: player.id,
      name: player.fullName || player.name || 'Unknown',
      proTeam: player.proTeamAbbreviation || getProTeamAbbrev(player.proTeamId || 0),
      position: getPositionName(player.defaultPositionId || 0),
      eligiblePositions: transformEligiblePositions(player.eligibleSlots || []),
      lineupSlot: getLineupSlotName(entry?.lineupSlotId || 0),
      injuryStatus: player.injuryStatus,
    };
  }).filter(Boolean);

  return { success: true, data: { team_id, players } };
}

async function handleGetFreeAgents(
  env: Env,
  params: ToolParams,
  authHeader?: string
): Promise<ExecuteResponse> {
  const { league_id, season_year, position, count = 50 } = params;

  const credentials = await getCredentials(env, authHeader);
  if (!credentials) {
    return { success: false, error: 'ESPN credentials not found', code: 'CREDENTIALS_MISSING' };
  }

  // Build filter for free agents
  const filter = {
    players: {
      filterStatus: { value: ['FREEAGENT'] },
      limit: count,
      sortPercOwned: { sortAscending: false, sortPriority: 1 },
    }
  };

  const path = `/seasons/${season_year}/segments/0/leagues/${league_id}?view=kona_player_info`;
  const response = await espnFetch(path, GAME_ID, {
    credentials,
  });

  if (!response.ok) {
    handleEspnError(response);
  }

  const data = await response.json();
  return { success: true, data };
}
```

**Step 5: Update espn-client index.ts to use baseball handlers**

Modify `workers/espn-client/src/index.ts`:

```typescript
// workers/espn-client/src/index.ts
import { Hono } from 'hono';
import type { Env, ExecuteRequest, ExecuteResponse, Sport } from './types';
import { baseballHandlers } from './sports/baseball/handlers';

const app = new Hono<{ Bindings: Env }>();

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'espn-client',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    supportedSports: ['baseball', 'football']
  });
});

// Main execute endpoint
app.post('/execute', async (c) => {
  const body = await c.req.json<ExecuteRequest>();
  const { tool, params, authHeader } = body;
  const { sport } = params;

  try {
    const result = await routeToSport(c.env, sport, tool, params, authHeader);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    // Extract error code if present (e.g., "ESPN_COOKIES_EXPIRED: message")
    const codeMatch = message.match(/^([A-Z_]+):/);
    const code = codeMatch ? codeMatch[1] : 'INTERNAL_ERROR';
    return c.json({
      success: false,
      error: message,
      code
    } satisfies ExecuteResponse, 500);
  }
});

async function routeToSport(
  env: Env,
  sport: Sport,
  tool: string,
  params: ExecuteRequest['params'],
  authHeader?: string
): Promise<ExecuteResponse> {
  switch (sport) {
    case 'baseball': {
      const handler = baseballHandlers[tool];
      if (!handler) {
        return { success: false, error: `Unknown baseball tool: ${tool}`, code: 'UNKNOWN_TOOL' };
      }
      return handler(env, params, authHeader);
    }
    case 'football':
      // TODO: Import and call football handlers
      return { success: false, error: 'Football handlers not yet migrated', code: 'NOT_IMPLEMENTED' };
    case 'basketball':
      return { success: false, error: 'Basketball not yet supported', code: 'NOT_SUPPORTED' };
    case 'hockey':
      return { success: false, error: 'Hockey not yet supported', code: 'NOT_SUPPORTED' };
    default:
      return { success: false, error: `Unknown sport: ${sport}`, code: 'INVALID_SPORT' };
  }
}

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

**Step 6: Test baseball handler locally**

Run: `cd workers/espn-client && npm run dev`

Then test with curl:
```bash
curl -X POST http://localhost:8789/execute \
  -H "Content-Type: application/json" \
  -d '{"tool":"get_league_info","params":{"sport":"baseball","league_id":"12345","season_year":2024}}'
```

Expected: Error about credentials (since no auth header provided), but confirms routing works

**Step 7: Commit**

```bash
git add workers/espn-client/src/
git commit -m "feat: add baseball handlers to espn-client

- Add shared/auth.ts for credential fetching
- Add shared/espn-api.ts for ESPN API calls
- Add sports/baseball/mappings.ts with position/team maps
- Add sports/baseball/handlers.ts with 5 handlers:
  - get_league_info, get_standings, get_matchups
  - get_roster, get_free_agents
- Update index.ts to route baseball tools

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Migrate football handlers to espn-client

**Files:**
- Create: `workers/espn-client/src/sports/football/handlers.ts`
- Create: `workers/espn-client/src/sports/football/mappings.ts`
- Modify: `workers/espn-client/src/index.ts`

**Step 1: Create sports/football/mappings.ts**

```typescript
// workers/espn-client/src/sports/football/mappings.ts

export const POSITION_MAP: Record<number, string> = {
  1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K',
  16: 'D/ST', 17: 'FLEX', 20: 'BE', 21: 'IR'
};

export const LINEUP_SLOT_MAP: Record<number, string> = {
  0: 'QB', 2: 'RB', 4: 'WR', 6: 'TE', 17: 'K',
  16: 'D/ST', 23: 'FLEX', 20: 'BE', 21: 'IR'
};

export const PRO_TEAM_MAP: Record<number, string> = {
  0: 'FA', 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE',
  6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN',
  11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA',
  16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ',
  21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF',
  26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX',
  33: 'BAL', 34: 'HOU'
};

export function getPositionName(positionId: number): string {
  return POSITION_MAP[positionId] || `POS_${positionId}`;
}

export function getLineupSlotName(slotId: number): string {
  return LINEUP_SLOT_MAP[slotId] || `SLOT_${slotId}`;
}

export function getProTeamAbbrev(teamId: number): string {
  return PRO_TEAM_MAP[teamId] || `TEAM_${teamId}`;
}

export function transformEligiblePositions(slots: number[]): string[] {
  return slots
    .map(slot => LINEUP_SLOT_MAP[slot])
    .filter((name): name is string => !!name && !['BE', 'IR'].includes(name));
}
```

**Step 2: Create sports/football/handlers.ts**

```typescript
// workers/espn-client/src/sports/football/handlers.ts
import type { Env, ToolParams, ExecuteResponse } from '../../types';
import { getCredentials } from '../../shared/auth';
import { espnFetch, handleEspnError } from '../../shared/espn-api';
import {
  getPositionName,
  getLineupSlotName,
  getProTeamAbbrev,
  transformEligiblePositions
} from './mappings';

const GAME_ID = 'ffl';

type HandlerFn = (
  env: Env,
  params: ToolParams,
  authHeader?: string
) => Promise<ExecuteResponse>;

export const footballHandlers: Record<string, HandlerFn> = {
  get_league_info: handleGetLeagueInfo,
  get_standings: handleGetStandings,
  get_matchups: handleGetMatchups,
  get_roster: handleGetRoster,
};

async function handleGetLeagueInfo(
  env: Env,
  params: ToolParams,
  authHeader?: string
): Promise<ExecuteResponse> {
  const { league_id, season_year } = params;

  const credentials = await getCredentials(env, authHeader);
  if (!credentials) {
    return { success: false, error: 'ESPN credentials not found', code: 'CREDENTIALS_MISSING' };
  }

  const path = `/seasons/${season_year}/segments/0/leagues/${league_id}?view=mSettings`;
  const response = await espnFetch(path, GAME_ID, { credentials });

  if (!response.ok) {
    handleEspnError(response);
  }

  const data = await response.json();
  return { success: true, data };
}

async function handleGetStandings(
  env: Env,
  params: ToolParams,
  authHeader?: string
): Promise<ExecuteResponse> {
  const { league_id, season_year } = params;

  const credentials = await getCredentials(env, authHeader);
  if (!credentials) {
    return { success: false, error: 'ESPN credentials not found', code: 'CREDENTIALS_MISSING' };
  }

  const path = `/seasons/${season_year}/segments/0/leagues/${league_id}?view=mStandings`;
  const response = await espnFetch(path, GAME_ID, { credentials });

  if (!response.ok) {
    handleEspnError(response);
  }

  const data = await response.json();
  return { success: true, data };
}

async function handleGetMatchups(
  env: Env,
  params: ToolParams,
  authHeader?: string
): Promise<ExecuteResponse> {
  const { league_id, season_year, week } = params;

  const credentials = await getCredentials(env, authHeader);
  if (!credentials) {
    return { success: false, error: 'ESPN credentials not found', code: 'CREDENTIALS_MISSING' };
  }

  let path = `/seasons/${season_year}/segments/0/leagues/${league_id}?view=mMatchup`;
  if (week) {
    path += `&scoringPeriodId=${week}`;
  }
  const response = await espnFetch(path, GAME_ID, { credentials });

  if (!response.ok) {
    handleEspnError(response);
  }

  const data = await response.json();
  return { success: true, data };
}

async function handleGetRoster(
  env: Env,
  params: ToolParams,
  authHeader?: string
): Promise<ExecuteResponse> {
  const { league_id, season_year, team_id } = params;

  if (!team_id) {
    return { success: false, error: 'team_id is required for get_roster', code: 'MISSING_PARAM' };
  }

  const credentials = await getCredentials(env, authHeader);
  if (!credentials) {
    return { success: false, error: 'ESPN credentials not found', code: 'CREDENTIALS_MISSING' };
  }

  const path = `/seasons/${season_year}/segments/0/leagues/${league_id}?view=mRoster&forTeamId=${team_id}`;
  const response = await espnFetch(path, GAME_ID, { credentials });

  if (!response.ok) {
    handleEspnError(response);
  }

  const rawData = await response.json() as { teams?: Array<{ roster?: { entries?: unknown[] } }> };
  const team = rawData.teams?.find((t: any) => t.id?.toString() === team_id);

  if (!team) {
    return { success: false, error: `Team ${team_id} not found`, code: 'TEAM_NOT_FOUND' };
  }

  const entries = team.roster?.entries || [];
  const players = entries.map((entry: any) => {
    const player = entry?.playerPoolEntry?.player || entry?.player;
    if (!player?.id) return null;

    return {
      playerId: player.id,
      name: player.fullName || player.name || 'Unknown',
      proTeam: player.proTeamAbbreviation || getProTeamAbbrev(player.proTeamId || 0),
      position: getPositionName(player.defaultPositionId || 0),
      eligiblePositions: transformEligiblePositions(player.eligibleSlots || []),
      lineupSlot: getLineupSlotName(entry?.lineupSlotId || 0),
      injuryStatus: player.injuryStatus,
    };
  }).filter(Boolean);

  return { success: true, data: { team_id, players } };
}
```

**Step 3: Update espn-client index.ts to include football handlers**

Add import and case for football:

```typescript
import { footballHandlers } from './sports/football/handlers';

// In routeToSport function, update the football case:
case 'football': {
  const handler = footballHandlers[tool];
  if (!handler) {
    return { success: false, error: `Unknown football tool: ${tool}`, code: 'UNKNOWN_TOOL' };
  }
  return handler(env, params, authHeader);
}
```

**Step 4: Commit**

```bash
git add workers/espn-client/src/sports/football/
git add workers/espn-client/src/index.ts
git commit -m "feat: add football handlers to espn-client

- Add sports/football/mappings.ts with NFL position/team maps
- Add sports/football/handlers.ts with 4 handlers:
  - get_league_info, get_standings, get_matchups, get_roster
- Update index.ts to route football tools

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Add unified MCP tools to fantasy-mcp gateway

**Files:**
- Create: `workers/fantasy-mcp/src/mcp/server.ts`
- Create: `workers/fantasy-mcp/src/mcp/tools.ts`
- Modify: `workers/fantasy-mcp/src/index.ts`

**Step 1: Create mcp/tools.ts with unified tool definitions**

```typescript
// workers/fantasy-mcp/src/mcp/tools.ts
import { z } from 'zod';
import type { Env, Platform, Sport } from '../types';
import { routeToClient } from '../router';
import { authWorkerFetch } from '@flaim/worker-shared';

// Zod type workaround for MCP SDK
type ZodShape = Record<string, any>;

export const platformSchema = z.enum(['espn', 'yahoo']).describe('Platform: espn or yahoo');
export const sportSchema = z.enum(['football', 'baseball', 'basketball', 'hockey']).describe('Sport type');

/**
 * Get default season year based on sport and current date (America/New_York timezone)
 */
function getDefaultSeason(sport: Sport): number {
  const ny = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());

  const year = Number(ny.find((p) => p.type === 'year')?.value);
  const month = Number(ny.find((p) => p.type === 'month')?.value);

  // Baseball: rollover Feb 1 (month 2)
  // Football: rollover Jun 1 (month 6)
  if (sport === 'baseball') {
    return month < 2 ? year - 1 : year;
  } else {
    return month < 6 ? year - 1 : year;
  }
}

interface UserLeague {
  leagueId: string;
  sport: string;
  teamId?: string;
  seasonYear?: number;
  leagueName?: string;
  teamName?: string;
  isDefault?: boolean;
  platform?: string;
}

/**
 * Fetch user's leagues from auth-worker
 */
async function fetchUserLeagues(
  env: Env,
  authHeader?: string
): Promise<{ leagues: UserLeague[]; error?: string }> {
  try {
    const response = await authWorkerFetch(env, '/leagues', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
    });

    if (!response.ok) {
      return { leagues: [], error: `Auth-worker returned ${response.status}` };
    }

    const data = (await response.json()) as { leagues?: UserLeague[] };
    // Add platform field to all leagues (currently all are ESPN)
    const leagues = (data.leagues || []).map(l => ({
      ...l,
      platform: l.platform || 'espn'
    }));
    return { leagues };
  } catch (error) {
    return { leagues: [], error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: ZodShape;
  handler: (args: any, env: Env, authHeader?: string) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;
}

export function getUnifiedTools(): ToolDefinition[] {
  return [
    // Tool 1: get_user_session (no platform/sport needed)
    {
      name: 'get_user_session',
      title: 'User Session',
      description: 'IMPORTANT: Call this tool FIRST before any other tool. Returns all configured leagues across all platforms with their IDs, team IDs, and season years. Use the returned values for subsequent tool calls.',
      inputSchema: {},
      handler: async (args, env, authHeader) => {
        const { leagues, error } = await fetchUserLeagues(env, authHeader);

        if (error) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: false, error }, null, 2) }],
            isError: true
          };
        }

        const currentDate = new Date().toISOString().split('T')[0];

        // Group by sport for convenience
        const bySport: Record<string, UserLeague[]> = {};
        for (const league of leagues) {
          const sport = league.sport?.toLowerCase() || 'unknown';
          if (!bySport[sport]) bySport[sport] = [];
          bySport[sport].push(league);
        }

        // Find default league
        const defaultLeague = leagues.find(l => l.isDefault) || leagues[0];

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              current_date: currentDate,
              total_leagues: leagues.length,
              default_league: defaultLeague ? {
                platform: defaultLeague.platform || 'espn',
                sport: defaultLeague.sport,
                league_id: defaultLeague.leagueId,
                team_id: defaultLeague.teamId,
                season_year: defaultLeague.seasonYear,
                league_name: defaultLeague.leagueName,
              } : null,
              leagues: leagues.map(l => ({
                platform: l.platform || 'espn',
                sport: l.sport,
                league_id: l.leagueId,
                team_id: l.teamId,
                season_year: l.seasonYear,
                league_name: l.leagueName,
                team_name: l.teamName,
                is_default: l.isDefault || false,
              })),
              leagues_by_sport: bySport,
              instructions: leagues.length === 0
                ? 'No leagues configured. Please add leagues at flaim.app/leagues.'
                : 'Use the platform, sport, league_id, and season_year from the leagues above for all subsequent tool calls.',
            }, null, 2)
          }]
        };
      }
    },

    // Tool 2: get_league_info
    {
      name: 'get_league_info',
      title: 'League Info',
      description: 'Get league settings and member information. Use values from get_user_session.',
      inputSchema: {
        platform: platformSchema,
        sport: sportSchema,
        league_id: z.string().describe('League ID from get_user_session'),
        season_year: z.number().describe('Season year from get_user_session'),
      } as ZodShape,
      handler: async (args, env, authHeader) => {
        const result = await routeToClient(env, 'get_league_info', {
          platform: args.platform,
          sport: args.sport,
          league_id: args.league_id,
          season_year: args.season_year,
        }, authHeader);

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success
        };
      }
    },

    // Tool 3: get_standings
    {
      name: 'get_standings',
      title: 'League Standings',
      description: 'Get current league standings with team records. Use values from get_user_session.',
      inputSchema: {
        platform: platformSchema,
        sport: sportSchema,
        league_id: z.string().describe('League ID from get_user_session'),
        season_year: z.number().describe('Season year from get_user_session'),
      } as ZodShape,
      handler: async (args, env, authHeader) => {
        const result = await routeToClient(env, 'get_standings', {
          platform: args.platform,
          sport: args.sport,
          league_id: args.league_id,
          season_year: args.season_year,
        }, authHeader);

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success
        };
      }
    },

    // Tool 4: get_matchups
    {
      name: 'get_matchups',
      title: 'League Matchups',
      description: 'Get current or specified week matchups. Use values from get_user_session.',
      inputSchema: {
        platform: platformSchema,
        sport: sportSchema,
        league_id: z.string().describe('League ID from get_user_session'),
        season_year: z.number().describe('Season year from get_user_session'),
        week: z.number().optional().describe('Scoring period/week number (optional, defaults to current)'),
      } as ZodShape,
      handler: async (args, env, authHeader) => {
        const result = await routeToClient(env, 'get_matchups', {
          platform: args.platform,
          sport: args.sport,
          league_id: args.league_id,
          season_year: args.season_year,
          week: args.week,
        }, authHeader);

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success
        };
      }
    },

    // Tool 5: get_roster
    {
      name: 'get_roster',
      title: 'Team Roster',
      description: 'Get a team roster with player details. Use values from get_user_session.',
      inputSchema: {
        platform: platformSchema,
        sport: sportSchema,
        league_id: z.string().describe('League ID from get_user_session'),
        season_year: z.number().describe('Season year from get_user_session'),
        team_id: z.string().describe('Team ID from get_user_session'),
      } as ZodShape,
      handler: async (args, env, authHeader) => {
        const result = await routeToClient(env, 'get_roster', {
          platform: args.platform,
          sport: args.sport,
          league_id: args.league_id,
          season_year: args.season_year,
          team_id: args.team_id,
        }, authHeader);

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success
        };
      }
    },

    // Tool 6: get_free_agents (baseball only for now)
    {
      name: 'get_free_agents',
      title: 'Free Agents',
      description: 'Get available free agents. Currently supported for baseball only.',
      inputSchema: {
        platform: platformSchema,
        sport: sportSchema,
        league_id: z.string().describe('League ID from get_user_session'),
        season_year: z.number().describe('Season year from get_user_session'),
        position: z.string().optional().describe('Filter by position (e.g., SP, C, OF)'),
        count: z.number().optional().describe('Number of results (default: 50)'),
      } as ZodShape,
      handler: async (args, env, authHeader) => {
        const result = await routeToClient(env, 'get_free_agents', {
          platform: args.platform,
          sport: args.sport,
          league_id: args.league_id,
          season_year: args.season_year,
          position: args.position,
          count: args.count,
        }, authHeader);

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          isError: !result.success
        };
      }
    },
  ];
}
```

**Step 2: Create mcp/server.ts**

```typescript
// workers/fantasy-mcp/src/mcp/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Env } from '../types';
import { getUnifiedTools } from './tools';

export interface McpContext {
  env: Env;
  authHeader: string | null;
}

export function createFantasyMcpServer(ctx: McpContext): McpServer {
  const { env, authHeader } = ctx;

  const server = new McpServer({
    name: 'fantasy-mcp',
    version: '1.0.0',
  });

  const tools = getUnifiedTools();

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: true },
      },
      async (args) => {
        return tool.handler(args, env, authHeader || undefined);
      }
    );
  }

  return server;
}
```

**Step 3: Copy create-mcp-handler.ts from existing worker**

Copy `workers/baseball-espn-mcp/src/mcp/create-mcp-handler.ts` to `workers/fantasy-mcp/src/mcp/create-mcp-handler.ts` (same file, handles MCP SDK stream transport).

**Step 4: Update fantasy-mcp index.ts to use MCP server**

```typescript
// workers/fantasy-mcp/src/index.ts
import { Hono } from 'hono';
import {
  createMcpCorsHeaders,
  isCorsPreflightRequest,
} from '@flaim/worker-shared';
import type { Env } from './types';
import { createFantasyMcpServer } from './mcp/server';
import { createMcpHandler } from './mcp/create-mcp-handler';

const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use('*', async (c, next) => {
  if (isCorsPreflightRequest(c.req.raw)) {
    return new Response(null, {
      status: 200,
      headers: createMcpCorsHeaders(c.req.raw),
    });
  }
  await next();
  const corsHeaders = createMcpCorsHeaders(c.req.raw);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    if (!c.res.headers.has(key)) {
      c.res.headers.set(key, value);
    }
  });
  return undefined;
});

// Health check
app.get('/health', async (c) => {
  const healthData: Record<string, unknown> = {
    status: 'healthy',
    service: 'fantasy-mcp',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    bindings: {
      espn: !!c.env.ESPN,
      auth: !!c.env.AUTH,
    }
  };

  if (c.env.ESPN) {
    try {
      const espnHealth = await c.env.ESPN.fetch(
        new Request('https://internal/health')
      );
      healthData.espn_status = espnHealth.ok ? 'connected' : 'error';
    } catch {
      healthData.espn_status = 'unreachable';
      healthData.status = 'degraded';
    }
  } else {
    healthData.espn_status = 'no_binding';
    healthData.status = 'degraded';
  }

  const statusCode = healthData.status === 'healthy' ? 200 : 503;
  return c.json(healthData, statusCode);
});

// OAuth Protected Resource Metadata
app.get('/.well-known/oauth-protected-resource', (c) => {
  return c.json({
    resource: 'https://api.flaim.app/fantasy/mcp',
    authorization_servers: ['https://api.flaim.app'],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp:read', 'mcp:write']
  }, 200, {
    'Cache-Control': 'public, max-age=3600'
  });
});

// MCP auth error response builder
const OAUTH_RESOURCE_METADATA = 'https://api.flaim.app/fantasy/.well-known/oauth-protected-resource';

function buildMcpAuthErrorResponse(request: Request, message: string, errorType: 'unauthorized' | 'invalid_token'): Response {
  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    error: {
      code: -32001,
      message,
      _meta: {
        'mcp/www_authenticate': [
          `Bearer resource_metadata=\"${OAUTH_RESOURCE_METADATA}\", error=\"${errorType}\", error_description=\"${message}\"`
        ]
      }
    },
    id: null
  }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata=\"${OAUTH_RESOURCE_METADATA}\"${errorType === 'invalid_token' ? ', error=\"invalid_token\"' : ''}`,
      ...createMcpCorsHeaders(request)
    }
  });
}

// MCP endpoints
async function handleMcpRequest(c: any): Promise<Response> {
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    return buildMcpAuthErrorResponse(c.req.raw, 'Authentication required. Please authorize via OAuth.', 'unauthorized');
  }

  const server = createFantasyMcpServer({
    env: c.env,
    authHeader
  });

  const handler = createMcpHandler(server, {
    route: '/mcp',
    enableJsonResponse: true,
  });

  return handler(c.req.raw, c.env, c.executionCtx);
}

app.all('/mcp', handleMcpRequest);
app.all('/mcp/*', handleMcpRequest);

// Mount on /fantasy as well for route matching
app.route('/fantasy', app);

app.notFound((c) => {
  return c.json({
    error: 'Endpoint not found',
    endpoints: {
      '/health': 'GET - Health check with binding status',
      '/.well-known/oauth-protected-resource': 'GET - OAuth metadata',
      '/mcp': 'POST - MCP protocol endpoint'
    }
  }, 404);
});

export default app;
```

**Step 5: Commit**

```bash
git add workers/fantasy-mcp/src/mcp/
git add workers/fantasy-mcp/src/index.ts
git commit -m "feat: add unified MCP tools to fantasy-mcp gateway

- Add mcp/tools.ts with 6 unified tools:
  - get_user_session, get_league_info, get_standings
  - get_matchups, get_roster, get_free_agents
- Add mcp/server.ts factory function
- Copy create-mcp-handler.ts for MCP SDK transport
- Update index.ts with MCP endpoint handling
- All tools use explicit params: platform, sport, league_id, season_year

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Update auth-worker to include platform in leagues response

**Files:**
- Modify: `workers/auth-worker/src/index-hono.ts` (or relevant handler file)

The `GET /leagues` endpoint should return `platform: "espn"` for all ESPN leagues. This prepares for Yahoo leagues later.

**Step 1: Update leagues response to include platform field**

In the leagues handler, ensure the response includes platform:

```typescript
// In the GET /leagues response transformation
const leagues = (data.leagues || []).map(league => ({
  ...league,
  platform: league.platform || 'espn'  // Default to espn for existing leagues
}));
```

**Step 2: Test leagues endpoint**

Run: `curl -H "Authorization: Bearer ..." https://api.flaim.app/auth/leagues`
Expected: Each league object should have `platform: "espn"`

**Step 3: Commit**

```bash
git add workers/auth-worker/
git commit -m "feat: add platform field to leagues response

Default to 'espn' for all existing leagues. Prepares for Yahoo leagues.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Deploy and test in preview environment

**Step 1: Deploy espn-client to preview**

Run: `npm run deploy:espn-client:preview`
Expected: Deploys to `espn-client-preview.gerrygugger.workers.dev`

**Step 2: Deploy fantasy-mcp to preview**

Run: `npm run deploy:fantasy-mcp:preview`
Expected: Deploys to `fantasy-mcp-preview.gerrygugger.workers.dev`

**Step 3: Test health endpoint**

Run: `curl https://fantasy-mcp-preview.gerrygugger.workers.dev/health`
Expected: JSON with `status: "healthy"`, `espn_status: "connected"`

**Step 4: Test MCP tools/list (requires auth)**

Use a valid OAuth token to test:
```bash
curl -X POST https://fantasy-mcp-preview.gerrygugger.workers.dev/mcp \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```
Expected: List of 6 unified tools

**Step 5: Test get_user_session**

```bash
curl -X POST https://fantasy-mcp-preview.gerrygugger.workers.dev/mcp \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_user_session","arguments":{}},"id":2}'
```
Expected: User's leagues with platform field

**Step 6: Test get_standings with explicit params**

Use values from get_user_session:
```bash
curl -X POST https://fantasy-mcp-preview.gerrygugger.workers.dev/mcp \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"get_standings","arguments":{"platform":"espn","sport":"baseball","league_id":"YOUR_LEAGUE_ID","season_year":2024}},"id":3}'
```
Expected: League standings data

**Step 7: Commit test results (if any fixes needed)**

Fix any issues discovered during testing and commit.

---

## Task 9: Update GitHub Actions for new workers

**Files:**
- Modify: `.github/workflows/deploy-workers.yml`

**Step 1: Add espn-client to deploy workflow**

Add a job for espn-client similar to existing workers:

```yaml
deploy-espn-client:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: '24'
    - name: Install dependencies
      run: cd workers/espn-client && npm ci
    - name: Deploy to Cloudflare
      run: |
        if [ "${{ github.ref }}" = "refs/heads/main" ]; then
          cd workers/espn-client && npx wrangler deploy --env prod
        else
          cd workers/espn-client && npx wrangler deploy --env preview
        fi
      env:
        CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

**Step 2: Add fantasy-mcp to deploy workflow**

Similar job for fantasy-mcp.

**Step 3: Commit**

```bash
git add .github/workflows/deploy-workers.yml
git commit -m "ci: add espn-client and fantasy-mcp to deploy workflow

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Update documentation

**Files:**
- Modify: `docs/architecture.md`
- Modify: `workers/README.md`

**Step 1: Update architecture.md with new worker diagram**

Add section describing the unified gateway architecture:

```markdown
## Unified Gateway Architecture (Phase 0)

```
Claude/ChatGPT → fantasy-mcp (gateway) → espn-client → ESPN API
                                       → auth-worker → Supabase
```

- `fantasy-mcp`: Single MCP endpoint with unified tools
- `espn-client`: Internal worker handling ESPN API calls for all sports
- Future: `yahoo-client` for Yahoo API calls
```

**Step 2: Update workers/README.md**

Add documentation for new workers.

**Step 3: Commit**

```bash
git add docs/architecture.md workers/README.md
git commit -m "docs: document unified gateway architecture

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Completion Checklist

- [ ] Task 1: espn-client scaffold created and tested
- [ ] Task 2: fantasy-mcp scaffold created and tested
- [ ] Task 3: Root package.json scripts updated
- [ ] Task 4: Baseball handlers migrated to espn-client
- [ ] Task 5: Football handlers migrated to espn-client
- [ ] Task 6: Unified MCP tools added to fantasy-mcp
- [ ] Task 7: auth-worker returns platform field
- [ ] Task 8: Preview environment tested end-to-end
- [ ] Task 9: GitHub Actions updated
- [ ] Task 10: Documentation updated

---

## Post-Phase 0 Notes

After Phase 0 is complete and validated:
1. The old `baseball-espn-mcp` and `football-espn-mcp` workers remain functional
2. Users can be gradually migrated to the new `fantasy-mcp` endpoint
3. Phase 1 (Yahoo OAuth) can begin without disrupting existing users
4. Consider adding a feature flag for gradual rollout

---

## Rollback Plan

If issues arise:
1. The old workers are unchanged and still functional
2. Simply don't update DNS/routes to point to `fantasy-mcp`
3. Users continue using `api.flaim.app/baseball/*` and `api.flaim.app/football/*`
4. Debug and fix `fantasy-mcp` independently
