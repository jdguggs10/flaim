# Auth Worker Vitest Migration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate `workers/auth-worker` from Jest to Vitest using Cloudflare’s Workers pool with minimal test changes.

**Architecture:** Replace Jest config with a `vitest.config.ts` that uses `defineWorkersConfig` and points to `wrangler.jsonc`, then update test imports/mocks to Vitest equivalents. Keep CI and test scope unchanged.

**Tech Stack:** Vitest (~3.2), `@cloudflare/vitest-pool-workers`, TypeScript, Wrangler config.

---

### Task 1: Switch auth-worker dependencies and test script

**Files:**
- Modify: `workers/auth-worker/package.json`
- Modify: `package-lock.json`

**Step 1: Update the test script and devDependencies**

Edit `workers/auth-worker/package.json`:
- Change `"test"` to `"vitest run"`.
- Remove `jest`, `ts-jest`, `@types/jest`, `@jest/globals`.
- Add `vitest` and `@cloudflare/vitest-pool-workers` (use `vitest@~3.2.0` to stay in supported range).

Expected snippet:
```json
"scripts": {
  "dev": "wrangler dev --port 8786",
  "deploy": "wrangler deploy",
  "test": "vitest run",
  "type-check": "tsc --noEmit"
}
```
```json
"devDependencies": {
  "@cloudflare/vitest-pool-workers": "^0.7.0",
  "@types/node": "^24.0.3",
  "typescript": "^5.6.2",
  "vitest": "~3.2.0",
  "wrangler": "^4.53.0"
}
```

**Step 2: Install to update the lockfile**
Run: `npm install`
Expected: `package-lock.json` updated.

**Step 3: Run tests to confirm RED (expected to fail)**
Run: `npm test`
Working directory: `workers/auth-worker`
Expected: FAIL (likely missing `@jest/globals` or `jest` namespace) — confirms the runner switch is active.

**Step 4: Commit**
```bash
git add workers/auth-worker/package.json package-lock.json
git commit -m "chore(auth-worker): switch test runner to vitest"
```

---

### Task 2: Replace Jest config with Vitest Workers pool config

**Files:**
- Delete: `workers/auth-worker/jest.config.js`
- Create: `workers/auth-worker/vitest.config.ts`

**Step 1: Remove Jest config**
```bash
git rm workers/auth-worker/jest.config.js
```

**Step 2: Create Vitest config**
Create `workers/auth-worker/vitest.config.ts`:
```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
  },
});
```

**Step 3: Run tests to confirm RED (expected to fail)**
Run: `npm test`
Working directory: `workers/auth-worker`
Expected: FAIL (tests still importing Jest).

**Step 4: Commit**
```bash
git add workers/auth-worker/vitest.config.ts workers/auth-worker/jest.config.js
git commit -m "chore(auth-worker): add vitest workers config"
```

---

### Task 3: Update TypeScript test types

**Files:**
- Modify: `workers/auth-worker/tsconfig.json`

**Step 1: Replace Jest types with Vitest types**
Edit `workers/auth-worker/tsconfig.json`:
```json
"types": ["@cloudflare/workers-types", "node", "vitest", "@cloudflare/vitest-pool-workers"]
```

**Step 2: Run tests to confirm RED (expected to fail)**
Run: `npm test`
Working directory: `workers/auth-worker`
Expected: FAIL (still importing Jest in test files).

**Step 3: Commit**
```bash
git add workers/auth-worker/tsconfig.json
git commit -m "chore(auth-worker): update test types for vitest"
```

---

### Task 4: Update test imports and mocks

**Files:**
- Modify: `workers/auth-worker/src/__tests__/season-utils.test.ts`
- Modify: `workers/auth-worker/src/__tests__/espn-types.test.ts`
- Modify: `workers/auth-worker/src/__tests__/get-league-teams.test.ts`
- Modify: `workers/auth-worker/src/__tests__/league-discovery.test.ts`

**Step 1: Replace Jest imports with Vitest imports**
For each test file, replace:
```ts
import { describe, expect, it, beforeEach, jest } from '@jest/globals';
```
with:
```ts
import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
```
Use the shorter import when `beforeEach`/`vi` are not needed.

**Step 2: Replace `jest.*` with `vi.*`**
Examples:
```ts
const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
```

**Step 3: Run tests to confirm GREEN**
Run: `npm test`
Working directory: `workers/auth-worker`
Expected: PASS (50 tests).

**Step 4: Commit**
```bash
git add workers/auth-worker/src/__tests__/*.test.ts
git commit -m "test(auth-worker): migrate tests to vitest"
```

---

### Task 5: Final verification

**Files:**
- None (verification only)

**Step 1: Run full auth-worker tests**
Run: `npm test`
Working directory: `workers/auth-worker`
Expected: PASS.

**Step 2: Record any warnings**
If the `--localstorage-file` warning or console logs still appear, note them for follow-up cleanup (optional).

**Step 3: Commit follow-up (optional)**
Only if you choose to clean up logs/warnings in this migration.

---

## Notes
- This plan intentionally keeps the test scope restricted to `src/` to avoid pulling in archived tests.
- If we later add bindings (KV/D1/etc.), extend `poolOptions.workers.miniflare` in `vitest.config.ts`.
