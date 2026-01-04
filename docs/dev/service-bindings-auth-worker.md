# Service Bindings Plan: MCP Workers -> Auth Worker

Date: 2026-01-04
Status: Draft (research + implementation sketch)
Owner: TBD

## Goal
Replace HTTP fetches from the MCP workers (baseball/football) to `auth-worker` with **Cloudflare Service Bindings (HTTP)** to avoid same-zone fetch restrictions (error 1042) and improve reliability.

This is a targeted change: keep the auth-worker HTTP API unchanged, swap the transport to a binding.

## Background (What Service Bindings Are)
Cloudflare Service Bindings let one Worker call another **without going through a publicly accessible URL**. They're designed for internal service-to-service communication and offer:
- **No added latency / zero overhead** (Workers can run on the same server thread by default).
- **No additional cost**.
- Two interface styles: **HTTP** (`env.BINDING.fetch(request)`) and **RPC** (direct method calls via `WorkerEntrypoint`).

References:
- Service bindings overview: https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
- HTTP service binding: https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/
- RPC service binding: https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/

## Why This Fix (vs Compatibility Flag)
Current bug: sport worker -> auth-worker fetch returns Cloudflare **error 1042** (same-zone Worker fetch blocked unless a compatibility flag is set).

Service bindings are Cloudflare's **first-class internal communication** mechanism. They avoid the same-zone fetch limitation and remove dependence on public routing quirks.

References:
- Error 1042 description: https://developers.cloudflare.com/workers/observability/errors/
- Worker-to-Worker fetch allowed via service bindings or `global_fetch_strictly_public`: https://developers.cloudflare.com/workers/runtime-apis/fetch/
- Compatibility flags, including `global_fetch_strictly_public`: https://developers.cloudflare.com/workers/configuration/compatibility-flags/

## Recommended Approach
Use **HTTP Service Bindings** for minimal code change. Keep the existing auth-worker HTTP endpoints and pass through Requests with headers (Authorization, X-Clerk-User-ID, etc.).

RPC is attractive but would require a new `WorkerEntrypoint` and API surface; that's a bigger refactor than we need right now.

## Scope of Change
- `workers/baseball-espn-mcp` and `workers/football-espn-mcp` will call auth-worker via a binding.
- `workers/auth-worker` stays the same.
- Remove or de-emphasize the need for `global_fetch_strictly_public`.

## Compatibility With LLM MCP Calls (No Impact Expected)
Service bindings only change **internal** MCP-worker -> auth-worker transport. Public MCP endpoints and OAuth flows stay the same:
- LLMs still call the public MCP URLs (`/baseball/mcp`, `/football/mcp`).
- OAuth 2.1 endpoints and consent screens remain unchanged.
- Auth-worker continues to validate `Authorization` and `X-Clerk-User-ID` headers as before.

Potential break points are configuration-only (binding name mismatches per env, missing binding locally) and not client-facing.

## Configuration Changes (Wrangler)
Add a Service Binding named `AUTH_WORKER` in the MCP workers' `wrangler.jsonc`.

Example (conceptual):
```jsonc
// workers/baseball-espn-mcp/wrangler.jsonc
{
  "services": [
    {
      "binding": "AUTH_WORKER",
      "service": "auth-worker" // prod name
    }
  ],
  "env": {
    "prod": {
      "name": "baseball-espn-mcp",
      "vars": {
        "AUTH_WORKER_URL": "https://auth-worker.gerrygugger.workers.dev"
      },
      "services": [
        { "binding": "AUTH_WORKER", "service": "auth-worker" }
      ]
    },
    "preview": {
      "name": "baseball-espn-mcp-preview",
      "vars": {
        "AUTH_WORKER_URL": "https://auth-worker-preview.gerrygugger.workers.dev"
      },
      "services": [
        { "binding": "AUTH_WORKER", "service": "auth-worker-preview" }
      ]
    },
    "dev": {
      "name": "baseball-espn-mcp-dev",
      "vars": {
        "AUTH_WORKER_URL": "https://auth-worker-dev.gerrygugger.workers.dev"
      },
      "services": [
        { "binding": "AUTH_WORKER", "service": "auth-worker-dev" }
      ]
    }
  }
}
```

Notes:
- The **service name must match the target Worker's `name`** for that environment (e.g., `auth-worker`, `auth-worker-preview`).
- We can keep `AUTH_WORKER_URL` as a fallback for local dev or if bindings are not available.

## Code Changes (MCP Workers)
Minimal changes in `workers/baseball-espn-mcp/src/index.ts` and `workers/football-espn-mcp/src/index.ts`:

1. **Add binding type** to `Env`:
```ts
interface Env {
  AUTH_WORKER_URL: string;
  AUTH_WORKER?: Fetcher; // Service Binding (HTTP)
  NODE_ENV?: string;
  ENVIRONMENT?: string;
}
```

