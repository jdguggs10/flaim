# Hono Migration Plan (Workers)

## Goal

Standardize Cloudflare Worker routing and middleware with Hono to replace manual `pathname` branching and scattered CORS/auth logic. This targets the auth-worker and the two MCP workers, which currently implement their own routing and shared behaviors independently. The aim is to improve consistency, reduce duplication, and make it easier to add endpoints and middleware (CORS, auth, logging, rate limits) across workers.【F:docs/TODO.md†L18-L23】

## Current Worker Routing (Baseline)

This section is a quick inventory of the existing endpoints and routing patterns so the Hono implementation can preserve behavior and avoid regressions.

### Auth Worker (`workers/auth-worker/src/index.ts`)

**Global behaviors**
- Strips `/auth` and `/auth-preview` prefixes for custom routes before routing logic begins.【F:workers/auth-worker/src/index.ts†L173-L184】
- Handles CORS preflight (`OPTIONS`) with a custom origin allowlist and headers.【F:workers/auth-worker/src/index.ts†L97-L144】【F:workers/auth-worker/src/index.ts†L186-L189】
- Performs auth with either Clerk JWT (primary), OAuth token (Claude/ChatGPT), or a dev-only fallback header (`X-Clerk-User-ID`).【F:workers/auth-worker/src/index.ts†L86-L169】

**Endpoints**
- `GET /health` – Supabase connectivity check and service status.【F:workers/auth-worker/src/index.ts†L193-L235】
- OAuth (Claude/ChatGPT direct access):
  - `GET /.well-known/oauth-authorization-server`【F:workers/auth-worker/src/index.ts†L246-L248】
  - `POST /register`【F:workers/auth-worker/src/index.ts†L251-L253】
  - `GET /authorize`【F:workers/auth-worker/src/index.ts†L256-L258】
  - `POST /oauth/code`【F:workers/auth-worker/src/index.ts†L261-L276】
  - `GET /oauth/status`【F:workers/auth-worker/src/index.ts†L279-L294】
  - `POST /oauth/revoke-all`【F:workers/auth-worker/src/index.ts†L297-L312】
  - `POST /oauth/revoke`【F:workers/auth-worker/src/index.ts†L315-L330】
  - `POST /token`【F:workers/auth-worker/src/index.ts†L333-L335】
  - `POST /revoke`【F:workers/auth-worker/src/index.ts†L338-L340】
- Chrome extension routes:
  - `POST /extension/sync`【F:workers/auth-worker/src/index.ts†L349-L363】
  - `GET /extension/status`【F:workers/auth-worker/src/index.ts†L366-L380】
  - `GET /extension/connection`【F:workers/auth-worker/src/index.ts†L383-L397】
  - `POST /extension/discover`【F:workers/auth-worker/src/index.ts†L400-L458】
  - `POST /extension/set-default` (route continues later in file; still within the same handler switch.)【F:workers/auth-worker/src/index.ts†L458-L566】
- Credentials:
  - `GET/POST/DELETE /credentials/espn` (includes `raw=true` and `forEdit=true` branches).【F:workers/auth-worker/src/index.ts†L568-L839】
- Leagues:
  - `GET/POST/DELETE /leagues` (delete supports query params for league removal).【F:workers/auth-worker/src/index.ts†L842-L964】
  - `POST /leagues/default`【F:workers/auth-worker/src/index.ts†L966-L1023】
  - `POST /leagues/add`【F:workers/auth-worker/src/index.ts†L1026-L1078】
  - `PATCH /leagues/:leagueId/team` (regex-based match).【F:workers/auth-worker/src/index.ts†L1081-L1169】
- `404` with endpoint list for unknown paths.【F:workers/auth-worker/src/index.ts†L1171-L1212】

### Baseball MCP Worker (`workers/baseball-espn-mcp/src/index.ts`)

**Global behaviors**
- Strips `/baseball` prefix for custom routes.【F:workers/baseball-espn-mcp/src/index.ts†L154-L159】
- Handles CORS preflight using its own allowlist and headers.【F:workers/baseball-espn-mcp/src/index.ts†L112-L151】【F:workers/baseball-espn-mcp/src/index.ts†L161-L164】
- Uses service binding (`AUTH_WORKER`) with a fallback to `AUTH_WORKER_URL` for auth-worker calls.【F:workers/baseball-espn-mcp/src/index.ts†L17-L39】

