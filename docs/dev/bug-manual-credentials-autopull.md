# Bug Report: Manual Credentials Saved but Auto‑Pull Returns CREDENTIALS_MISSING (Prod)

Date: 2026-01-04
Priority: High (core onboarding flow blocked)
Status: Open (root cause identified; remediation decision pending)

## Summary
In production, manual ESPN credentials are saved successfully for a new Clerk user, but the "Auto‑pull" flow fails with `CREDENTIALS_MISSING` when verifying a league (e.g., league ID `30201` for baseball). The UI can show a contradictory state: "Credentials saved" at the top and "ESPN credentials not found" under the league verification section. This blocks onboarding and league selection for manual‑entry users.

**Key observation**: Auto‑pull’s credential pre‑check succeeds, but the sport worker’s raw credential fetch fails. Cloudflare logs show the sport worker’s internal fetch to auth‑worker returns **error 1042** (same‑zone Worker fetch blocked unless a compatibility flag is enabled). This indicates a **platform‑level fetch restriction**, not a missing JWT or missing credentials.

## Impact
- Manual onboarding users cannot verify or add leagues in prod.
- The failure happens after credentials are saved, causing confusion and a dead end.
- This blocks the core product flow.

## Repro Steps (Prod)
1. Create a new Clerk account.
2. Go to `/leagues` and enter SWID + espn_s2. Save credentials (success toast appears).
3. Enter league ID `30201` (baseball) and click verify/search.
4. Error appears: “ESPN credentials not found. Please add your ESPN credentials first.”

## Observed Logs (Vercel)
```
[auto-pull] User: user_37ludelGjCTXkUzlCci6iIB6Jah, bearer token available: true
[auto-pull] Sport worker URL for baseball: https://baseball-espn-mcp.gerrygugger.workers.dev
Sport worker error: 404 { error: 'ESPN credentials not found. Please add your ESPN credentials first.', code: 'CREDENTIALS_MISSING' }
[auto-pull] Sport worker returned CREDENTIALS_MISSING
```

## Observed Logs (Cloudflare Workers)
```
✅ JWT payload.sub matches clerkUserId (no user ID mismatch)
✅ Authorization header present
❌ Auth-worker response: 404
⚠️ 404 response body: Cloudflare error code 1042
```

## Root Cause (Most Likely)
Cloudflare **error 1042** indicates a Worker attempted to `fetch()` another Worker on the same zone without the required compatibility flag. This means the baseball/football worker’s internal call to auth‑worker is blocked at the platform layer, and auth‑worker never receives the request. The sport worker then reports `CREDENTIALS_MISSING` because it sees a 404 body produced by Cloudflare, not by the application.

Remediation options:
1. **Enable `global_fetch_strictly_public`** in the MCP workers (baseball + football) so same‑zone Worker fetches are routed through the public “front door.”  
2. **Switch to Service Bindings (HTTP)** for worker‑to‑worker calls, which is Cloudflare’s first‑class internal communication mechanism and avoids same‑zone fetch restrictions entirely.

## Key Code Paths
- Manual credential save:
  - `web/app/api/auth/espn/credentials/route.ts` → `POST /credentials/espn`
  - `workers/auth-worker/src/index.ts` → `EspnSupabaseStorage.setCredentials`
- Auto‑pull verification:
  - `web/app/api/espn/auto-pull/route.ts`
    - `GET /credentials/espn` pre-check
    - `POST /onboarding/initialize` on sport worker
  - `workers/baseball-espn-mcp/src/index.ts` → `getCredentials` → `GET /credentials/espn?raw=true`

## Work Performed by Opus (from session notes)
- Read project context docs.
- Reproduced the issue in Chrome, captured network + console logs.
- Confirmed manual credential save returns `200` and API reports `hasCredentials: true`.
- Triggered auto‑pull in UI and observed `404` with `CREDENTIALS_MISSING`.
- Identified sport worker call as the failing stage.
- Added debug logging in `web/app/api/espn/auto-pull/route.ts`:
  - Log bearer token availability.
  - Log sport worker URL used.
  - Differentiate error codes between credential pre‑check and sport worker failure.
- Deployed and confirmed bearer token present; sport worker still returns `CREDENTIALS_MISSING`.

## Work Performed by Codex (this session)
- Mapped the full manual credential flow and auto‑pull flow end‑to‑end, reading:
  - `web/app/api/auth/espn/credentials/route.ts`
  - `web/app/api/espn/auto-pull/route.ts`
  - `workers/auth-worker/src/index.ts`
  - `workers/auth-worker/src/supabase-storage.ts`
  - `workers/baseball-espn-mcp/src/index.ts`
  - `workers/football-espn-mcp/src/index.ts`
- Confirmed that the sport worker treats a 404 from auth‑worker as “credentials missing.”
- Confirmed auth‑worker only trusts JWT in prod (no `X-Clerk-User-ID` fallback).
- Concluded the failure is downstream of the sport worker and most likely tied to **auth‑worker environment/secret mismatch or user ID mismatch**, not a missing bearer token.

