# Migration Plan: Introduce a Platform-Agnostic **Auth Worker**

> **Status**: Draft 2024-xx-xx

---

## 1. Goal

Create a single Cloudflare Worker ("**auth-worker**") responsible **only** for storing, retrieving, and revoking user platform credentials.  The worker will be *platform agnostic*—it will handle ESPN credentials today and expand to Yahoo, Sleeper, etc.  This removes duplicated `/credentials` endpoints from the sport-specific MCP workers and simplifies the onboarding flow in the Next.js app.

## 2. Current State (Problems to Solve)

| Component | What it does now | Problem |
|-----------|-----------------|---------|
| `workers/*-espn-mcp` | Serve `/health`, `/credentials`, `/mcp` | *Credentials logic duplicated* across each worker.  Onboarding fails unless at least **one** sport worker is up locally. |
| `openai/components/onboarding/auth/EspnAuth.tsx` | POST credentials to `[sportWorker]/credentials` | Tightly coupled to sport, requires conditional URL logic. |
| `start-dev.sh` | Boots **both** sport workers so one can accept creds | Longer boot time, extra logs. |
| KV layout | `CF_KV_CREDENTIALS` keyed by Clerk user-id, encrypted | Fine; we will keep this exactly the same. |

## 3. Target Architecture

```mermaid
flowchart TD
    subgraph Frontend (Next.js)
        A(EspnAuth.tsx / future providers)
    end

    A -- POST {swid,s2,…} --> B[auth-worker /credentials/:platform]

    subgraph Workers
        B
        C[baseball-espn-mcp  (/mcp/* endpoints only)]
        D[football-espn-mcp  (/mcp/* endpoints only)]
        E[… future mcp workers]
    end

    B -- KV read/write --> KV[(CF_KV_CREDENTIALS)]
    C -- KV read --> KV
    D -- KV read --> KV
```

*Only* the auth-worker exposes credential endpoints.  Sport workers now **only** expose their `/mcp/*` APIs and health checks.

## 4. Items to Remove / Refactor

1. **/credentials routes** in:  
   • `workers/baseball-espn-mcp/src/index.ts`  
   • `workers/football-espn-mcp/src/index.ts`  
   • (any future MCP worker templates)
