# Auth Worker Test Noise Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove Vitest warnings from `wrangler.jsonc` parsing and silence `league-discovery` test logs without changing production behavior.

**Architecture:** Introduce a test-only Wrangler config without the `observability` block and point Vitest to it, then stub `console.log` locally in the `league-discovery` test file.

**Tech Stack:** Vitest, `@cloudflare/vitest-pool-workers`, Wrangler config, TypeScript.

---

### Task 1: Add a test-only Wrangler config

**Files:**
- Create: `workers/auth-worker/wrangler.test.jsonc`
- Modify: `workers/auth-worker/vitest.config.ts`

**Step 1: Write the failing test (config warning present)**
Run: `npm test`
Working directory: `workers/auth-worker`
Expected: PASS tests but WARN about `observability` fields in `wrangler.jsonc`.

**Step 2: Create test Wrangler config**
Create `workers/auth-worker/wrangler.test.jsonc`:
```jsonc
{
  "name": "auth-worker",
  "main": "./src/index-hono.ts",
  "compatibility_date": "2024-12-01"
}
```

**Step 3: Point Vitest to the test config**
Edit `workers/auth-worker/vitest.config.ts`:
```ts
wrangler: { configPath: './wrangler.test.jsonc' },
```

**Step 4: Run tests to verify warning removed**
Run: `npm test`
Working directory: `workers/auth-worker`
Expected: PASS, no `observability` warnings.

**Step 5: Commit**
```bash
git add workers/auth-worker/wrangler.test.jsonc workers/auth-worker/vitest.config.ts
git commit -m "chore(auth-worker): add test wrangler config"
```

---

### Task 2: Silence logs in league-discovery tests only

**Files:**
- Modify: `workers/auth-worker/src/__tests__/league-discovery.test.ts`

**Step 1: Write the failing test (logs present)**
Run: `npm test`
Working directory: `workers/auth-worker`
Expected: PASS tests but logs from `discoverLeaguesV3` appear.

**Step 2: Stub console.log locally**
Update `workers/auth-worker/src/__tests__/league-discovery.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  mockFetch.mockReset();
});

afterEach(() => {
  logSpy.mockRestore();
});
```

**Step 3: Run tests to verify logs are gone**
Run: `npm test`
Working directory: `workers/auth-worker`
Expected: PASS, no `discoverLeaguesV3` logs.

**Step 4: Commit**
```bash
git add workers/auth-worker/src/__tests__/league-discovery.test.ts
git commit -m "test(auth-worker): silence league discovery logs"
```

---

### Task 3: Final verification

**Files:**
- None (verification only)

**Step 1: Run auth-worker tests**
Run: `npm test`
Working directory: `workers/auth-worker`
Expected: PASS, no wrangler warnings, no league-discovery logs.

**Step 2: Commit follow-up (optional)**
Only if new adjustments are required.