**Endpoints**
- `GET /health` (includes auth-worker connectivity check).【F:workers/baseball-espn-mcp/src/index.ts†L168-L200】
- `GET /.well-known/oauth-protected-resource` (MCP OAuth metadata).【F:workers/baseball-espn-mcp/src/index.ts†L205-L222】
- `POST /onboarding/initialize` (supports league discovery mode).【F:workers/baseball-espn-mcp/src/index.ts†L225-L352】
- `POST /onboarding/discover-seasons` (season discovery logic).【F:workers/baseball-espn-mcp/src/index.ts†L355-L572】
- `POST /mcp` and `/mcp/*` (delegates to MCP agent).【F:workers/baseball-espn-mcp/src/index.ts†L574-L578】
- `404` with endpoint list for unknown paths.【F:workers/baseball-espn-mcp/src/index.ts†L580-L593】

### Football MCP Worker (`workers/football-espn-mcp/src/index.ts`)

**Global behaviors**
- Strips `/football` prefix for custom routes.【F:workers/football-espn-mcp/src/index.ts†L151-L156】
- Handles CORS preflight with its own allowlist and headers (same shape as baseball).【F:workers/football-espn-mcp/src/index.ts†L101-L148】【F:workers/football-espn-mcp/src/index.ts†L158-L161】
- Uses service binding (`AUTH_WORKER`) with a fallback to `AUTH_WORKER_URL` for auth-worker calls.【F:workers/football-espn-mcp/src/index.ts†L16-L38】

**Endpoints**
- `GET /health` (includes auth-worker connectivity check).【F:workers/football-espn-mcp/src/index.ts†L165-L197】
- `GET /.well-known/oauth-protected-resource` (MCP OAuth metadata).【F:workers/football-espn-mcp/src/index.ts†L202-L219】
- `POST /onboarding/initialize` (multi-sport mode; defaults to football).【F:workers/football-espn-mcp/src/index.ts†L222-L362】
- `POST /onboarding/discover-seasons` (season discovery logic).【F:workers/football-espn-mcp/src/index.ts†L364-L582】
- `POST /mcp` and `/mcp/*` (delegates to MCP agent).【F:workers/football-espn-mcp/src/index.ts†L584-L588】
- `404` with endpoint list for unknown paths.【F:workers/football-espn-mcp/src/index.ts†L590-L604】

## Hono Implementation Tasks (Detailed)

### 1) Add Hono Dependencies + Shared Conventions
- Add Hono to the worker dependencies (per worker package.json or via a shared workspace dependency if you prefer). (No code changes here yet, just ensure consistent versions across workers.)
- Decide on shared middleware conventions (CORS, auth, logging, error boundaries) that will be used by all workers.

### 2) Introduce a Shared “Routing Core” Pattern
The highest leverage change is to unify route definition structure across workers. The goal is to replace manual `pathname` branching with explicit route declarations while preserving current behavior.

**Suggested structure:**
- `createRouter()` helper that sets:
  - CORS middleware
  - error handling
  - common response headers
- Worker-specific files then register routes with `app.get`, `app.post`, etc.

### 3) CORS Standardization (Cross-Worker)
Today, all workers implement similar CORS logic with their own allowlists and helpers. This should be centralized into a shared middleware to avoid drift.

**Tasks**
- Extract the CORS allowlist logic into a shared module or shared middleware factory.
- Ensure it handles preflight and `Origin` allowlist matching the same way as today (including wildcard handling and allowed headers).

**Why**: Both MCP workers and auth-worker currently reimplement the allowlist and preflight handling; Hono middleware can run before route execution consistently.【F:workers/auth-worker/src/index.ts†L97-L189】【F:workers/baseball-espn-mcp/src/index.ts†L112-L164】【F:workers/football-espn-mcp/src/index.ts†L101-L161】

### 4) Prefix Stripping (Custom Route Support)
All three workers strip a leading prefix (`/auth`, `/auth-preview`, `/baseball`, `/football`) when hosted on the custom domain.

**Tasks**
- Decide whether to keep prefix stripping in a dedicated middleware before routing, or declare all routes with the prefix and mount a sub-router.
- Keep behavior identical so custom routes continue to function.

**Why**: Current routing assumes the prefix is removed before checking path names.【F:workers/auth-worker/src/index.ts†L173-L184】【F:workers/baseball-espn-mcp/src/index.ts†L154-L159】【F:workers/football-espn-mcp/src/index.ts†L151-L156】

