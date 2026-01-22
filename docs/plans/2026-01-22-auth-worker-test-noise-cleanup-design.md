# Auth Worker Test Noise Cleanup (Wrangler Test Config + Log Stubbing)

## Goal
Reduce Vitest noise in `workers/auth-worker` by removing `wrangler.jsonc` warnings and silencing `discoverLeaguesV3` console output in its test file.

## Scope
- Add a test-only Wrangler config with `observability` removed.
- Point Vitest to that test config.
- Stub `console.log` only in `league-discovery.test.ts`.

## Non-Goals
- No production behavior changes.
- No new tests or fixtures.
- No global console suppression.

## Approach
1) **Test-only Wrangler config**
   - Create `workers/auth-worker/wrangler.test.jsonc`.
   - Mirror only required fields: `name`, `main`, `compatibility_date`, and any bindings/vars used by tests.
   - Omit `observability` to avoid warnings from the Workers pool.

2) **Vitest config update**
   - Update `workers/auth-worker/vitest.config.ts` to use:
     - `wrangler: { configPath: './wrangler.test.jsonc' }`.

3) **Local log suppression**
   - In `workers/auth-worker/src/__tests__/league-discovery.test.ts`, add a `vi.spyOn(console, 'log')` stub in `beforeEach` and restore in `afterEach` (or `afterAll`).
   - Keep suppression local to this file to avoid hiding unexpected logs in other tests.

## Testing
- Run `npm test` in `workers/auth-worker`.
- Expect no `observability` warnings and no log spam from `discoverLeaguesV3`.

## Rollback
- Revert the commit(s) to restore the previous Vitest config and logging behavior.