2. **Prefer binding for auth-worker calls**:
```ts
const targetRequest = new Request("https://auth-worker.internal/credentials/espn?raw=true", {
  method: "GET",
  headers
});

const response = env.AUTH_WORKER
  ? await env.AUTH_WORKER.fetch(targetRequest)
  : await fetch(url, { method: "GET", headers });
```

Why the full URL? The HTTP binding docs state that if you construct a new request, you must provide a **valid, fully-qualified URL with a hostname**. The hostname doesn't need to be real; it's only used as a string in the Request object.

Reference:
- https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/

## Implementation Details (Code-Level Plan)
Use a small helper to centralize "binding first, URL fallback" logic. This avoids missing any call sites and keeps behavior consistent.

### Files to Update
- `workers/baseball-espn-mcp/src/index.ts`
- `workers/football-espn-mcp/src/index.ts`
- `workers/baseball-espn-mcp/src/mcp/agent.ts`
- `workers/football-espn-mcp/src/mcp/football-agent.ts`
- `workers/baseball-espn-mcp/wrangler.jsonc`
- `workers/football-espn-mcp/wrangler.jsonc`

### Helper Function (per worker file or shared local helper)
```ts
function authWorkerFetch(env: Env, path: string, init?: RequestInit): Promise<Response> {
  const safePath = path.startsWith('/') ? path : `/${path}`;
  if (env.AUTH_WORKER) {
    const url = new URL(safePath, 'https://auth-worker.internal');
    const request = new Request(url.toString(), init);
    return env.AUTH_WORKER.fetch(request);
  }
  if (!env.AUTH_WORKER_URL) {
    throw new Error('AUTH_WORKER_URL is not configured');
  }
  return fetch(`${env.AUTH_WORKER_URL}${safePath}`, init);
}
```

Notes:
- Binding requests must use a **fully-qualified URL** with a hostname.
- Keep **headers** intact (especially `Authorization` and `X-Clerk-User-ID`).
- Keep `AUTH_WORKER_URL` as a **fallback** for local dev or missing bindings.

### Call Sites to Convert
1. **Credential fetch**  
   - `getCredentials()` in both MCP workers (currently uses `fetch(url)`).
2. **League fetch**  
   - `getUserLeagues()` in both MCP workers.
   - `fetchUserLeagues()` in both MCP agents.
3. **Health checks**  
   - `/health` endpoint in both MCP workers should call auth-worker via `authWorkerFetch` for parity.

### Env Type Updates
Add optional binding to all MCP worker env types:
```ts
AUTH_WORKER?: Fetcher;
```

### Minimal Logging (Optional)
Add a single log line when binding is missing in prod:
```ts
if (!env.AUTH_WORKER && env.ENVIRONMENT === 'prod') {
  console.log('⚠️ AUTH_WORKER binding missing in prod; falling back to AUTH_WORKER_URL');
}
```

## Local Development Strategy
Two options:

1. **Use bindings locally** (best parity):
   - Configure `services` in `wrangler.jsonc` and run `wrangler dev` for both workers.
   - Ensure the service names match the local dev worker names.

2. **Fallback to URL** (simpler):
   - Keep `AUTH_WORKER_URL` and use it if `env.AUTH_WORKER` is undefined.
   - This makes local dev work without extra configuration but slightly diverges from prod.

Given project constraints (simplicity), option 2 is acceptable.

## Rollout Plan
1. Add service bindings to both MCP workers (prod + preview + dev configs).
2. Update MCP worker code to prefer binding.
3. Deploy preview workers.
4. Validate:
   - Auto-pull flow in preview
   - Claude/ChatGPT MCP calls
   - Cloudflare logs show successful auth-worker fetch (no 1042)
5. Deploy production workers.

## Rollback Plan
- Revert to `AUTH_WORKER_URL` fetch only.
- Remove `services` bindings from Wrangler configs.

## Risks
- Misconfigured service name per environment causes runtime errors.
- If binding is missing, `env.AUTH_WORKER` is undefined; must have fallback to URL to avoid failures.
- RPC approach would require more refactor and is not recommended for this project right now.
- If any logic depends on `Host`/`Origin`, behavior could differ. Current auth-worker uses `Origin` only for CORS and does not use `Host` for auth decisions, so this risk is low.

## Open Questions
- Should we keep `global_fetch_strictly_public` as a temporary safety net, or remove it once bindings are in place?
- Should we add a small runtime assertion log when `env.AUTH_WORKER` is missing in prod?

## Implementation Checklist (Thorough)

