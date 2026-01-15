# Worker Infrastructure Migration Plan

> **Status: GOOD FIT, LOW URGENCY** — Genuine improvements that compound across planned work. Adopt when next touching workers.

**Date**: 2026-01-15 (revised)
**Scope**: Hono routing framework + MCP SDK adoption for all workers (using Cloudflare `createMcpHandler`)

---

## Executive Summary

This plan combines two infrastructure improvements into a single migration path:

1. **Hono** — Replace manual `if (pathname === ...)` routing with a lightweight framework
2. **MCP SDK** — Replace manual JSON-RPC protocol handling with the official SDK

**Why together?** Hono provides the request lifecycle control needed to preserve your custom OAuth flow while adopting the SDK, while Cloudflare’s `createMcpHandler` provides a Workers-native Streamable HTTP transport (no Node shims). The Hono + `createMcpHandler` pattern keeps your auth logic in front of the SDK and stays on web standards.

**Recommended approach:** Hono first (lower risk), then MCP SDK via `createMcpHandler` (official Workers path).

**Net result:** ~400 lines removed, cleaner code, easier testing, and a template for future workers.

---

## What These Technologies Are

### Hono

[Hono](https://hono.dev/) is a lightweight web framework built on Web Standards, optimized for edge runtimes. It's the [fastest router for Cloudflare Workers](https://hono.dev/docs/concepts/benchmarks) (402k ops/sec) and is widely used in edge projects.

**What it replaces:** Manual `if (pathname === ...)` routing, duplicated CORS handling, scattered middleware logic.

### MCP SDK + Cloudflare `createMcpHandler`

The [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) (v1.x line) is the official TypeScript implementation of the Model Context Protocol. It provides:

- JSON-RPC 2.0 protocol handling
- Zod-based tool registration with runtime validation
- Automatic spec compliance
- Transport implementations for various environments

On Cloudflare Workers, the recommended way to serve Streamable HTTP is `createMcpHandler` from the Agents SDK (`agents/mcp`). It uses a web‑standards Worker transport (no Node compatibility flags needed) and is positioned as the lightweight alternative to `McpAgent` when SSE is not required. This aligns with the MCP spec’s move to Streamable HTTP as the primary remote transport.  

**What it replaces:** Manual JSON-RPC parsing, tool definition objects, response formatting helpers.  
**What it avoids:** `fetch-to-node` shims and `nodejs_compat` flags.

---

## Current State

### Worker Inventory

| Worker | Lines | Routes | MCP Agent Lines | Pattern |
|--------|-------|--------|-----------------|---------|
| auth-worker | 1,197 | 19 | — | `if (pathname === ...)` |
| baseball-mcp | 794 | 5 | 1,216 | `if (pathname === ...)` |
| football-mcp | 791 | 5 | 1,023 | `if (pathname === ...)` |

**Total:** 29 routes across 3 workers, 2,239 lines in MCP agents alone.

### What's Duplicated Today

| Code | Where | Lines Each |
|------|-------|------------|
| CORS allowlist + preflight handling | All 3 workers | ~35 |
| Prefix stripping (`/auth`, `/baseball`, `/football`) | All 3 workers | ~12 |
| `authWorkerFetch()` service binding helper | Both MCP workers | ~23 |
| JSON-RPC types & parsing | Both MCP agents | ~100 |
| Tool definitions as objects | Both MCP agents | ~140 |
| Response formatting helpers | Both MCP agents | ~25 |

---

## The Recommended Path

### Single Approach: Hono + MCP SDK via Cloudflare `createMcpHandler`

After evaluating multiple options, the **Hono + `createMcpHandler` + Streamable HTTP** pattern is recommended because:

| Factor | Assessment |
|--------|------------|
| **Workers‑native** | Cloudflare’s official path for Streamable HTTP MCP servers |
| **Full request lifecycle control** | Your custom 401 with `_meta["mcp/www_authenticate"]` works naturally |
| **No Node shims** | Avoids `fetch-to-node` and `nodejs_compat` flags |
| **No Durable Objects needed** | Standard Worker billing, no state management complexity |
| **Aligns with roadmap** | Future workers (hockey, basketball, Yahoo, Sleeper) use same template |
| **Testing benefits** | Hono's `app.request()` enables clean unit tests |

### Why NOT Other Approaches

| Approach | Issue |
|----------|-------|
| **McpAgent with Durable Objects** | [Timeout issues](https://github.com/cloudflare/agents/issues/640), different billing model, unnecessary complexity |
| **Minimal SDK-only (no Hono)** | Misses routing cleanup benefits; harder to test; doesn't help future workers |
| **fetch-to-node bridge** | Requires Node compatibility flags and adds shims that are not needed with `createMcpHandler` |

---

## Why This Sequence

### Phase 1: Hono First

Hono migration is **lower risk** because:
- It's routing changes, not protocol changes
- Each route can be migrated incrementally
- Behavior is directly testable with `app.request()`
- Rollback is straightforward (just restore the old handler)

### Phase 2: MCP SDK After

MCP SDK adoption **builds on Hono** because:
- `createMcpHandler` can be wrapped cleanly in a Hono route
- Custom auth middleware runs *before* SDK handles the request
- You can test MCP behavior in isolation

---

## Detailed Implementation Plan

### Phase 1: Shared Infrastructure (Foundation)

**Goal:** Extract duplicated code, establish shared patterns.

```
workers/
  shared/
    cors.ts           # Unified CORS middleware
    prefix-strip.ts   # Prefix stripping middleware
    auth-fetch.ts     # authWorkerFetch() helper
    types.ts          # Shared interfaces
```

**Tasks:**
1. Create `workers/shared/` package
2. Extract CORS allowlist logic into shared middleware factory
3. Extract `authWorkerFetch()` into shared module
4. Add shared TypeScript interfaces

**Risk:** Low
**Lines affected:** ~100 extracted into shared module

### Phase 2: Baseball MCP → Hono (Smallest First)

**Goal:** Prove the Hono migration pattern on the simplest worker.

**Before:**
```typescript
if (pathname === '/health') { ... }
if (pathname === '/.well-known/oauth-protected-resource') { ... }
if (pathname === '/onboarding/initialize') { ... }
if (pathname.startsWith('/mcp')) { ... }
```

**After:**
```typescript
const app = new Hono<{ Bindings: Env }>();

app.use('*', corsMiddleware);
app.use('*', prefixStripMiddleware('/baseball'));

app.get('/health', healthHandler);
app.get('/.well-known/oauth-protected-resource', oauthMetadataHandler);
app.post('/onboarding/initialize', onboardingHandler);
app.post('/onboarding/discover-seasons', discoverSeasonsHandler);
app.all('/mcp', mcpHandler);   // Still delegates to existing MCP handler for now
app.all('/mcp/*', mcpHandler);

app.notFound(notFoundHandler);

export default app;
```

**Tasks:**
1. Add `hono` dependency to baseball-mcp
2. Create Hono app with existing route handlers
3. Apply shared CORS middleware
4. Apply prefix-stripping middleware
5. Test all routes manually + add `app.request()` tests
6. Deploy to preview, verify parity

**Risk:** Low-Medium
**Rollback:** Revert to previous `index.ts`

### Phase 3: Baseball MCP → MCP SDK

**Goal:** Replace manual JSON-RPC handling with SDK.

**The Pattern (Workers-native, no Node shims):**
```typescript
import { Hono } from 'hono';
import { createMcpHandler } from 'agents/mcp';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const app = new Hono<{ Bindings: Env }>();

// Factory function to register tools with env captured via closure
function registerBaseballTools(server: McpServer, env: Env, getAuthHeader: () => string | null) {
  server.registerTool('get_user_session', {
    title: 'User Session',
    description: 'Get user session and configured leagues',
    inputSchema: {}
  }, async (args, extra) => {
    // env and authHeader captured in closure - available at runtime
    const authHeader = getAuthHeader();
    const leagues = await fetchUserLeagues(env, authHeader);
    return { content: [{ type: 'text', text: JSON.stringify(leagues) }] };
  });

  // ... register other tools with same pattern ...
}

app.all('/mcp', async (c) => {
  // YOUR CUSTOM AUTH - runs BEFORE SDK
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    // Your existing 401 with _meta["mcp/www_authenticate"]
    return c.json({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Authentication required',
        _meta: {
          'mcp/www_authenticate': [
            'Bearer resource_metadata="https://api.flaim.app/baseball/.well-known/oauth-protected-resource"'
          ]
        }
      },
      id: null
    }, 401, {
      'WWW-Authenticate': 'Bearer resource_metadata="https://api.flaim.app/baseball/.well-known/oauth-protected-resource"'
    });
  }

  // Create server and register tools with env captured per-request
  const server = new McpServer({ name: 'fantasy-baseball-mcp', version: '4.0.0' });
  registerBaseballTools(server, c.env, () => authHeader);

  // SDK handles the rest (Workers-native transport)
  const handler = createMcpHandler(server, { route: '/mcp' });
  return handler(c.req.raw, c.env, c.executionCtx);
});
```

**Key insight:** Your custom 401 with `_meta["mcp/www_authenticate"]` runs *before* the SDK processes the request. This preserves ChatGPT OAuth compatibility.

**Tasks:**
1. Add dependencies: `@modelcontextprotocol/sdk`, `zod`, `agents`
2. Convert tool definitions from objects to `registerTool()` with Zod
3. Extract tool business logic into handler functions
4. Wire up `createMcpHandler` on a route that accepts GET/POST (and DELETE if you support session termination)
5. Add tool annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`, `title`)
6. Add thin `search` and `fetch` tools (read‑only wrappers) for OpenAI deep‑research compatibility
7. Test with Claude Desktop or MCP Inspector
8. Test ChatGPT OAuth flow specifically

**Risk:** Medium
**Rollback:** Revert to Hono-only (existing MCP handler still works)

### Phase 4: Football MCP (Replicate)

**Goal:** Apply the same pattern to football worker.

Since football-mcp has nearly identical structure, this is mostly copy-paste:

1. Apply same Hono structure
2. Register football-specific tools with SDK
3. Reuse shared middleware and auth-fetch helper
4. Test parity

**Risk:** Low (pattern proven)

### Phase 5: Auth-Worker → Hono (Largest)

**Goal:** Migrate the most complex worker last, with lessons learned.

**Current auth-worker routes:**
- `/health`
- OAuth: `/.well-known/oauth-authorization-server`, `/register`, `/authorize`, `/oauth/*`, `/token`, `/revoke`
- Extension: `/extension/sync`, `/extension/status`, `/extension/connection`, `/extension/discover`, `/extension/set-default`
- Credentials: `/credentials/espn`
- Leagues: `/leagues`, `/leagues/default`, `/leagues/add`, `/leagues/:leagueId/team`

**Hono benefits here:**
```typescript
// Auth middleware applied to route groups
app.use('/extension/*', clerkAuthMiddleware);
app.use('/credentials/*', clerkAuthMiddleware);
app.use('/leagues/*', clerkAuthMiddleware);

// OAuth routes (no auth required)
app.get('/.well-known/oauth-authorization-server', oauthMetadataHandler);
app.post('/register', registerHandler);
// ...

// Route params work naturally
app.patch('/leagues/:leagueId/team', updateTeamHandler);
```

**Risk:** Medium (most routes, most auth logic)
**Rollback:** Revert to previous `index.ts`

### Phase 6: Tests and Hardening

**Goal:** Lock behavior with automated tests.

```typescript
// Clean testing with Hono's app.request()
describe('baseball-mcp', () => {
  it('returns 401 without auth header', async () => {
    const res = await app.request('/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 })
    }, mockEnv);

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error._meta['mcp/www_authenticate']).toBeDefined();
  });

  it('lists tools with valid auth', async () => {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer valid-token' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 })
    }, mockEnv);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.tools).toHaveLength(8);
  });
});
```

**Test priorities:**
1. CORS preflight behavior
2. Auth-protected endpoints return 401 without auth
3. Custom 401 with `_meta` for ChatGPT OAuth
4. MCP tools/list and tools/call work correctly
5. Service binding fallback to URL works

---

## Accessing Environment in Tool Handlers

**Critical gap:** The MCP SDK's `registerTool()` gives you `(args, extra)`, but `env` is not automatically available in `extra`.

**Solution:** Use closure capture when registering tools — see the main code example in Phase 3 above. The key pattern:

1. Create a factory function that accepts `env` and any request-scoped values
2. Register tools inside that factory, capturing values via closure
3. Call the factory per-request in your Hono handler

This ensures each request has access to its own `env` and `authHeader` without global state.

---

## Realistic Code Estimates

### What Gets Replaced

| Component | Lines | Replaceable? |
|-----------|-------|--------------|
| JSON-RPC types & parsing | ~80 | Yes |
| `handleInitialize`, `handleToolsList` | ~20 | Yes |
| `jsonRpcSuccess`/`jsonRpcError` helpers | ~25 | Yes |
| Tool definitions as objects | ~140 | Yes → Zod |
| `handleToolsCall` routing | ~80 | Yes |
| **Total replaceable per agent** | **~345** | |
| `executeTool` business logic | ~300 | No (moves to handlers) |
| `authWorkerFetch`, logging, utils | ~150 | No (stays) |
| ESPN API implementations | ~400+ | No (unchanged) |

### Net Change

| Phase | Lines Removed | Lines Added | Net |
|-------|---------------|-------------|-----|
| Phase 1: Shared infrastructure | ~100 (duplicates) | ~80 (shared module) | **-20** |
| Phase 2: Baseball Hono | ~50 (routing) | ~40 (Hono routes) | **-10** |
| Phase 3: Baseball SDK | ~345 (protocol) | ~150 (SDK setup + Zod) | **-195** |
| Phase 4: Football SDK | ~280 (protocol) | ~120 (SDK setup + Zod) | **-160** |
| Phase 5: Auth-worker Hono | ~60 (routing) | ~50 (Hono routes) | **-10** |
| **Total** | **~835** | **~440** | **~-395** |

**Realistic net reduction: ~400 lines** (not 600-800 as previously claimed).

---

## Risks and Mitigations

### Risk 1: Custom OAuth Compatibility

**Risk:** ChatGPT's OAuth flow requires `_meta["mcp/www_authenticate"]` in the 401 response. The SDK might not preserve this.

**Mitigation:** The Hono pattern runs your auth check *before* the SDK processes the request. You return your custom 401 directly, bypassing the SDK entirely for unauthorized requests.

**Verification:** Test specifically with ChatGPT after migration.

### Risk 2: Service Binding Access

**Risk:** Tool handlers need `env.AUTH_WORKER` for service binding calls.

**Mitigation:** Use closure capture (documented above) to make `env` available in tool handlers.

### Risk 3: Streamable HTTP Requirements

**Risk:** Streamable HTTP requires Origin validation and support for GET + POST (and DELETE when using sessions). Missing these can break client compatibility or violate spec guidance.

**Mitigation:**
- Ensure CORS middleware validates `Origin` against your allowlist
- Route `/mcp` with GET + POST (and DELETE if supporting session termination)
- Test with Claude + ChatGPT after migration

### Risk 4: OpenAI Tooling Requirements Divergence

**Risk:** OpenAI’s documentation is inconsistent: developer‑mode connectors do not require `search`/`fetch`, but deep‑research connectors still do, and troubleshooting guidance treats missing required tools as a failure.

**Mitigation:**
- Add thin, read‑only `search` and `fetch` tools that map to existing ESPN data
- Keep tool names and schemas stable to avoid resubmission churn
- Verify behavior in both developer‑mode connectors and deep‑research flows

### Risk 5: Zod Version Compatibility

**Risk:** Older MCP SDK versions (< 1.23.0) had Zod v4 incompatibilities.

**Mitigation:**
- SDK v1.23.0+ supports both Zod v4 and Zod v3.25+ (backward compatible)
- **Recommended:** Use Zod v4 for new work — it's the direction the ecosystem is heading
- If using Zod v3, ensure v3.25+ (older v3 versions are not supported)
- Keep the SDK pinned to >= 1.25.2 for security fixes

### Risk 6: Auth-Worker Complexity

**Risk:** Auth-worker has the most routes and complex auth logic. Migration has highest risk of regressions.

**Mitigation:**
- Migrate auth-worker **last** after proving pattern on MCP workers
- More test coverage for auth flows
- Can keep auth-worker unchanged if MCP workers prove sufficient value

---

## Client Compatibility Notes (Jan 2026)

### Claude (Connectors Directory)

- **Streamable HTTP must be supported**; SSE is optional for legacy clients.  
- **Tool annotations are mandatory**: `readOnlyHint` or `destructiveHint` on every tool, plus `title`.  
- **Tool name rules**: `^[a-zA-Z0-9_-]{1,64}$` (max 64 chars, no spaces/dots).  
- **Auth requirement**: If you require auth, use OAuth 2.0 with user consent; pure client‑credentials is not supported.  
- **Operational requirements**: GA (not beta), reliable, CORS configured for browser clients, token‑efficient responses (max 25k tokens per tool result), and 5‑minute timeout constraints for Claude.ai/Desktop.  
- **Submission requirements**: privacy policy link, contact/support info, test account with sample data, and example prompts/use cases.
- **Policy highlights**: tool descriptions must be narrow and accurate; tools must not coerce Claude to call other tools/servers; collect only necessary user data and follow usage policies.

### OpenAI (ChatGPT Custom Connectors / Apps)

- **Transport**: Streamable HTTP is recommended; Apps SDK supports both Streamable HTTP and SSE. Local servers are not supported for ChatGPT connectors.  
- **Tooling requirements differ by surface**:
  - **Developer mode**: `search`/`fetch` are **not required**; all tools can be used.  
  - **Deep research (via API)**: Requires `search` + `fetch`; MCP servers must be configured with `require_approval: "never"`.  
  - **Recommendation**: Implement `search` and `fetch` wrappers now (read‑only, thin), so you can support both developer‑mode connectors and deep‑research flows.
- **Deep research**: Only read/fetch actions are used; write actions may be ignored.  
- **Company knowledge**: Only connectors with `search`/`fetch` are included.  
- **Apps directory submission**: MCP server must be publicly accessible (not local/testing), and app submission requires a CSP that allows the exact domains you fetch from. Tool definitions are snapshotted at approval; updates require admin review and re‑enablement of changed actions.

### OpenAI `search`/`fetch` Wrapper Schema (Recommended)

Implement **thin, read‑only wrappers** that map to existing ESPN data. The OpenAI MCP docs use the following schemas and require returning JSON‑encoded strings in a single `content` item:

```ts
// search
input: { query: string }
output: { results: Array<{ id: string; title: string; url: string }> }

// fetch
input: { id: string }
output: { id: string; title: string; text: string; url: string; metadata?: Record<string, any> }
```

Return the output as a single MCP `content` item of type `"text"` containing JSON (stringified).

### Appendix: `search`/`fetch` Example Outputs (Non‑Binding)

**Example `search` response (top N results, short titles):**
```json
{
  "results": [
    {
      "id": "ffl:12345:2025:team:7",
      "title": "League 12345 — Team 7 roster (2025)",
      "url": "https://flaim.app/leagues/ffl/12345?season=2025"
    }
  ]
}
```

**Example `fetch` response (truncate text to keep token budget):**
```json
{
  "id": "ffl:12345:2025:team:7",
  "title": "League 12345 — Team 7 roster (2025)",
  "text": "Roster summary… (truncated)",
  "url": "https://flaim.app/leagues/ffl/12345?season=2025",
  "metadata": { "sport": "ffl", "leagueId": "12345", "season": 2025, "teamId": 7 }
}
```

**Token budget guideline:** cap `search` results to a small N (e.g., 5–10) and truncate `fetch.text` to stay well under Claude’s 25k‑token ceiling.

---

## Directory Alignment Checklist (Future Submission)

### Claude Directory
- All tools include **readOnlyHint / destructiveHint** and **title** annotations.
- Tool names <= 64 chars; clear, unambiguous descriptions.
- OAuth 2.0 authorization code flow (no pure client‑credentials), valid TLS certs, allowlist Claude callback URLs.
- CORS allowlist includes all Claude client origins.
- Token‑efficient responses (<= 25k tokens) and 5‑minute max tool time.
- Documentation includes privacy policy, support channel, test account with sample data, and 3+ usage examples.

### OpenAI Apps Directory
- Public MCP server URL (no local/testing endpoints).
- Streamable HTTP endpoint supports GET + POST and validates `Origin`.
- CSP defined for exact fetch domains used by tools.
- Tool metadata is stable; changes require admin review and re‑enablement after approval.
- Tool annotations are complete: readOnlyHint / destructiveHint / openWorldHint.
- Provide a demo account with sample data for review if auth is required.
- Implement `search`/`fetch` for deep‑research and company knowledge compatibility.

## Platform Compatibility Notes (Clerk / Supabase / Vercel)

- **Clerk**: Session token JWT v2 is now the default; v1 is deprecated. Standardize on Clerk’s SDK verification helpers everywhere (avoid manual JWT parsing).
- **Supabase**: Legacy `anon` / `service_role` keys still work, but new projects now use `sb_publishable_` and `sb_secret_` keys. Plan a low‑risk migration once key rotation support is fully GA.
- **Vercel**: Node.js 18 is deprecated for builds/functions; ensure the root `package.json` `engines` field targets Node 20+ to avoid deployment failures on new builds.

### Clerk JWT v2 Readiness Checklist

- Validate JWTs using Clerk’s SDK (`authenticateRequest`) everywhere.
- Avoid relying on undocumented claims; prefer `sub`, `iss`, `aud`, `exp`, and Clerk‑documented fields only.

### Clerk SDK Usage Pattern (Auth Worker)

**Goal:** Standardize all JWT verification via Clerk's SDK (no manual parsing).

Pseudocode (follow Clerk docs for exact API shape):
```ts
import { createClerkClient } from '@clerk/backend';

const clerkClient = createClerkClient({
  secretKey: env.CLERK_SECRET_KEY,
  publishableKey: env.CLERK_PUBLISHABLE_KEY,
});

const auth = await clerkClient.authenticateRequest(req, {
  authorizedParties: ['https://api.flaim.app', 'https://flaim.app'],
});
if (!auth.isAuthenticated) return unauthorizedResponse(auth.reason);

const userId = auth.sessionClaims?.sub;
// Use userId for storage isolation and rate limiting
```

**Notes:**
- Call once per request at the edge of your handler/middleware.
- Fail closed (401) if verification fails.
- **Always set `authorizedParties`** — omitting it opens CSRF vulnerabilities per Clerk docs.
- Keep claim usage minimal (`sub` only unless you explicitly need org data).

**Recommended package/version:**
- Use `@clerk/backend` (built for Node.js/V8 isolates like Cloudflare Workers).
- Target the latest v2.x line (>= 2.21.0) to align with Clerk’s latest API version compatibility guidance.

---

## Dependencies

```json
{
    "dependencies": {
      "hono": "^4.x",
      "@modelcontextprotocol/sdk": "^1.25.2",
      "@clerk/backend": "^2.21.0",
      "agents": "^0.x",
      "zod": "^4.0.0"
    }
  }
```

**Notes:**
- SDK >= 1.25.2 required for ReDoS security fix (CVE-2026-0621).
- SDK v1.23.0+ supports Zod v4 with backward compatibility for v3.25+. Zod v4 recommended for new work.
- `@clerk/backend` v2.21.0+ aligns with Clerk's latest API version compatibility guidance.

---

## Roadmap Alignment

| Planned Work (from TODO.md) | Impact |
|-----------------------------|--------|
| **Standardize Worker Routing** | This IS the Hono migration |
| **Adopt Official MCP SDK** | This IS the SDK migration |
| **Automated Testing** | Hono's `app.request()` enables it |
| **Add hockey/basketball workers** | Copy the Hono+SDK template |
| **Expand to Yahoo/Sleeper** | Consistent patterns across platforms |
| **Harden OAuth** | Middleware isolates auth logic for testing |

---

## Phased Implementation Plan

> **Philosophy:** Each phase ends with a deployable, working state. Production is never broken. Each checkpoint has clear go/no-go criteria. Rollback is always one `git revert` away.

### Phase 0: Pre-Migration Setup

**Goal:** Establish baseline and testing infrastructure.

**Tasks:**
- [ ] Create feature branch: `git checkout -b feat/hono-mcp-sdk-migration`
- [ ] Document current behavior baseline (capture actual responses from each endpoint)
- [ ] Set up local test script for manual verification
- [ ] Ensure preview environment is working: `wrangler deploy --env preview`

**Checkpoint 0:** Baseline documented, preview deploys working.

**Go/No-Go:** Can deploy to preview without errors? Baseline captured? → Proceed.

---

### Phase 1: Shared Infrastructure

**Goal:** Extract duplicated code without changing behavior.

**Tasks:**
- [ ] Create `workers/shared/` directory structure
- [ ] Extract CORS middleware factory → `workers/shared/cors.ts`
- [ ] Extract prefix-stripping middleware → `workers/shared/prefix-strip.ts`
- [ ] Extract `authWorkerFetch()` helper → `workers/shared/auth-fetch.ts`
- [ ] Add shared TypeScript interfaces → `workers/shared/types.ts`
- [ ] **Do NOT change any worker yet** — just create the shared module

**Checkpoint 1:** Shared module exists, compiles, exports work.

**Verification:**
```bash
cd workers/shared && npm run build  # or tsc --noEmit
```

**Go/No-Go:** Shared module compiles? All exports typed correctly? → Proceed.

**Rollback:** Delete `workers/shared/` directory.

---

### Phase 2A: Baseball MCP → Hono (Local Only)

**Goal:** Migrate baseball-mcp routing to Hono, verify locally.

**Tasks:**
- [ ] Add `hono` dependency to `workers/baseball-espn-mcp`
- [ ] Create new `src/index-hono.ts` (keep original `index.ts` intact)
- [ ] Implement Hono app with all existing routes
- [ ] Import and use shared CORS/prefix middleware
- [ ] Wire existing handlers to Hono routes
- [ ] Keep existing MCP agent code unchanged (delegate `/mcp` to it)

**Checkpoint 2A:** Local parity verified.

**Verification (local):**
```bash
# Terminal 1: Run the worker locally
cd workers/baseball-espn-mcp && wrangler dev --env dev --port 8787

# Terminal 2: Test endpoints
curl http://localhost:8787/baseball/health
curl -X OPTIONS http://localhost:8787/baseball/mcp -H "Origin: https://flaim.app"
curl http://localhost:8787/baseball/.well-known/oauth-protected-resource
```

**Go/No-Go Checklist:**
- [ ] `/health` returns 200 with expected JSON
- [ ] CORS preflight returns correct headers
- [ ] `/.well-known/oauth-protected-resource` returns metadata
- [ ] `/mcp` without auth returns 401 with `_meta["mcp/www_authenticate"]`
- [ ] All responses match baseline from Phase 0

**Rollback:** Revert to original `index.ts` (it's still there).

---

### Phase 2B: Baseball MCP → Hono (Preview Deploy)

**Goal:** Deploy Hono version to preview, verify in real environment.

**Tasks:**
- [ ] Update `wrangler.toml` to use new Hono entrypoint
- [ ] Deploy to preview: `wrangler deploy --env preview`
- [ ] Run verification against preview URL

**Checkpoint 2B:** Preview deployment works, parity verified.

**Verification (preview):**
```bash
PREVIEW_URL="https://baseball-espn-mcp.preview.workers.dev"
curl $PREVIEW_URL/baseball/health
curl -X OPTIONS $PREVIEW_URL/baseball/mcp -H "Origin: https://flaim.app"
# Test with real auth token if available
```

**Go/No-Go Checklist:**
- [ ] All endpoints return expected responses
- [ ] CORS works from browser (test in DevTools)
- [ ] No errors in Cloudflare dashboard logs

**Rollback:** `git revert` the wrangler.toml change, redeploy.

---

### Phase 2C: Baseball MCP → Hono (Production)

**Goal:** Ship Hono routing to production.

**Tasks:**
- [ ] Deploy to production: `wrangler deploy --env production`
- [ ] Monitor Cloudflare dashboard for errors (15 min)
- [ ] Test with real clients (extension, ChatGPT if possible)

**Checkpoint 2C:** Production running Hono, no regressions.

**Verification (production):**
```bash
PROD_URL="https://api.flaim.app"
curl $PROD_URL/baseball/health
# Test actual OAuth flow with ChatGPT or extension
```

**Go/No-Go Checklist:**
- [ ] Health endpoint works
- [ ] Extension can connect and fetch data
- [ ] No elevated error rate in dashboard (compare to baseline)
- [ ] **Wait 24-48 hours** before proceeding to Phase 3

**Rollback:** `git revert`, redeploy original `index.ts`.

---

### Phase 3A: Baseball MCP → SDK (Local Only)

**Goal:** Replace manual JSON-RPC with MCP SDK, verify locally.

**Tasks:**
- [ ] Add dependencies: `@modelcontextprotocol/sdk@^1.25.2`, `zod@^4.0.0`, `agents`
- [ ] Create `src/mcp/sdk-agent.ts` with SDK-based tool registration
- [ ] Implement closure capture pattern for env access
- [ ] Convert all 8 tool definitions to `registerTool()` with Zod schemas
- [ ] Add tool annotations (`readOnlyHint`, `title`, etc.)
- [ ] Wire `createMcpHandler` into Hono `/mcp` route
- [ ] Keep old `mcp/agent.ts` intact for comparison

**Checkpoint 3A:** SDK-based MCP works locally.

**Verification (local):**
```bash
# Test MCP protocol directly
curl -X POST http://localhost:8787/baseball/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test"}},"id":1}'

# Should return 401 with _meta (no auth)
# With auth, should return initialize result

# Test tools/list
curl -X POST http://localhost:8787/baseball/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <valid-token>" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":2}'
```

**Go/No-Go Checklist:**
- [ ] `initialize` response matches MCP spec
- [ ] `tools/list` returns all 8 tools with correct schemas
- [ ] Unauthorized requests return 401 with `_meta["mcp/www_authenticate"]`
- [ ] Tool annotations present in response

**Rollback:** Revert to Hono-only (old MCP agent still works).

---

### Phase 3B: Baseball MCP → SDK (Client Testing)

**Goal:** Verify with real MCP clients before production.

**Tasks:**
- [ ] Deploy to preview
- [ ] Test with MCP Inspector
- [ ] Test with Claude Desktop (local config pointing to preview)
- [ ] Test ChatGPT OAuth flow (if possible with preview URL)

**Checkpoint 3B:** Real clients work with SDK implementation.

**Verification (clients):**
```bash
# MCP Inspector
npx @anthropics/mcp-inspector --url https://baseball-espn-mcp.preview.workers.dev/baseball/mcp

# Claude Desktop - add to claude_desktop_config.json:
# "baseball-preview": { "url": "https://...", "transport": "streamable-http" }
```

**Go/No-Go Checklist:**
- [ ] MCP Inspector: connect → tools/list → call one tool successfully
- [ ] Claude Desktop: can connect and list tools
- [ ] ChatGPT: OAuth flow completes (if testable)
- [ ] No protocol errors in any client

**Rollback:** Revert to Hono-only, redeploy.

---

### Phase 3C: Baseball MCP → SDK (Production)

**Goal:** Ship SDK-based MCP to production.

**Tasks:**
- [ ] Deploy to production
- [ ] Monitor for 24-48 hours
- [ ] Verify with production clients

**Checkpoint 3C:** Production running SDK, no regressions.

**Go/No-Go Checklist:**
- [ ] Extension works normally
- [ ] ChatGPT integration works (if in use)
- [ ] Error rate unchanged from baseline
- [ ] **Wait 24-48 hours** before proceeding to Phase 4

**Rollback:** Revert SDK changes, keep Hono routing.

---

### Phase 4: Football MCP (Replicate Pattern)

**Goal:** Apply same Hono + SDK pattern to football worker.

**Tasks:**
- [ ] Copy Hono structure from baseball-mcp
- [ ] Adapt for football-specific routes and tools
- [ ] Register all 5 football tools with SDK
- [ ] Reuse shared middleware

**Checkpoints:** Same 3-stage process (Local → Preview → Production)

**Go/No-Go:** Same criteria as baseball phases.

**Note:** This phase should be faster — pattern is proven.

---

### Phase 5: Auth-Worker → Hono (Optional)

**Goal:** Migrate auth-worker routing to Hono.

> **Decision point:** After Phases 2-4, evaluate if auth-worker migration is worth it. The MCP workers benefit most from this migration. Auth-worker has more routes but no MCP protocol complexity.

**Tasks (if proceeding):**
- [ ] Add `hono` dependency
- [ ] Create Hono app with all 19 routes
- [ ] Apply auth middleware to route groups (`/extension/*`, `/credentials/*`, `/leagues/*`)
- [ ] Use Clerk SDK for JWT verification
- [ ] Same 3-stage deployment process

**Checkpoint 5:** Auth-worker on Hono, all flows work.

**Go/No-Go:**
- [ ] All OAuth endpoints work
- [ ] Extension sync/status/connection work
- [ ] League management works
- [ ] No auth regressions

---

### Phase 6: Hardening & Tests

**Goal:** Lock behavior with automated tests, clean up.

**Tasks:**
- [ ] Add unit tests using Hono's `app.request()`
- [ ] Add integration tests for OAuth flow
- [ ] Remove old `mcp/agent.ts` files (after production stability confirmed)
- [ ] Update documentation
- [ ] Clean up any temporary/duplicate code

**Test Coverage Targets:**
```typescript
// Priority test cases
describe('baseball-mcp', () => {
  it('returns 401 with _meta for unauthorized requests');
  it('handles CORS preflight correctly');
  it('lists all tools with correct annotations');
  it('executes get_user_session tool');
  it('handles invalid JSON-RPC requests gracefully');
});
```

**Checkpoint 6:** Test suite passing, old code removed.

---

## Checkpoint Summary

| Phase | Checkpoint | Go/No-Go Criteria | Rollback |
|-------|------------|-------------------|----------|
| 0 | Baseline | Preview deploys, baseline captured | N/A |
| 1 | Shared module | Compiles, exports typed | Delete directory |
| 2A | Baseball Hono (local) | All endpoints match baseline | Use original index.ts |
| 2B | Baseball Hono (preview) | Preview works, CORS works | Revert wrangler.toml |
| 2C | Baseball Hono (prod) | 24-48h stable, no errors | git revert, redeploy |
| 3A | Baseball SDK (local) | MCP protocol works, tools list | Revert to Hono-only |
| 3B | Baseball SDK (clients) | Claude/ChatGPT connect | Revert to Hono-only |
| 3C | Baseball SDK (prod) | 24-48h stable | Revert SDK changes |
| 4 | Football SDK | Same as baseball | Same as baseball |
| 5 | Auth-worker (optional) | All auth flows work | Revert to original |
| 6 | Tests | Suite passing | N/A |

---

## Rollback Procedures

### Quick Rollback (Any Phase)
```bash
# Identify the last good commit
git log --oneline -10

# Revert to it
git revert <commit-hash>

# Redeploy
wrangler deploy --env production
```

### Emergency Rollback
If production is broken and you need to act fast:
```bash
# Option 1: Revert last deploy via Cloudflare dashboard
# Workers → baseball-espn-mcp → Deployments → Roll back

# Option 2: Deploy previous version from git
git checkout HEAD~1 -- workers/baseball-espn-mcp/src/index.ts
wrangler deploy --env production
git checkout HEAD -- workers/baseball-espn-mcp/src/index.ts  # restore working copy
```

### Partial Rollback
If only SDK is problematic but Hono is fine:
```bash
# Keep Hono routing, revert only SDK changes
git revert <sdk-commit>  # keeps Hono changes
wrangler deploy --env production
```

---

## Verification Scripts

Save these for quick testing at each checkpoint:

```bash
#!/bin/bash
# verify-baseball.sh

BASE_URL="${1:-http://localhost:8787}"

echo "Testing $BASE_URL..."

echo -n "Health: "
curl -s "$BASE_URL/baseball/health" | jq -r '.status // "FAIL"'

echo -n "CORS preflight: "
curl -s -X OPTIONS "$BASE_URL/baseball/mcp" \
  -H "Origin: https://flaim.app" \
  -H "Access-Control-Request-Method: POST" \
  -o /dev/null -w "%{http_code}\n"

echo -n "OAuth metadata: "
curl -s "$BASE_URL/baseball/.well-known/oauth-protected-resource" | jq -r '.resource // "FAIL"'

echo -n "MCP 401 check: "
curl -s -X POST "$BASE_URL/baseball/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1}' | jq -r '.error.code // "FAIL"'

echo "Done."
```

Usage:
```bash
chmod +x verify-baseball.sh
./verify-baseball.sh                                    # local
./verify-baseball.sh https://baseball-espn-mcp.preview.workers.dev  # preview
./verify-baseball.sh https://api.flaim.app              # production
```

---

## Resources

### Hono
- [Hono Documentation](https://hono.dev/)
- [Cloudflare Workers Guide](https://hono.dev/docs/getting-started/cloudflare-workers)
- [Testing Guide](https://hono.dev/docs/guides/testing)
- [Cloudflare Vitest Integration](https://hono.dev/examples/cloudflare-vitest)

### MCP SDK
- [TypeScript SDK Repository](https://github.com/modelcontextprotocol/typescript-sdk)
- [npm Package](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- [Server Documentation](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md)

### Cloudflare MCP Handler
- [createMcpHandler — API Reference](https://developers.cloudflare.com/agents/model-context-protocol/mcp-handler-api/)
- [Transport — Streamable HTTP (recommended)](https://developers.cloudflare.com/agents/model-context-protocol/transport/)
- [Agents SDK package (`agents`)](https://developers.cloudflare.com/changelog/2025-02-25-agents-sdk/)

### MCP Protocol
- [MCP Transports (Streamable HTTP)](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [MCP Authorization Spec (RFC 9728)](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)

### Zod Compatibility
- [Zod 4 stable announcement (library authors)](https://zod.dev/library-authors)
- [SDK PR: Zod v4 with backwards compatibility for v3.25+](https://github.com/modelcontextprotocol/typescript-sdk/pull/1040)
- [SDK issue: Zod version mismatch reports (historical)](https://github.com/modelcontextprotocol/typescript-sdk/issues/906)

### Known Issues
- [McpAgent Timeout Issues (#640)](https://github.com/cloudflare/agents/issues/640)
- [authInfo in RequestHandlerExtra (#397)](https://github.com/modelcontextprotocol/typescript-sdk/issues/397)