## Not Yet Ruled Out: Routing/Environment Mismatch
**URL consistency alone does not prove the same worker deployment or Supabase project.** Verified on 2026-01-04:

- Vercel production env vars:
  - `NEXT_PUBLIC_AUTH_WORKER_URL` = `https://auth-worker.gerrygugger.workers.dev`
  - `NEXT_PUBLIC_BASEBALL_ESPN_MCP_URL` = `https://baseball-espn-mcp.gerrygugger.workers.dev`
- Cloudflare worker configs (wrangler.jsonc):
  - Baseball worker prod `AUTH_WORKER_URL` = `https://auth-worker.gerrygugger.workers.dev`

**Both the web app and sport worker appear to use the same auth-worker URL**, but this does **not** confirm:\n\n- the Cloudflare route binding is pointing to the same auth‑worker environment\n- the auth‑worker secrets (Supabase URL/key) are identical across entrypoints\n- the request is actually reaching the same auth‑worker script\n\nTo truly rule this out, call **both** entrypoints with the **same JWT** and compare responses (see Next Steps).

## Current Hypotheses
Primary (most likely):

1. **Cloudflare same‑zone Worker fetch restriction (error 1042)**  
   The baseball/football worker’s internal fetch to auth‑worker is blocked by Cloudflare unless `global_fetch_strictly_public` is enabled, or service bindings are used.

Secondary (still possible):
2. **Auth‑worker environment/secret mismatch**  
   If the 1042 error is resolved, but the fetch still returns 404, confirm both entrypoints hit the same auth‑worker env and Supabase project.
3. **JWT verification or user ID mismatch** (less likely now)  
   Logs show `sub` matches `clerkUserId`, so mismatch is unlikely.

## Work Performed by Opus (2026-01-04 morning session)
- Traced full code paths for credential save and auto-pull flows
- Verified Vercel production environment variables via Chrome browser automation
- **Noted URL consistency** across web and sport worker config (but this alone does not rule out route/secret mismatch)
- Added comprehensive diagnostic logging to trace JWT flow:

### Logging Added to `web/app/api/espn/auto-pull/route.ts`:
- JWT structure (parts count, length)
- JWT payload decode (sub, iss, exp timestamp)
- Auth worker URL being used
- Credential pre-check response status
- Sport worker URL and request details
- Sport worker response status

### Logging Added to `workers/baseball-espn-mcp/src/index.ts`:
- JWT payload.sub vs clerkUserId parameter comparison
- Auth-worker response headers
- Detailed 404 response body

### Logging Added to `workers/auth-worker/src/index.ts`:
- Full auth flow trace (Clerk JWT → OAuth → dev fallback)
- Environment check (ENVIRONMENT, NODE_ENV, isDev)
- Request pathname and query params
- Supabase credential lookup details

## Next Steps
1. **Choose remediation path (see below):**  
   - Short term: add `global_fetch_strictly_public` compatibility flag to sport workers.  
   - Long term: switch to Service Bindings (HTTP) for auth‑worker calls.
2. **Compare auth-worker entrypoints with the same JWT**  
   - `https://api.flaim.app/auth/credentials/espn?raw=true`  
   - `https://auth-worker.gerrygugger.workers.dev/credentials/espn?raw=true`  
   If responses differ, routing/secret mismatch is confirmed.
3. **Deploy the logging changes** to all three components
4. **Reproduce the bug** in production with a new user
5. **Capture logs** from:
   - Vercel (auto-pull route)
   - Cloudflare (baseball-espn-mcp worker)
   - Cloudflare (auth-worker)
6. **Analyze the trace** to confirm 1042 is resolved and internal auth‑worker fetch succeeds

## Optional Safety Improvement
- In `web/app/api/espn/auto-pull/route.ts`, parse the pre‑check response and fail if `hasCredentials === false` to prevent ambiguous UI state.

## Why This is High Priority
- Blocks onboarding for manual users.
- Produces contradictory UI state ("saved" vs "missing").
- Core flow that affects all new users without the Chrome extension.

## Open Questions (Updated)
- Are `api.flaim.app/auth/*` and `auth-worker.gerrygugger.workers.dev` bound to the **same worker deployment and secrets**?
- After fixing 1042, does the sport worker successfully fetch raw credentials?

## Key Insight
The **same user** can pass the credential pre‑check (auth‑worker `GET /credentials/espn`) but fail the sport‑worker raw fetch (`GET /credentials/espn?raw=true`). That split strongly implies either **user ID mismatch** between calls or **different auth‑worker environments/credentials** being hit, not a generic ESPN credential problem.

## References
- https://developers.cloudflare.com/workers/observability/errors/ (error 1042 meaning)
- https://developers.cloudflare.com/workers/configuration/compatibility-flags/ (global_fetch_strictly_public)
- https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/ (service bindings overview)