### Current Repo Findings (Answers Before Implementation)
- **Worker names per env** (from `wrangler.jsonc`):
  - Auth: `auth-worker` (prod), `auth-worker-preview` (preview), `auth-worker-dev` (dev)
  - Baseball: `baseball-espn-mcp`, `baseball-espn-mcp-preview`, `baseball-espn-mcp-dev`
  - Football: `football-espn-mcp`, `football-espn-mcp-preview`, `football-espn-mcp-dev`
- **Preview/dev configs exist** in repo for all three workers. Actual deployments should be verified in the Cloudflare dashboard.
- **Local dev flow** is already documented in `workers/README.md`:
  - `npm run dev:workers` or `wrangler dev --env dev --port ...`
  - MCP workers currently rely on `AUTH_WORKER_URL` in `.dev.vars`.
  - Recommendation: keep URL fallback for local dev to avoid requiring multi-worker `wrangler dev` setup.
- **`global_fetch_strictly_public` is not set** in any worker config right now.
- **Host/Origin assumptions**: auth-worker uses `Origin` only for CORS allowlist; no Host-based auth decisions observed.
- **Health checks exist** on MCP workers and can be repointed to bindings for parity.
- **Deployment scripts** exist for preview/prod (`npm run deploy:workers:preview|prod`), so preview-first rollout is feasible.

### Pre-Flight Verification (Hand to Another Agent)
Use this checklist to confirm everything *outside* the repo before implementation:

- **Cloudflare Dashboard**
  - Confirm service names for auth-worker in prod/preview/dev match `wrangler.jsonc`.
  - Confirm preview and dev workers are actually deployed (not just config).
  - Confirm all workers are in the **same Cloudflare account** (bindings are account-scoped).
  - Confirm `wrangler` version in CI/CD supports `services` bindings in `wrangler.jsonc`.

- **Local Dev Stance**
  - Decide: keep URL fallback only (default) or run multi-worker `wrangler dev` with bindings.
  - If running bindings locally, ensure service names match local dev worker names.

- **Call Path Sanity**
  - Confirm MCP workers only call auth-worker endpoints: `/credentials/espn` and `/leagues` (plus `/health`).
  - Confirm internal requests always forward `Authorization` + `X-Clerk-User-ID` where required.

- **Deployment Plan**
  - Decide preview-first vs direct-to-prod rollout.
  - Decide whether to log a **prod warning** when bindings are missing and fallback is used.

If any of these are uncertain, resolve them before making code changes.

### Pre-Implementation
- Confirm the exact worker names for `auth-worker` in **prod/preview/dev** (must match service bindings). Names above are from repo config; verify in Cloudflare dashboard.
- Confirm current `AUTH_WORKER_URL` values for each MCP worker env (keep as fallback).
- Decide whether to keep `global_fetch_strictly_public` **unset** (recommended) or add as temporary safety net (not currently used).

### Config Updates
- Add `services` bindings in:
  - `workers/baseball-espn-mcp/wrangler.jsonc`
  - `workers/football-espn-mcp/wrangler.jsonc`
- Ensure each env uses the **correct service name**:
  - `auth-worker` (prod), `auth-worker-preview`, `auth-worker-dev` (or actual names in account).

### Code Updates
- Add `AUTH_WORKER?: Fetcher` to Env types in:
  - `workers/baseball-espn-mcp/src/index.ts`
  - `workers/football-espn-mcp/src/index.ts`
  - `workers/baseball-espn-mcp/src/mcp/agent.ts`
  - `workers/football-espn-mcp/src/mcp/football-agent.ts`
- Add `authWorkerFetch()` helper (per file or shared in each worker).
- Replace all auth-worker `fetch()` calls with `authWorkerFetch()`:
  - `getCredentials()`
  - `getUserLeagues()`
  - `fetchUserLeagues()` in MCP agents
  - auth-worker `/health` checks
- Preserve headers:
  - `Authorization`
  - `X-Clerk-User-ID`
  - `Content-Type`

### Local Validation (Dev)
- Option A: Run both workers with `wrangler dev` and enable bindings.
- Option B: Use `AUTH_WORKER_URL` fallback (no bindings).
- Check MCP worker `/health` shows auth-worker connectivity.

### Preview Validation
- Deploy preview workers.
- Verify auto-pull flow with a fresh user:
  - Save credentials manually
  - Run `/leagues` auto-pull
  - Confirm no `CREDENTIALS_MISSING` for valid credentials
- Confirm MCP flows:
  - Use Claude/ChatGPT to call any MCP tool
  - Ensure no 401s or 1042s in Cloudflare logs

### Production Validation
- Deploy prod workers.
- Repeat preview validation steps for manual-credentials onboarding.
- Check Cloudflare logs for absence of error 1042.

### Rollback Steps (If Needed)
- Revert code to URL-only fetches.
- Remove `services` bindings from Wrangler configs.
- Redeploy workers.
