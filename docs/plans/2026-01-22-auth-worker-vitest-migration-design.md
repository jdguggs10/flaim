# Auth Worker Vitest Migration (Workers Pool)

## Goal
Migrate `workers/auth-worker` from Jest to Vitest using Cloudflare’s Workers pool so tests run in a workerd-like runtime, with minimal change and low maintenance.

## Scope (Phase 1)
- Replace Jest with Vitest + `@cloudflare/vitest-pool-workers` in `auth-worker` only.
- Update test imports and mocks (`@jest/globals` → `vitest`, `jest.*` → `vi.*`).
- Replace Jest config with a Vitest config that uses the Workers pool and `wrangler.jsonc`.
- Keep CI behavior the same (`npm test` in `workers/auth-worker`).

## Non-Goals
- No new tests or behavior changes.
- No Miniflare fixtures/bindings beyond what’s in `wrangler.jsonc`.
- No migration of `espn-client` or `fantasy-mcp` (Phase 2 later).

## Approach
1) **Dependencies**
   - Remove: `jest`, `ts-jest`, `@types/jest`, `@jest/globals`.
   - Add: `vitest`, `@cloudflare/vitest-pool-workers`.

2) **Configuration**
   - Delete `workers/auth-worker/jest.config.js`.
   - Add `workers/auth-worker/vitest.config.ts` using:
     - `defineWorkersConfig` from `@cloudflare/vitest-pool-workers/config`.
     - `poolOptions.workers.wrangler.configPath = "./wrangler.jsonc"`.
   - Update `workers/auth-worker/tsconfig.json`:
     - Remove `jest` types.
     - Add `vitest` and `@cloudflare/vitest-pool-workers` types.

3) **Test Updates**
   - Update all test files under `src/__tests__/`:
     - `import { describe, it, expect, vi } from 'vitest'`.
     - Replace `jest.fn()` / `jest.spyOn()` with `vi.fn()` / `vi.spyOn()`.

4) **Scripts/CI**
   - Update `workers/auth-worker/package.json` test script to `vitest run`.
   - Keep `.github/workflows/deploy-workers.yml` unchanged (still runs `npm test`).

## Risks and Mitigations
- **Workers runtime differences**: Tests may fail if they rely on Node APIs. Fix by stubbing or rewriting to use Workers-compatible APIs.
- **Type collisions**: Ensure `jest` types are removed from `tsconfig.json` to avoid conflicts.

## Rollback
- Revert the commit to restore Jest config and dependencies.

## Phase 2 (Later)
- Add minimal Vitest setup to `espn-client` and `fantasy-mcp` with the same pool config and explicit imports.