### 5) Auth Middleware (Auth Worker)
Auth-worker enforces Clerk JWT validation, OAuth token validation, and dev-only fallback headers. This is currently embedded in route handlers and should be pulled into explicit middleware to keep routes readable.

**Tasks**
- Create a middleware that resolves `{ userId, authType }` for routes that require auth.
- Apply it to route groups that currently call `getVerifiedUserId` and return 401s.

**Why**: Many routes perform the same auth check before continuing (OAuth, extension endpoints, leagues, credentials). Hono middleware makes this uniform and reduces errors.【F:workers/auth-worker/src/index.ts†L86-L169】【F:workers/auth-worker/src/index.ts†L261-L1169】

### 6) Route Definitions (Auth Worker)
Replace each `if (pathname === ...)` block with explicit route declarations in Hono.

**Tasks**
- Create route groups for:
  - `/health`
  - OAuth (`/.well-known/oauth-authorization-server`, `/register`, `/authorize`, `/oauth/*`, `/token`, `/revoke`)
  - Extension (`/extension/*`)
  - Credentials (`/credentials/espn`)
  - Leagues (`/leagues`, `/leagues/default`, `/leagues/add`, `/leagues/:leagueId/team`)
- Preserve query parameter behavior (`raw=true`, `forEdit=true`, `leagueId`, `sport`).

**Why**: This removes manual branching and regex matching and makes the route set easier to inspect and extend.【F:workers/auth-worker/src/index.ts†L193-L1212】

### 7) MCP Worker Route Definitions (Baseball + Football)
Introduce the same routing structure for both MCP workers.

**Tasks**
- Declare routes for:
  - `/health`
  - `/.well-known/oauth-protected-resource`
  - `/onboarding/initialize`
  - `/onboarding/discover-seasons`
  - `/mcp` (JSON-RPC entrypoint) and `/mcp/*`
- Maintain the existing `McpAgent` / `FootballMcpAgent` delegation.

**Why**: Both workers currently share the same route tree with small differences; Hono allows this to be structured similarly and reduces divergent behaviors over time.【F:workers/baseball-espn-mcp/src/index.ts†L168-L593】【F:workers/football-espn-mcp/src/index.ts†L165-L604】

### 8) Shared Auth-Worker Fetch Helper (MCP Workers)
The MCP workers use the same service-binding aware fetch logic; standardize this in a small helper module to avoid drift.

**Tasks**
- Extract `authWorkerFetch` into a shared utility in a worker-common package or a shared internal module.
- Preserve the binding-first, URL fallback behavior used today.

**Why**: Both MCP workers use nearly identical logic for bindings and fallbacks; Hono migration is a good moment to centralize it.【F:workers/baseball-espn-mcp/src/index.ts†L17-L39】【F:workers/football-espn-mcp/src/index.ts†L16-L38】

### 9) Error and 404 Handling
Each worker returns a structured 404 response with endpoint lists. With Hono, these should be handled via a global `notFound` handler.

**Tasks**
- Recreate the current 404 payloads in `app.notFound` for each worker.
- Ensure consistent JSON formatting and CORS headers in the fallback.

**Why**: The endpoint list is currently valuable for debugging; the behavior should be preserved for parity.【F:workers/auth-worker/src/index.ts†L1171-L1212】【F:workers/baseball-espn-mcp/src/index.ts†L580-L593】【F:workers/football-espn-mcp/src/index.ts†L590-L604】

### 10) Tests and Validation Checklist
This migration is route-heavy; tests should focus on regressions rather than new features.

**Tasks**
- Add/update tests that confirm:
  - CORS preflight behavior still works.
  - Auth-protected endpoints still return 401 when missing/invalid auth.
  - Prefix stripping continues to support custom routes.
  - MCP workers still reach auth-worker via service binding or URL fallback.
- Spot-check responses for key routes (health, oauth metadata, onboarding).

## Suggested Implementation Order

1. Add shared CORS + prefix-stripping middleware (keep existing behavior).
2. Migrate the baseball MCP worker routes first (smallest surface area).
3. Migrate football MCP worker (reusing the same approach).
4. Migrate auth-worker (largest surface area).
5. Add/expand test coverage to lock behavior.

## Notes

- This plan intentionally does not alter business logic. The focus is routing + middleware structure.
- Keep `McpAgent` and the MCP JSON-RPC flow intact; only the route wiring changes.
- Preserve the 404 endpoint lists because they are used for manual debugging today.
