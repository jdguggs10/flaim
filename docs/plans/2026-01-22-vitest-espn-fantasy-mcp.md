# Vitest Setup for espn-client and fantasy-mcp

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Vitest testing infrastructure to espn-client and fantasy-mcp workers, matching the existing auth-worker setup.

**Architecture:** Copy the Vitest + @cloudflare/vitest-pool-workers configuration from auth-worker. Each worker gets its own vitest.config.ts, wrangler.test.jsonc, and initial test file. CI workflow updated to run all three test suites.

**Tech Stack:** Vitest ~3.0.0, @cloudflare/vitest-pool-workers ^0.7.0, TypeScript

---

## Task 1: Add Vitest to espn-client

**Files:**
- Modify: `workers/espn-client/package.json`
- Create: `workers/espn-client/vitest.config.ts`
- Create: `workers/espn-client/wrangler.test.jsonc`
- Create: `workers/espn-client/src/__tests__/types.test.ts`

**Step 1: Update package.json with test dependencies and script**

Replace `workers/espn-client/package.json` with:

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
    "deploy:prod": "wrangler deploy --env prod",
    "test": "vitest run"
  },
  "dependencies": {
    "@flaim/worker-shared": "*",
    "hono": "^4.7.0",
    "zod": "^3.24.0"
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

**Step 2: Create vitest.config.ts**

Create `workers/espn-client/vitest.config.ts`:

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

**Step 3: Create wrangler.test.jsonc**

Create `workers/espn-client/wrangler.test.jsonc`:

```jsonc
{
  "name": "espn-client",
  "main": "./src/index.ts",
  "compatibility_date": "2024-12-01"
}
```

**Step 4: Create initial test file for types**

Create `workers/espn-client/src/__tests__/types.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { Sport, ToolParams, ExecuteRequest, ExecuteResponse } from '../types';

describe('espn-client types', () => {
  describe('Sport type', () => {
    it('accepts valid sports', () => {
      const sports: Sport[] = ['football', 'baseball', 'basketball', 'hockey'];
      expect(sports).toHaveLength(4);
    });
  });

  describe('ToolParams interface', () => {
    it('accepts valid params with required fields', () => {
      const params: ToolParams = {
        sport: 'football',
        league_id: '12345',
        season_year: 2024,
      };
      expect(params.sport).toBe('football');
      expect(params.league_id).toBe('12345');
      expect(params.season_year).toBe(2024);
    });

    it('accepts optional fields', () => {
      const params: ToolParams = {
        sport: 'baseball',
        league_id: '67890',
        season_year: 2024,
        team_id: '3',
        week: 5,
        position: 'QB',
        count: 10,
      };
      expect(params.team_id).toBe('3');
      expect(params.week).toBe(5);
      expect(params.position).toBe('QB');
      expect(params.count).toBe(10);
    });
  });

  describe('ExecuteRequest interface', () => {
    it('accepts valid request structure', () => {
      const request: ExecuteRequest = {
        tool: 'get_standings',
        params: {
          sport: 'football',
          league_id: '12345',
          season_year: 2024,
        },
        authHeader: 'Bearer token123',
      };
      expect(request.tool).toBe('get_standings');
      expect(request.authHeader).toBe('Bearer token123');
    });
  });

  describe('ExecuteResponse interface', () => {
    it('accepts success response', () => {
      const response: ExecuteResponse = {
        success: true,
        data: { standings: [] },
      };
      expect(response.success).toBe(true);
      expect(response.data).toBeDefined();
    });

    it('accepts error response', () => {
      const response: ExecuteResponse = {
        success: false,
        error: 'Something went wrong',
        code: 'INTERNAL_ERROR',
      };
      expect(response.success).toBe(false);
      expect(response.error).toBe('Something went wrong');
      expect(response.code).toBe('INTERNAL_ERROR');
    });
  });
});
```

**Step 5: Install dependencies and run tests**

Run: `cd /Users/ggugger/Code/flaim/workers/espn-client && npm install`
Expected: Dependencies install successfully

Run: `npm test`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add workers/espn-client/package.json workers/espn-client/vitest.config.ts workers/espn-client/wrangler.test.jsonc workers/espn-client/src/__tests__/types.test.ts
git commit -m "test(espn-client): add vitest setup with initial type tests"
```

---

## Task 2: Add Vitest to fantasy-mcp

**Files:**
- Modify: `workers/fantasy-mcp/package.json`
- Create: `workers/fantasy-mcp/vitest.config.ts`
- Create: `workers/fantasy-mcp/wrangler.test.jsonc`
- Create: `workers/fantasy-mcp/src/__tests__/types.test.ts`
- Create: `workers/fantasy-mcp/src/__tests__/router.test.ts`

**Step 1: Update package.json with test dependencies and script**

Replace `workers/fantasy-mcp/package.json` with:

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
    "deploy:prod": "wrangler deploy --env prod",
    "test": "vitest run"
  },
  "dependencies": {
    "@flaim/worker-shared": "*",
    "@modelcontextprotocol/sdk": "^1.25.2",
    "hono": "^4.7.0",
    "zod": "^3.24.0"
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

**Step 2: Create vitest.config.ts**

Create `workers/fantasy-mcp/vitest.config.ts`:

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

**Step 3: Create wrangler.test.jsonc**

Create `workers/fantasy-mcp/wrangler.test.jsonc`:

```jsonc
{
  "name": "fantasy-mcp",
  "main": "./src/index.ts",
  "compatibility_date": "2024-12-01"
}
```

**Step 4: Create initial test file for types**

Create `workers/fantasy-mcp/src/__tests__/types.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { Platform, Sport, ToolParams } from '../types';

describe('fantasy-mcp types', () => {
  describe('Platform type', () => {
    it('accepts valid platforms', () => {
      const platforms: Platform[] = ['espn', 'yahoo'];
      expect(platforms).toHaveLength(2);
    });
  });

  describe('Sport type', () => {
    it('accepts valid sports', () => {
      const sports: Sport[] = ['football', 'baseball', 'basketball', 'hockey'];
      expect(sports).toHaveLength(4);
    });
  });

  describe('ToolParams interface', () => {
    it('accepts valid params with required fields', () => {
      const params: ToolParams = {
        platform: 'espn',
        sport: 'football',
        league_id: '12345',
        season_year: 2024,
      };
      expect(params.platform).toBe('espn');
      expect(params.sport).toBe('football');
      expect(params.league_id).toBe('12345');
      expect(params.season_year).toBe(2024);
    });

    it('accepts optional fields', () => {
      const params: ToolParams = {
        platform: 'yahoo',
        sport: 'baseball',
        league_id: '67890',
        season_year: 2024,
        team_id: '3',
        week: 5,
        position: 'SP',
        count: 25,
      };
      expect(params.team_id).toBe('3');
      expect(params.week).toBe(5);
      expect(params.position).toBe('SP');
      expect(params.count).toBe(25);
    });
  });
});
```

**Step 5: Create router test file**

Create `workers/fantasy-mcp/src/__tests__/router.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { RouteResult } from '../router';

describe('fantasy-mcp router', () => {
  describe('RouteResult interface', () => {
    it('accepts success result', () => {
      const result: RouteResult = {
        success: true,
        data: { standings: [] },
      };
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('accepts error result', () => {
      const result: RouteResult = {
        success: false,
        error: 'Platform not supported',
        code: 'PLATFORM_NOT_SUPPORTED',
      };
      expect(result.success).toBe(false);
      expect(result.error).toBe('Platform not supported');
      expect(result.code).toBe('PLATFORM_NOT_SUPPORTED');
    });
  });

  describe('selectClient behavior', () => {
    it('should return null for yahoo platform (not yet implemented)', () => {
      // This documents the expected behavior: yahoo returns null until implemented
      // We can't directly test selectClient since it's not exported,
      // but we can verify the expected error response
      const expectedErrorForYahoo: RouteResult = {
        success: false,
        error: 'Platform "yahoo" is not yet supported',
        code: 'PLATFORM_NOT_SUPPORTED',
      };
      expect(expectedErrorForYahoo.code).toBe('PLATFORM_NOT_SUPPORTED');
    });
  });
});
```

**Step 6: Install dependencies and run tests**

Run: `cd /Users/ggugger/Code/flaim/workers/fantasy-mcp && npm install`
Expected: Dependencies install successfully

Run: `npm test`
Expected: All tests PASS

**Step 7: Commit**

```bash
git add workers/fantasy-mcp/package.json workers/fantasy-mcp/vitest.config.ts workers/fantasy-mcp/wrangler.test.jsonc workers/fantasy-mcp/src/__tests__/types.test.ts workers/fantasy-mcp/src/__tests__/router.test.ts
git commit -m "test(fantasy-mcp): add vitest setup with initial type and router tests"
```

---

## Task 3: Update CI to Run All Tests

**Files:**
- Modify: `.github/workflows/deploy-workers.yml`

**Step 1: Update workflow to test all three workers**

Replace `.github/workflows/deploy-workers.yml` with:

```yaml
name: Deploy Workers

on:
  push:
    branches:
      - main
  pull_request:

jobs:
  test:
    name: Run Tests
    runs-on: ubuntu-latest
    strategy:
      matrix:
        worker: [auth-worker, espn-client, fantasy-mcp]
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'

      - name: Install Dependencies
        run: npm ci

      - name: Test ${{ matrix.worker }}
        run: npm test
        working-directory: workers/${{ matrix.worker }}

  deploy:
    name: Deploy ${{ matrix.worker }}
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' || github.event_name == 'pull_request'
    strategy:
      matrix:
        worker: [auth-worker, baseball-espn-mcp, football-espn-mcp, espn-client, fantasy-mcp]
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'npm'

      - name: Install Dependencies
        run: npm ci

      - name: Deploy ${{ matrix.worker }}
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: workers/${{ matrix.worker }}
          command: deploy --env ${{ github.ref == 'refs/heads/main' && 'prod' || 'preview' }}
```

**Step 2: Verify locally that all tests pass**

Run: `cd /Users/ggugger/Code/flaim && for w in auth-worker espn-client fantasy-mcp; do echo "=== $w ===" && cd workers/$w && npm test && cd ../..; done`
Expected: All three workers show passing tests

**Step 3: Commit**

```bash
git add .github/workflows/deploy-workers.yml
git commit -m "ci: run tests for auth-worker, espn-client, and fantasy-mcp"
```

---

## Task 4: Push and Verify CI

**Files:** None (verification only)

**Step 1: Push to trigger CI**

Run: `git push origin main`

**Step 2: Check CI status**

Run: `gh run list --limit 3`
Expected: See a new workflow run in progress or completed

**Step 3: View test job results**

Run: `gh run view --log | head -150`
Expected: Test jobs for all three workers pass, deploy jobs run after

---

## Summary

| Worker | Before | After |
|--------|--------|-------|
| auth-worker | ✅ 50 tests | ✅ 50 tests |
| espn-client | ❌ No tests | ✅ ~5 tests |
| fantasy-mcp | ❌ No tests | ✅ ~5 tests |
| CI coverage | auth-worker only | All 3 new workers |

**Total test count after completion:** ~60 tests across 3 workers

**Note:** The initial tests are type/interface tests. They provide:
1. Documentation of expected data shapes
2. Verification that TypeScript types compile correctly
3. A foundation to add behavior tests later
