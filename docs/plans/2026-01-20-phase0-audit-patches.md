# Phase 0 Audit Patches (2026-01-20)

Scope: verify seven previously noted findings against the current codebase and the Phase 0 plan. Each item includes status, evidence, and a minimal patch recommendation (if needed).
Note: Refuted findings are included for audit completeness and do not require changes.

---

## Patch 1: Task numbering inconsistency
Status: Refuted (plan already includes Tasks 5 and 6).

Evidence:
- `docs/plans/2025-01-19-phase0-unified-gateway.md:1172` shows "Task 5: Migrate football handlers to espn-client".
- `docs/plans/2025-01-19-phase0-unified-gateway.md:1408` shows "Task 6: Add unified MCP tools to fantasy-mcp gateway".

Recommendation: None. The plan already has those sections.

---

## Patch 2: Self-mount `app.route('/fantasy', app)` risk
Status: Plan-only (not present in current code).

Evidence:
- Plan proposes self-mount: `docs/plans/2025-01-19-phase0-unified-gateway.md:1884`.
- Current worker has only `/mcp` and `/mcp/*` routes: `workers/fantasy-mcp/src/index.ts:101-110`.

Recommendation: If you add a `/fantasy` prefix, avoid self-mounting the same app. Use a dedicated sub-app or adjust route patterns instead of `app.route('/fantasy', app)`.

---

## Patch 3: Auth service binding mismatch (`AUTH` vs `AUTH_WORKER`)
Status: Confirmed.

Evidence:
- Shared env expects `AUTH_WORKER`: `workers/shared/src/types.ts:9-13`.
- `authWorkerFetch` uses `AUTH_WORKER` binding: `workers/shared/src/auth-fetch.ts:16-38`.
- `espn-client` binding is named `AUTH`: `workers/espn-client/wrangler.jsonc:23-25`.
- `fantasy-mcp` binding is named `AUTH`: `workers/fantasy-mcp/wrangler.jsonc:29-32`.
- `espn-client` calls `authWorkerFetch`: `workers/espn-client/src/shared/auth.ts:17-20`.

Recommendation: Rename the service binding to `AUTH_WORKER` in `espn-client` and `fantasy-mcp` (and update code references), or update the shared types/helper to accept `AUTH` as the binding name. The current setup forces URL fallback and warns in prod.

---

## Patch 4: OAuth resource URL vs actual route path
Status: Confirmed.

Evidence:
- OAuth metadata points to `/fantasy/mcp`: `workers/fantasy-mcp/src/index.ts:65-68`.
- Worker handles `/mcp` and `/mcp/*` only: `workers/fantasy-mcp/src/index.ts:101-118`.
- Production route includes `/fantasy/*`: `workers/fantasy-mcp/wrangler.jsonc:22-26`.

Recommendation: Align the resource URL and route handling. Either:
1) add a `/fantasy` prefix handler (without self-mount), or
2) change the route pattern and OAuth resource to `/mcp` to match actual handlers.

---

## Patch 5: Plan instructs hitting production for auth test
Status: Confirmed.

Evidence:
- Plan uses production URL: `docs/plans/2025-01-19-phase0-unified-gateway.md:1941`.

Recommendation: Update the plan to use preview or local endpoints first to avoid accidental prod impact.

---

## Patch 6: `routeToClient` error handling and required params
Status: Refuted (already handled).

Evidence:
- Error JSON parsing is guarded: `workers/fantasy-mcp/src/router.ts:48-53`.
- Tool schemas require `platform` and `sport`: `workers/fantasy-mcp/src/mcp/tools.ts:258-266`.

Recommendation: None. The current implementation already guards non-JSON error bodies and enforces required params.

---

## Patch 7: Compatibility date / Wrangler version parity
Status: Refuted (already aligned).

Evidence:
- `compatibility_date` matches: `workers/baseball-espn-mcp/wrangler.jsonc:4`, `workers/fantasy-mcp/wrangler.jsonc:4`, `workers/espn-client/wrangler.jsonc:4`.
- `wrangler` versions match: `workers/baseball-espn-mcp/package.json:30`, `workers/fantasy-mcp/package.json:21`, `workers/espn-client/package.json:20`.

Recommendation: None. Current versions are consistent.