2. Conditional `getWorkerUrl()` logic in `EspnAuth.tsx`.
3. Credential-storage helper code duplicated inside each sport worker.
4. `start-dev.sh`: sport workers no longer need `/credentials`; add auth-worker instead.
5. Environment variables `NEXT_PUBLIC_BASEBALL_ESPN_MCP_URL`, `NEXT_PUBLIC_FOOTBALL_ESPN_MCP_URL` *for auth*—replace with `NEXT_PUBLIC_AUTH_WORKER_URL`.  Sport workers still expose **/mcp/** endpoints as before.

## 5. Step-by-Step Implementation Guide

### Phase 0 – Preparation

1. **Create branch** `feature/auth-worker`.
2. Confirm test coverage passes (`npm test` root + workers).
3. Tag a pre-migration git checkpoint.

### Phase 1 – Scaffold New Worker

1. `mkdir -p workers/auth-worker/src && cd workers/auth-worker`.
2. `npm init -y` & add to monorepo workspaces (root `package.json`).
3. Add `wrangler.toml`:
   ```toml
   name = "auth-worker"
   main = "./src/index.ts"
   compatibility_date = "2024-05-01"
   [[kv_namespaces]]
   binding = "CF_KV_CREDENTIALS"
   id = "${CF_KV_CREDENTIALS_ID}"
   preview_id = "${CF_KV_CREDENTIALS_PREVIEW_ID}"
   ```
4. Copy **only** the credential-handling helper from `EspnKVStorageAPI` and CORS utils.
5. Implement endpoints:
   * `GET /health` – returns JSON status and KV test.
   * `POST/PUT /credentials/:platform` – upsert creds for the given provider (e.g. `espn`, `yahoo`).
   * `GET /credentials/:platform` – fetch credential metadata.
   * `DELETE /credentials/:platform` – revoke creds.
   * `/:anything` –> 404 JSON.
6. Add unit tests in `workers/auth-worker/tests`.

### Phase 1.5 – Re-align Auth Worker with Current Header Contract

> These corrective tasks fold in the feedback from the first implementation pass and make the new worker compatible with the **existing** front-end and MCP workers.  Complete them **before** starting Phase 2.

1. **Authentication header**
   * Remove the `Authorization: Bearer <session-token>` requirement.
   * Accept and validate the existing `X-Clerk-User-ID` header (return `401` if missing).
   * Delete `verifyClerkSession()` and related Clerk-session logic.
   * Drop the `@clerk/backend` dependency from `workers/auth-worker/package.json`.
2. **Encryption helper**
   * Either import the already-written helper from `auth/espn/kv-storage` **or** keep the in-file class but ensure `await encryption.initialize()` (or lazy-await inside `encrypt/decrypt`) to avoid "Encryption key not initialized" at runtime.
3. **Type-safety fix**
   * Ensure `storeCredentials()` is invoked with the correct `PlatformCredentials` type (remove the stray `formCredentials` identifier).  The signature should be:
   ```ts
   const success = await storage.storeCredentials(platform, clerkUserId, body as PlatformCredentials);
   ```
4. **Package & scripts**
   * Remove `@clerk/backend` from `dependencies` in `workers/auth-worker/package.json`.
   * Make sure `jest` is included in `devDependencies` (the root install suffices, but add here if desired for isolation).
5. **Unit test update**
   * Adjust the mock request helpers to send the `X-Clerk-User-ID` header and assert the 401 case when the header is absent.

When these subtasks pass linting/tests (`npm t --workspaces workers/auth-worker`) the migration can proceed to Phase 2.

### Phase 2 – Remove Legacy Credential Code

1. In each sport worker (`baseball-espn-mcp`, `football-espn-mcp`):
   * Delete or comment out the `/credentials` block (lines ~100-150).  
   * Remove related imports (`EspnKVStorageAPI`, etc.).
2. Adjust health-check routes if they referenced KV status via credential code.

### Phase 3 – Frontend Updates

1. **Environment**:  
   * Add `.env.local` key `NEXT_PUBLIC_AUTH_WORKER_URL=http://localhost:8786` (or prod URL).
2. In `openai/components/onboarding/auth/EspnAuth.tsx`:
   * Delete the `getWorkerUrl()` branching logic.
   * Replace fetch call with:
   ```ts
   const response = await fetch(`${process.env.NEXT_PUBLIC_AUTH_WORKER_URL}/credentials/espn`, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json', 'X-Clerk-User-ID': userId },
     body: JSON.stringify({ swid, s2 })
   });
   ```
   *(Use lowercase provider names in the URL segment.)*
3. Add placeholder logic for future providers (Yahoo, Sleeper) – maybe pass `platform` variable.

### Phase 4 – Dev-Tools & Scripts

1. **start-dev.sh**:
   * Spawn auth-worker on port **8786** (`wrangler dev --port 8786`).
   * Drop `/credentials` comment lines for sport workers.
2. Update health-wait loop to ping `http://localhost:8786/health`.

### Phase 5 – Smoke Tests

1. Run `./start-dev.sh`; ensure:
   * `curl http://localhost:8786/health` → 200.
   * Onboarding → Connect ESPN → returns 200, KV key set.
   * Sport worker MCP call reads creds successfully (`/mcp/getLeagueMeta`).
2. Playwright/e2e tests: update any hard-coded URLs.

### Phase 6 – Deployment

1. **Infra**: Add auth-worker to CI deployment pipeline; set KV bindings.
2. Update environment variables in Cloudflare, Vercel, Netlify, etc.
3. Deploy to staging; run regression tests.
4. When satisfied, deploy to production.

### Phase 7 – Cleanup

1. Remove obsolete env vars from CI secrets and documentation.
2. Close migration ticket; tag release `vX.Y.0`.

## 6. Backwards Compatibility Considerations

* **KV keys remain identical** (`credentials:{userId}`) so sport workers in prod won't break if they are updated after auth-worker is live.
* Frontend releases must coincide with auth-worker availability; else credential POSTs will 404.
* Keep `/credentials` route in sport workers behind a feature flag for one release if gradual rollout is preferred.

## 7. Future Extensions

* Add OAuth flow endpoints for Yahoo (requires callback URL & PKCE support).  
* Support Sleeper JWT:  `/credentials/sleeper` to exchange bearer token.  
* Move encryption utils to `auth/shared/encryption.ts` to avoid cross-package duplication.

---

### Checklist for Claude Code

- [ ] Scaffold `workers/auth-worker` with routing & KV.
- [ ] Delete `/credentials` logic from sport workers.
- [ ] Refactor `EspnAuth.tsx` to hit `NEXT_PUBLIC_AUTH_WORKER_URL`.
- [ ] Update `start-dev.sh` and docs.
- [ ] Run unit + e2e tests.
- [ ] Submit PR `feature/auth-worker` for review. 