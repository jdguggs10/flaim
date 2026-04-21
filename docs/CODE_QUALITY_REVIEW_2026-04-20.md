# Code Quality Review (April 20, 2026)

This review highlights potential bugs, optimization opportunities, and maintainability improvements discovered from targeted source inspection and local checks.

## Scope Reviewed

- `web/app/(site)/leagues/page.tsx`
- `extension/src/lib/api.ts`
- `workers/shared/src/oauth-redirect.ts`
- `web/app/api/extension/sync/route.ts`

## Findings

### 1) React effect dependency suppression can cause stale behavior (medium)

In `leagues/page.tsx`, one `useEffect` intentionally disables `react-hooks/exhaustive-deps` and only depends on `isSignedIn`, but it uses `searchParams`, `router`, and several local async helpers (`discoverYahooLeagues`, `checkYahooStatus`, `loadYahooLeagues`, `checkSleeperStatus`, `loadSleeperLeagues`). This can cause stale closures, and can miss refreshes when URL params change without auth state changing.

**Why it matters**
- OAuth callback query params can change while `isSignedIn` remains true.
- Future refactors to helper functions can silently introduce stale-capture bugs.

**Recommendation**
- Split responsibilities into separate effects (auth state, URL-param handling, background fetches).
- Add the required dependencies or wrap helpers in `useCallback`.
- Remove the lint suppression once dependency-safe.

### 2) Async chain sequencing introduces unnecessary latency (low/medium)

The same effect triggers status checks followed by league loads using chained `.then()` calls:
- `checkYahooStatus().then(() => loadYahooLeagues())`
- `checkSleeperStatus().then(() => loadSleeperLeagues())`

This is correct functionally, but it serializes each platform’s status->load path and can delay first meaningful render when APIs are slow.

**Recommendation**
- Run independent platform flows concurrently with `Promise.allSettled`.
- Keep per-platform error isolation and partial rendering.

### 3) Missing cancellation guards in async effects (medium)

The preferences loader and league status/load flows are launched inside `useEffect`, but there is no cancellation pattern (abort signal or `isMounted` guard). If the component unmounts during slow requests, state updates can occur after unmount.

**Recommendation**
- Add `AbortController` for fetches and a `let cancelled = false` cleanup guard for post-fetch `setState`.

### 4) Input/response normalization edge in extension API base detection (low)

`detectApiBase()` appends `/api/extension` directly to `VITE_SITE_BASE`. If a deployment config provides `VITE_SITE_BASE` with trailing slash (e.g. `https://preview.flaim.app/`), the resulting URL includes a double slash (`//api/extension`). Browsers typically normalize this, but it can be fragile for logging, signature checks, and future URL joins.

**Recommendation**
- Normalize once: `const normalized = envBase.replace(/\/$/, '')` before concatenation.

### 5) Redirect validator includes broad custom-scheme acceptance pattern (low, security hardening)

`isCursorRedirectUri()` validates via string checks and accepts hosts that start with `anysphere.cursor-` and end in `/oauth/{id}/callback`. This appears intentional, but it is broad and could admit unexpected variants if Cursor’s expected authority format tightens.

**Recommendation**
- Consider a stricter pattern match (full regex for known authority + bounded `{id}` chars/length).
- Add explicit tests for near-miss malformed URIs.

## Validation commands run

- `corepack pnpm --dir web run lint` (pass)
- `corepack pnpm --dir workers/shared test` (pass)
- `corepack pnpm --dir workers/auth-worker test` (pass)
- `corepack pnpm --dir web run build` (fails in this environment due to missing Clerk publishable key)

## Suggested next actions (priority order)

1. Refactor `leagues/page.tsx` effects to remove dep suppression + add cancellation.
2. Parallelize cross-platform league fetch bootstrapping.
3. Normalize `VITE_SITE_BASE` in extension client URL assembly.
4. Tighten custom-scheme redirect matching and expand negative test coverage.
