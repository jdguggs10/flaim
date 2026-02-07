# Sprint A: Auth Hardening + Error Taxonomy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Flaim's OAuth and MCP auth behavior cross-client compliant and review-ready for Claude, ChatGPT, and Gemini directory submissions.

**Architecture:** All changes are in existing Cloudflare Workers. Auth signaling changes land in `fantasy-mcp` (gateway) and `auth-worker`. Error taxonomy centralizes into `@flaim/worker-shared` and propagates to all 4 workers. A de-risking API spike for basketball/hockey happens last.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, MCP SDK (`@modelcontextprotocol/sdk`), Vitest, Supabase.

**Parent plan:** `docs/dev/plugins-buildout-plan.md` — Sprint A covers Workstream 1, Workstream 2, and the Workstream 6 API spike.

---

## Task 1: Tighten PKCE policy to S256-only

S256-only must be enforced at **three** layers: (a) metadata advertisement, (b) authorize endpoint, and (c) consent/code-creation path + PKCE verification.

**Files:**
- Modify: `workers/auth-worker/src/oauth-handlers.ts:178` (metadata — `code_challenge_methods_supported`)
- Modify: `workers/auth-worker/src/oauth-handlers.ts` (authorize handler — reject `plain`)
- Modify: `workers/auth-worker/src/oauth-handlers.ts:458` (consent handler — reject `plain` in `codeChallengeMethod` cast)
- Modify: `workers/auth-worker/src/oauth-storage.ts:114-132` (remove `plain` branch from `verifyPkceChallenge`)
- Modify: `workers/auth-worker/src/oauth-storage.ts:21-61` (remove `'plain'` from OAuthCode/CreateCodeParams type surfaces)
- Test: `workers/auth-worker/src/__tests__/oauth-handlers.test.ts`

**Step 1: Write failing test — reject plain PKCE at authorize**

Add to `workers/auth-worker/src/__tests__/oauth-handlers.test.ts`:

```typescript
it('rejects plain PKCE code_challenge_method', async () => {
  const req = new Request(
    'https://api.flaim.app/authorize?response_type=code&client_id=test' +
    '&redirect_uri=https://claude.ai/api/mcp/auth_callback' +
    '&code_challenge=abc123&code_challenge_method=plain'
  );
  const res = await handleAuthorize(req, env);

  expect(res.status).toBe(302);
  const location = new URL(res.headers.get('Location')!);
  expect(location.searchParams.get('error')).toBe('invalid_request');
  expect(location.searchParams.get('error_description')).toContain('S256');
});
```

**Step 2: Run test to verify it fails**

Run: `cd workers/auth-worker && npx vitest run src/__tests__/oauth-handlers.test.ts`
Expected: FAIL (currently `plain` is accepted)

**Step 3: Write failing test — metadata advertises S256 only**

Add to same test file:

```typescript
it('authorization server metadata advertises S256 only', async () => {
  const res = handleMetadataDiscovery(env, {});
  const body = await res.json() as { code_challenge_methods_supported: string[] };
  expect(body.code_challenge_methods_supported).toEqual(['S256']);
});
```

**Step 4: Run test to verify it fails**

Run: `cd workers/auth-worker && npx vitest run src/__tests__/oauth-handlers.test.ts`
Expected: FAIL (currently returns `['S256', 'plain']`)

**Step 5: Implement — harden all three layers**

In `workers/auth-worker/src/oauth-handlers.ts`:

1. **Line 178 (metadata):** Change `code_challenge_methods_supported: ['S256', 'plain']` to `code_challenge_methods_supported: ['S256']`.

2. **Authorize handler:** Add a check that rejects any `code_challenge_method` other than `S256`:

```typescript
if (codeChallengeMethod && codeChallengeMethod !== 'S256') {
  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set('error', 'invalid_request');
  redirectUrl.searchParams.set('error_description', 'Only S256 PKCE is supported');
  if (state) redirectUrl.searchParams.set('state', state);
  return Response.redirect(redirectUrl.toString(), 302);
}
```

3. **Line 458 (consent/code-creation):** The consent handler currently casts `body.code_challenge_method as 'S256' | 'plain'`. Change to reject `plain` before creating the authorization code:

```typescript
const method = body.code_challenge_method || 'S256';
if (method !== 'S256') {
  return new Response(JSON.stringify({
    error: 'invalid_request',
    error_description: 'Only S256 PKCE is supported',
  }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
}
```

In `workers/auth-worker/src/oauth-storage.ts`:

4. **Lines 114-132 (`verifyPkceChallenge`):** Remove the `plain` branch. The function should only handle `S256`. Update the type signature from `method: 'S256' | 'plain'` to `method: 'S256'` and remove the `if (method === 'plain')` block.

5. **Type cleanup:** update `OAuthCode.codeChallengeMethod` and `CreateCodeParams.codeChallengeMethod` from `'S256' | 'plain'` to `'S256'` so TypeScript no longer permits `plain` anywhere in the OAuth code path.

**Step 6: Run tests to verify they pass**

Run: `cd workers/auth-worker && npx vitest run src/__tests__/oauth-handlers.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add workers/auth-worker/src/oauth-handlers.ts workers/auth-worker/src/oauth-storage.ts workers/auth-worker/src/__tests__/oauth-handlers.test.ts
git commit -m "auth: require S256 PKCE only, remove plain method support across all layers"
```

---

## Task 2: Tighten redirect URI validation

**Files:**
- Modify: `workers/auth-worker/src/oauth-handlers.ts:120-130` (isValidRedirectUri)
- Test: `workers/auth-worker/src/__tests__/oauth-handlers.test.ts`

**Step 1: Write failing tests for strict redirect validation**

Add to `workers/auth-worker/src/__tests__/oauth-handlers.test.ts`:

```typescript
import { isValidRedirectUri } from '../oauth-handlers';

describe('redirect URI validation', () => {
  it('rejects localhost URI with suffix after port', () => {
    // startsWith() currently allows this — it shouldn't
    expect(isValidRedirectUri('http://localhost:3000xyz/evil')).toBe(false);
  });

  it('accepts exact allowlist match', () => {
    expect(isValidRedirectUri('https://claude.ai/api/mcp/auth_callback')).toBe(true);
  });

  it('accepts loopback with valid callback path', () => {
    expect(isValidRedirectUri('http://localhost:9999/callback')).toBe(true);
    expect(isValidRedirectUri('http://127.0.0.1:9999/oauth/callback')).toBe(true);
  });

  it('rejects loopback with arbitrary path', () => {
    expect(isValidRedirectUri('http://localhost:9999/evil')).toBe(false);
  });
});
```

Note: `isValidRedirectUri` is currently not exported. You will need to export it for testing.

**Step 2: Run tests to verify failure**

Run: `cd workers/auth-worker && npx vitest run src/__tests__/oauth-handlers.test.ts`
Expected: FAIL (the `localhost:3000xyz` case passes when it shouldn't)

**Step 3: Implement — replace startsWith with exact match**

In `workers/auth-worker/src/oauth-handlers.ts`, replace `isValidRedirectUri` (lines 120-130):

```typescript
export function isValidRedirectUri(uri: string): boolean {
  // Exact match against static allowlist
  if (ALLOWED_REDIRECT_URIS.includes(uri)) return true;

  // Dynamic loopback URIs for Claude Desktop (RFC 8252)
  return isLoopbackRedirectUri(uri);
}
```

This removes the `startsWith()` prefix matching entirely. Exact match for production URIs, parsed loopback check for localhost.

**Step 4: Run tests to verify they pass**

Run: `cd workers/auth-worker && npx vitest run src/__tests__/oauth-handlers.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add workers/auth-worker/src/oauth-handlers.ts workers/auth-worker/src/__tests__/oauth-handlers.test.ts
git commit -m "auth: tighten redirect URI validation to exact match + parsed loopback"
```

---

## Task 3: Enforce resource/audience in token validation

**Files:**
- Modify: `workers/auth-worker/src/oauth-storage.ts:436-462` (validateAccessToken)
- Modify: `workers/auth-worker/src/oauth-handlers.ts:694-709` (thread `expectedResource` through `validateOAuthToken`)
- Test: `workers/auth-worker/src/__tests__/oauth-handlers.test.ts` (or new test file)

**Step 1: Understand the current token table schema**

Check what columns exist on `oauth_tokens`. The current `validateAccessToken` selects `user_id, scope, expires_at, revoked_at`. The `resource` field is stored during token creation (line 369 in oauth-storage.ts) but never read during validation.

**Step 2: Write failing test — token validation checks resource**

Create or add to test file:

```typescript
describe('validateAccessToken resource enforcement', () => {
  it('rejects token when resource does not match', async () => {
    // Mock supabase to return a token with resource = 'https://api.flaim.app/mcp'
    const mockStorage = createMockStorage({
      access_token: 'test-token',
      user_id: 'user-123',
      scope: 'mcp:read',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      revoked_at: null,
      resource: 'https://api.flaim.app/mcp',
    });

    const result = await mockStorage.validateAccessToken('test-token', 'https://wrong-resource.com/mcp');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('resource');
  });

  it('accepts token when resource matches', async () => {
    const mockStorage = createMockStorage({
      access_token: 'test-token',
      user_id: 'user-123',
      scope: 'mcp:read',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      revoked_at: null,
      resource: 'https://api.flaim.app/mcp',
    });

    const result = await mockStorage.validateAccessToken('test-token', 'https://api.flaim.app/mcp');
    expect(result.valid).toBe(true);
  });

  it('accepts token when no resource was stored (backwards compat)', async () => {
    const mockStorage = createMockStorage({
      access_token: 'test-token',
      user_id: 'user-123',
      scope: 'mcp:read',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      revoked_at: null,
      resource: null,
    });

    const result = await mockStorage.validateAccessToken('test-token', 'https://api.flaim.app/mcp');
    expect(result.valid).toBe(true);
  });
});
```

Note: Adapt mock pattern to match existing test conventions in this file. The key is that `validateAccessToken` gains a second parameter `expectedResource`.

**Step 3: Run test to verify it fails**

Run: `cd workers/auth-worker && npx vitest run`
Expected: FAIL (validateAccessToken doesn't accept resource parameter)

**Step 4: Implement — add resource check to validateAccessToken**

In `workers/auth-worker/src/oauth-storage.ts`, modify `validateAccessToken`:

1. Add `resource` to the SELECT query.
2. Add `expectedResource?: string` parameter.
3. After expiry check, add:

```typescript
// Check resource/audience if stored
if (expectedResource && data.resource && data.resource !== expectedResource) {
  return { valid: false, error: 'Token resource mismatch' };
}
```

This is backwards-compatible: tokens without a stored resource still pass, and callers that don't pass `expectedResource` skip the check.

**Step 5: Update callers to pass resource**

Find where `validateAccessToken` is called (in auth-worker's Hono routes or middleware that validates bearer tokens for MCP requests). Pass the expected resource URL.

The gateway (`fantasy-mcp`) validates once per request using `GET /auth/introspect`. During that introspection call, pass the expected resource from gateway to auth-worker (for example `X-Flaim-Expected-Resource: https://api.flaim.app/mcp`), then thread it to `validateOAuthToken(token, env, expectedResource)` → `validateAccessToken(token, expectedResource)`.

Use the same path-sensitive resource logic already used by `buildMcpAuthErrorResponse`: `/fantasy/*` requests validate against `https://api.flaim.app/fantasy/mcp`, otherwise validate against `https://api.flaim.app/mcp`.

**Step 6: Run tests to verify they pass**

Run: `cd workers/auth-worker && npx vitest run`
Expected: PASS

**Step 7: Commit**

```bash
git add workers/auth-worker/src/oauth-storage.ts workers/auth-worker/src/oauth-handlers.ts workers/auth-worker/src/__tests__/
git commit -m "auth: enforce resource/audience check in token validation"
```

---

## Task 4: Add scope enforcement at tool boundary

**Files:**
- Modify: `workers/fantasy-mcp/src/index.ts:138-187` (gateway scope pre-flight via introspection)
- Modify: `workers/fantasy-mcp/src/mcp/server.ts:33-45` (tool registration)
- Modify: `workers/fantasy-mcp/src/mcp/tools.ts` (add required scope per tool)
- Modify: `workers/auth-worker/src/index-hono.ts` (add introspection endpoint)
- Modify: `workers/auth-worker/src/oauth-handlers.ts` (return scope from token validation path)
- Test: `workers/fantasy-mcp/src/__tests__/tools.test.ts`

**Step 1: Write failing test — tool requires matching scope**

Add to `workers/fantasy-mcp/src/__tests__/tools.test.ts`:

```typescript
it('each tool declares a required scope', () => {
  const tools = getUnifiedTools();
  for (const tool of tools) {
    expect(tool.requiredScope).toBeDefined();
    expect(['mcp:read', 'mcp:write']).toContain(tool.requiredScope);
  }
});
```

**Step 2: Run test to verify it fails**

Run: `cd workers/fantasy-mcp && npx vitest run src/__tests__/tools.test.ts`
Expected: FAIL (tools don't have `requiredScope` field)

**Step 3: Implement — add requiredScope to tool definitions**

In `workers/fantasy-mcp/src/mcp/tools.ts`, add `requiredScope: 'mcp:read'` to every tool definition (all current tools are read-only).

Update the tool type/interface to include:

```typescript
requiredScope: 'mcp:read' | 'mcp:write';
```

**Step 4: Run test to verify it passes**

Run: `cd workers/fantasy-mcp && npx vitest run src/__tests__/tools.test.ts`
Expected: PASS

**Step 5: Implement — expose scope from auth-worker and enforce at gateway**

**Why this is non-trivial:** Not all tools call auth-worker from the gateway. There are two tool patterns:

- `get_user_session` and `get_ancient_history` call auth-worker directly from the tool handler (tools.ts lines ~260-340).
- `get_roster`, `get_standings`, `get_matchups`, `get_league_info`, `get_free_agents` call `routeToClient()` (router.ts) which forwards the auth header to platform workers (espn-client, yahoo-client). These tools never touch auth-worker from the gateway.

A per-tool-response header approach (e.g., `X-Flaim-Token-Scope`) would only work for tools that call auth-worker. For tools that route to platform clients, the scope would never be checked.

**Recommended approach: validate scope once at the gateway boundary, before any tool handler runs.**

In `fantasy-mcp/src/index.ts`, the `handleMcpRequest` function (line 138) already checks for the `Authorization` header before creating the MCP server. Add a **scope pre-flight** call here:

1. **auth-worker:** Add a lightweight token introspection endpoint. Implement it as `api.get('/introspect', ...)` so it is reachable as `/auth/introspect` via the existing `app.route('/auth', api)` mount. Accept `Authorization: Bearer <token>` and `X-Flaim-Expected-Resource` headers, return `{ valid: true, userId, scope }` or `{ valid: false, error }`.

2. **fantasy-mcp/index.ts:** After confirming `authHeader` is present (line 152), call auth-worker's introspect endpoint via service binding:

```typescript
const authHeader = c.req.header('Authorization');
if (!authHeader) {
  return buildMcpAuthErrorResponse(c.req.raw);
}

const pathname = new URL(c.req.raw.url).pathname;
const expectedResource = pathname.startsWith('/fantasy/')
  ? 'https://api.flaim.app/fantasy/mcp'
  : 'https://api.flaim.app/mcp';

// Pre-flight: resolve token scope before creating MCP server
const introspectRes = await c.env.AUTH_WORKER.fetch(
  new Request('https://internal/auth/introspect', {
    headers: {
      Authorization: authHeader,
      'X-Flaim-Expected-Resource': expectedResource,
    },
  })
);

// Invalid token → return 401 with WWW-Authenticate immediately.
// Do NOT fall through with tokenScope = undefined — that would skip scope checks.
if (!introspectRes.ok) {
  return buildMcpAuthErrorResponse(c.req.raw);
}
const tokenInfo = await introspectRes.json() as { valid: boolean; scope?: string };
if (!tokenInfo.valid) {
  return buildMcpAuthErrorResponse(c.req.raw);
}
const tokenScope = typeof tokenInfo.scope === 'string' ? tokenInfo.scope.trim() : '';
if (!tokenScope) {
  return buildMcpAuthErrorResponse(c.req.raw);
}
```

3. **fantasy-mcp/server.ts:** Add `tokenScope?: string` to `McpContext`. Add a fail-closed helper for exact scope membership (space-delimited OAuth scope string), then use it before calling `tool.handler`:

```typescript
export function hasRequiredScope(grantedScope: string | undefined, requiredScope: 'mcp:read' | 'mcp:write'): boolean {
  if (!grantedScope) return false;
  const granted = new Set(grantedScope.split(/\s+/).filter(Boolean));
  return granted.has(requiredScope);
}

if (!hasRequiredScope(tokenScope, tool.requiredScope)) {
  return {
    content: [{ type: 'text', text: 'INSUFFICIENT_SCOPE: Token does not have required scope' }],
    isError: true,
  };
}
```

This approach checks scope **once per MCP request** at the gateway, not per-tool-call, and works regardless of whether the tool routes to auth-worker or a platform client.

4. **auth-worker:** Modify `AuthResult` (index-hono.ts:275) to include `scope?: string`. Propagate scope from `validateAccessToken(token, expectedResource)` through `validateOAuthToken(token, env, expectedResource)` to the introspect response.

**Step 6: Write test for scope rejection**

```typescript
it('rejects tool call when scope is insufficient', async () => {
  expect(hasRequiredScope('mcp:write', 'mcp:read')).toBe(false);
  expect(hasRequiredScope('mcp:read mcp:write', 'mcp:read')).toBe(true);
  expect(hasRequiredScope(undefined, 'mcp:read')).toBe(false);
});
```

Also add an integration-style gateway test (index/server boundary) that mocks introspection to return `scope: 'mcp:write'` and verifies a `tools/call` for a read tool returns `INSUFFICIENT_SCOPE`.

**Step 7: Run all tests**

Run: `cd workers/fantasy-mcp && npx vitest run && cd ../auth-worker && npx vitest run`
Expected: PASS

**Step 8: Commit**

```bash
git add workers/fantasy-mcp/src/index.ts workers/fantasy-mcp/src/mcp/server.ts workers/fantasy-mcp/src/mcp/tools.ts workers/fantasy-mcp/src/__tests__/tools.test.ts workers/auth-worker/src/index-hono.ts workers/auth-worker/src/oauth-handlers.ts
git commit -m "auth: add per-tool scope enforcement at gateway boundary"
```

---

## Task 5: Add per-tool securitySchemes declaration + _meta mirror

This task covers both the tool descriptor `securitySchemes` AND the `_meta["securitySchemes"]` compatibility mirror (parent plan requirements WS1 tasks 1 and 2).

**Files:**
- Modify: `workers/fantasy-mcp/src/mcp/server.ts:33-45` (tool registration — both securitySchemes and _meta mirror)
- Test: `workers/fantasy-mcp/src/__tests__/tools.test.ts`

**Step 1: Research MCP SDK API for securitySchemes**

Check how `server.registerTool()` accepts securitySchemes. The MCP spec defines this as part of tool metadata. Check the `@modelcontextprotocol/sdk` types to confirm the exact property name and shape.

Run from repo root (dependencies are typically hoisted in this monorepo):

`cd /Users/ggugger/Code/flaim && rg -n 'securitySchemes|security_schemes' node_modules/@modelcontextprotocol/sdk/dist/esm -g '*.d.ts'`

If the SDK doesn't support descriptor-level `securitySchemes` metadata directly in `registerTool`, emit descriptor `_meta` via `tools/list` response shaping (not per-tool call responses).

**Step 2: Write failing test**

The securitySchemes mirror is descriptor-level metadata, so test against the tool listing, not individual tool call responses.

```typescript
it('all tools declare securitySchemes in registration metadata', () => {
  // This test validates the registration call includes securitySchemes
  // Exact shape depends on MCP SDK API discovered in Step 1
  // Test against tools/list response or registerTool call args, NOT tool handler output
});
```

**Step 3: Implement — add securitySchemes to tool registration**

In `workers/fantasy-mcp/src/mcp/server.ts`, update the `registerTool` call to include securitySchemes (exact shape depends on SDK research from Step 1).

**Step 4: Implement — add _meta["securitySchemes"] mirror**

Clarification on where the mirror lives: The MCP spec's `_meta["securitySchemes"]` is **descriptor-level metadata** (part of the tool listing response, not individual tool call results). This means it should be set during `server.registerTool()` alongside `annotations`, not injected into every `mcpSuccess` response.

Check how the MCP SDK exposes `_meta` at registration time:

```bash
cd /Users/ggugger/Code/flaim && rg -n '_meta|registerTool' node_modules/@modelcontextprotocol/sdk/dist/esm -g '*.d.ts'
```

If `registerTool` supports a `_meta` field in its metadata argument, add it there alongside `annotations`:

```typescript
server.registerTool(
  tool.name,
  {
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: { readOnlyHint: true },
    _meta: {
      securitySchemes: { oauth: { type: 'oauth2', scope: tool.requiredScope } },
    },
  },
  handler
);
```

If the SDK does **not** support `_meta` at registration, the mirror must be emitted via the `tools/list` response. Check if the SDK allows customizing the `tools/list` response handler, or if a post-processing hook is available. Do **not** place this mirror on individual tool-call (`tools/call`) responses.

**Step 5: Run tests**

Run: `cd workers/fantasy-mcp && npx vitest run`
Expected: PASS

**Step 6: Commit**

```bash
git add workers/fantasy-mcp/src/mcp/server.ts workers/fantasy-mcp/src/__tests__/tools.test.ts
git commit -m "auth: add per-tool securitySchemes declaration + _meta mirror for MCP compliance"
```

---

## Task 6: Add _meta["mcp/www_authenticate"] to auth error responses

**Files:**
- Modify: `workers/fantasy-mcp/src/mcp/tools.ts:18-23` (McpToolResponse interface)
- Modify: `workers/fantasy-mcp/src/mcp/tools.ts:137-142` (mcpError function)
- Modify: `workers/fantasy-mcp/src/mcp/tools.ts:283-285` (AUTH_FAILED handling)
- Test: `workers/fantasy-mcp/src/__tests__/tools.test.ts`

**Step 1: Write failing test — auth errors include _meta**

Add to `workers/fantasy-mcp/src/__tests__/tools.test.ts`:

```typescript
it('auth failure response includes _meta with www_authenticate', async () => {
  const tool = getUnifiedTools().find((t) => t.name === 'get_user_session');

  const env = {
    AUTH_WORKER: {
      fetch: async () => new Response('unauthorized', { status: 401 }),
    },
  } as unknown as Env;

  const result = await tool!.handler({}, env, 'Bearer bad-token');
  expect(result.isError).toBe(true);
  expect(result._meta).toBeDefined();
  expect(result._meta?.['mcp/www_authenticate']).toBeDefined();
});
```

Note: Refine this test based on whether auth errors should throw (current behavior) or return error responses with _meta (target behavior). The MCP spec says auth errors in tool results should include `_meta["mcp/www_authenticate"]` rather than throwing.

**Step 2: Run test to verify current behavior**

Run: `cd workers/fantasy-mcp && npx vitest run src/__tests__/tools.test.ts`
Expected: Currently throws AUTH_FAILED error

**Step 3: Implement — extend McpToolResponse with _meta**

In `workers/fantasy-mcp/src/mcp/tools.ts`:

1. Update `McpToolResponse` interface (lines 18-23):

```typescript
export interface McpToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
  [key: string]: unknown;
}
```

2. Create `mcpAuthError` helper. Per MCP spec convention (and consistent with the phase0 gateway plan at `docs/plans/2025-01-19-phase0-unified-gateway.md:1843`), `mcp/www_authenticate` uses a **string array** format, not an object:

```typescript
function mcpAuthError(resource: string): McpToolResponse {
  return {
    content: [{ type: 'text', text: 'AUTH_FAILED: Authentication required' }],
    isError: true,
    _meta: {
      'mcp/www_authenticate': [
        `Bearer resource_metadata="${resource}/.well-known/oauth-protected-resource", error="invalid_token", error_description="Authentication required"`
      ],
    },
  };
}
```

3. Update AUTH_FAILED handling (around lines 283-285, 491-493): Instead of throwing, return `mcpAuthError(resource)`. The resource URL should be derived from the request context or a constant.

**Step 4: Run tests**

Run: `cd workers/fantasy-mcp && npx vitest run`
Expected: PASS

**Step 5: Commit**

```bash
git add workers/fantasy-mcp/src/mcp/tools.ts workers/fantasy-mcp/src/__tests__/tools.test.ts
git commit -m "auth: add _meta[mcp/www_authenticate] to auth error responses"
```

---

## Task 7: Update 401 WWW-Authenticate to include resource_metadata

**Files:**
- Modify: `workers/fantasy-mcp/src/index.ts:112-136` (buildMcpAuthErrorResponse)
- Test: `workers/fantasy-mcp/src/__tests__/tools.test.ts` (or new integration test)

**Step 1: Write failing test**

```typescript
it('401 response includes resource_metadata in WWW-Authenticate', () => {
  const request = new Request('https://api.flaim.app/mcp', { method: 'POST' });
  const response = buildMcpAuthErrorResponse(request);

  const wwwAuth = response.headers.get('WWW-Authenticate')!;
  expect(wwwAuth).toContain('resource_metadata=');
  expect(wwwAuth).toContain('.well-known/oauth-protected-resource');
});
```

Note: `buildMcpAuthErrorResponse` is not currently exported. Export it for testing.

**Step 2: Run test to verify failure**

Run: `cd workers/fantasy-mcp && npx vitest run`
Expected: FAIL (current header is `Bearer realm="fantasy-mcp", resource="..."` without `resource_metadata`)

**Step 3: Implement**

In `workers/fantasy-mcp/src/index.ts`, update the WWW-Authenticate header construction (around line 131):

```typescript
'WWW-Authenticate': `Bearer realm="fantasy-mcp", resource="${resource}", resource_metadata="${resource}/.well-known/oauth-protected-resource"`,
```

**Step 4: Run tests**

Run: `cd workers/fantasy-mcp && npx vitest run`
Expected: PASS

**Step 5: Commit**

```bash
git add workers/fantasy-mcp/src/index.ts workers/fantasy-mcp/src/__tests__/
git commit -m "auth: add resource_metadata to 401 WWW-Authenticate header"
```

---

## Task 8: Centralize error codes into @flaim/worker-shared

**Files:**
- Create: `workers/shared/src/errors.ts`
- Modify: `workers/shared/src/index.ts` (export new module)
- Test: `workers/shared/src/__tests__/errors.test.ts` (create)

**Step 1: Write the error module test**

Create `workers/shared/src/__tests__/errors.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { ErrorCode, extractErrorCode } from '../errors';

describe('error utilities', () => {
  it('extractErrorCode parses CODE: message format', () => {
    expect(extractErrorCode(new Error('ESPN_NOT_FOUND: League not found'))).toBe('ESPN_NOT_FOUND');
  });

  it('extractErrorCode returns INTERNAL_ERROR for unprefixed messages', () => {
    expect(extractErrorCode(new Error('something went wrong'))).toBe('INTERNAL_ERROR');
  });

  it('extractErrorCode handles non-Error values', () => {
    expect(extractErrorCode('string error')).toBe('INTERNAL_ERROR');
  });

  it('ErrorCode enum contains all known codes', () => {
    expect(ErrorCode.NOT_SUPPORTED).toBe('NOT_SUPPORTED');
    expect(ErrorCode.AUTH_FAILED).toBe('AUTH_FAILED');
    expect(ErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd workers/shared && npx vitest run` (or check if shared has a test script; if not, add one to package.json first)

Check: `cat workers/shared/package.json` — if no test script, add `"test": "vitest run"` and `vitest` as a dev dependency.

Expected: FAIL (module doesn't exist)

**Step 3: Implement shared error module**

Create `workers/shared/src/errors.ts`:

```typescript
/**
 * Canonical error codes used across all Flaim workers.
 *
 * Convention: thrown errors use format "CODE: Human message".
 * Use extractErrorCode() to parse the code from caught errors.
 */
export const ErrorCode = {
  // Auth
  AUTH_FAILED: 'AUTH_FAILED',
  CREDENTIALS_MISSING: 'CREDENTIALS_MISSING',
  INSUFFICIENT_SCOPE: 'INSUFFICIENT_SCOPE',

  // Platform routing
  PLATFORM_NOT_SUPPORTED: 'PLATFORM_NOT_SUPPORTED',
  PLATFORM_ERROR: 'PLATFORM_ERROR',
  ROUTING_ERROR: 'ROUTING_ERROR',

  // Sport/tool
  NOT_SUPPORTED: 'NOT_SUPPORTED',
  INVALID_SPORT: 'INVALID_SPORT',
  SPORT_NOT_SUPPORTED: 'SPORT_NOT_SUPPORTED',
  UNKNOWN_TOOL: 'UNKNOWN_TOOL',

  // ESPN-specific
  ESPN_COOKIES_EXPIRED: 'ESPN_COOKIES_EXPIRED',
  ESPN_ACCESS_DENIED: 'ESPN_ACCESS_DENIED',
  ESPN_NOT_FOUND: 'ESPN_NOT_FOUND',
  ESPN_RATE_LIMIT: 'ESPN_RATE_LIMIT',
  ESPN_API_ERROR: 'ESPN_API_ERROR',
  ESPN_INVALID_RESPONSE: 'ESPN_INVALID_RESPONSE',
  ESPN_CREDENTIALS_NOT_FOUND: 'ESPN_CREDENTIALS_NOT_FOUND',
  ESPN_ERROR: 'ESPN_ERROR',

  // Yahoo-specific
  YAHOO_AUTH_ERROR: 'YAHOO_AUTH_ERROR',
  YAHOO_ACCESS_DENIED: 'YAHOO_ACCESS_DENIED',
  YAHOO_NOT_FOUND: 'YAHOO_NOT_FOUND',
  YAHOO_RATE_LIMITED: 'YAHOO_RATE_LIMITED',
  YAHOO_API_ERROR: 'YAHOO_API_ERROR',
  YAHOO_NOT_CONNECTED: 'YAHOO_NOT_CONNECTED',
  YAHOO_TIMEOUT: 'YAHOO_TIMEOUT',

  // Data
  LEAGUES_MISSING: 'LEAGUES_MISSING',
  TEAM_ID_MISSING: 'TEAM_ID_MISSING',
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
  DUPLICATE: 'DUPLICATE',

  // Generic
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Extract a machine-readable error code from a caught error.
 * Expects errors thrown in "CODE: message" format.
 */
export function extractErrorCode(error: unknown): string {
  if (error instanceof Error) {
    const match = error.message.match(/^([A-Z_]+):/);
    if (match) return match[1];
  }
  return ErrorCode.INTERNAL_ERROR;
}

/**
 * Standard error response shape used by platform clients and gateway.
 */
export interface ExecuteResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  code?: string;
}
```

**Step 4: Export from shared index**

Add to `workers/shared/src/index.ts`:

```typescript
// Error utilities
export { ErrorCode, extractErrorCode } from './errors.js';
export type { ErrorCodeValue, ExecuteResponse } from './errors.js';
```

**Step 5: Run test to verify it passes**

Run: `cd workers/shared && npx vitest run`
Expected: PASS

**Step 6: Commit**

```bash
git add workers/shared/src/errors.ts workers/shared/src/__tests__/errors.test.ts workers/shared/src/index.ts
git commit -m "feat: centralize error codes and extractErrorCode into @flaim/worker-shared"
```

---

## Task 9: Migrate workers to use shared error utilities

**Files:**
- Modify: `workers/espn-client/src/sports/football/handlers.ts` (remove local extractErrorCode)
- Modify: `workers/espn-client/src/sports/baseball/handlers.ts` (remove local extractErrorCode)
- Modify: `workers/espn-client/src/types.ts` (remove local ExecuteResponse, import from shared)
- Modify: `workers/yahoo-client/src/sports/football/handlers.ts` (remove local extractErrorCode)
- Modify: `workers/yahoo-client/src/sports/baseball/handlers.ts` (remove local extractErrorCode)
- Modify: `workers/yahoo-client/src/types.ts` (remove local ExecuteResponse, import from shared)
- Modify: `workers/fantasy-mcp/src/router.ts` (import ExecuteResponse as RouteResult or alias)

**Step 1: Replace extractErrorCode in espn-client football handlers**

In `workers/espn-client/src/sports/football/handlers.ts`:
1. Remove the local `extractErrorCode` function (around line 428-436).
2. Add import: `import { extractErrorCode } from '@flaim/worker-shared';`

**Step 2: Do the same for espn-client baseball handlers**

`workers/espn-client/src/sports/baseball/handlers.ts` — same change.

**Step 3: Do the same for yahoo-client football and baseball handlers**

- `workers/yahoo-client/src/sports/football/handlers.ts` (around line 22-28)
- `workers/yahoo-client/src/sports/baseball/handlers.ts` (around line 22-28)

**Step 4: Replace ExecuteResponse in espn-client types**

In `workers/espn-client/src/types.ts`, remove the local `ExecuteResponse` interface (lines 150-156) and re-export from shared:

```typescript
export type { ExecuteResponse } from '@flaim/worker-shared';
```

Verify all imports of `ExecuteResponse` from `../types` still resolve.

**Step 5: Same for yahoo-client types**

In `workers/yahoo-client/src/types.ts`, remove local `ExecuteResponse` and re-export.

**Step 6: Run all worker tests**

```bash
cd workers/espn-client && npx vitest run
cd workers/yahoo-client && npx vitest run
cd workers/fantasy-mcp && npx vitest run
cd workers/auth-worker && npx vitest run
```

Expected: All PASS

**Step 7: Commit**

```bash
git add workers/espn-client/ workers/yahoo-client/ workers/fantasy-mcp/ workers/shared/
git commit -m "refactor: migrate all workers to shared extractErrorCode and ExecuteResponse"
```

---

## Task 10: Document error codes and idempotency

**Files:**
- Create: `docs/ERROR-CODES.md`
- Modify: `docs/INDEX.md` (add `docs/ERROR-CODES.md` to permanent doc map/source-of-truth routing)
- Modify: Tool descriptions in `workers/fantasy-mcp/src/mcp/tools.ts` (add idempotency notes)

**Step 1: Write error codes doc**

Create `docs/ERROR-CODES.md` with:
- Table of all error codes from `ErrorCode` enum, grouped by category.
- For each code: name, description, likely cause, suggested user action.
- Reference to the shared module location.

**Step 2: Update docs index routing**

In `docs/INDEX.md`, add `docs/ERROR-CODES.md` to the permanent docs map and note where error-code taxonomy is maintained. This keeps doc routing consistent with the repo's "read INDEX first" rule.

**Step 3: Add idempotency notes to tool descriptions**

In `workers/fantasy-mcp/src/mcp/tools.ts`, append to each tool's `description` string:

```
All tools are read-only and safe to retry (idempotent).
```

Or add it once to a shared description prefix. Keep it brief — this is for MCP consumers, not end users.

**Step 4: Run tests to make sure descriptions didn't break anything**

Run: `cd workers/fantasy-mcp && npx vitest run`
Expected: PASS

**Step 5: Commit**

```bash
git add docs/ERROR-CODES.md docs/INDEX.md workers/fantasy-mcp/src/mcp/tools.ts
git commit -m "docs: add error code taxonomy and tool idempotency documentation"
```

---

## Task 11: Basketball/hockey API spike (de-risk)

**Purpose:** Verify ESPN and Yahoo basketball/hockey APIs use the same response structure as football/baseball. This is research only — no code changes.

**Step 1: ESPN basketball API probe**

Using the ESPN API pattern from `workers/espn-client/src/shared/espn-api.ts`, construct a manual curl request for a basketball league:

```bash
# Pattern from espn-api.ts — adjust sport segment
curl -s "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2026/segments/0/leagues/{LEAGUE_ID}?view=mTeam&view=mRoster&view=mMatchup&view=mStandings" \
  -H "Cookie: espn_s2={S2}; SWID={SWID}" | head -c 2000
```

Check: Does the response have the same top-level structure (`teams`, `schedule`, `standings`) as football/baseball?

**Step 2: ESPN hockey API probe**

Same as above but with `fhl` sport segment.

**Step 3: Yahoo basketball API probe**

Using the Yahoo API pattern from `workers/yahoo-client/src/shared/yahoo-api.ts`:

```bash
curl -s "https://fantasysports.yahooapis.com/fantasy/v2/league/nba.l.{LEAGUE_ID}/standings?format=json" \
  -H "Authorization: Bearer {ACCESS_TOKEN}" | head -c 2000
```

Check: Does the response use the same numeric-keyed object pattern as football/baseball?

**Step 4: Yahoo hockey API probe**

Same as above but with `nhl` league key prefix.

**Step 5: Document findings**

Write a short summary in `docs/dev/basketball-hockey-api-spike.md`:
- For each sport+platform: does it match the existing pattern? Any structural differences?
- Decision: proceed with buildout as planned, or reassess scope.

**Step 6: Commit**

```bash
git add docs/dev/basketball-hockey-api-spike.md
git commit -m "spike: document basketball/hockey API structure for ESPN and Yahoo"
```

---

## Task 12: Run full test suite and verify

**Step 1: Run all worker tests**

```bash
cd workers/auth-worker && npx vitest run
cd workers/espn-client && npx vitest run
cd workers/yahoo-client && npx vitest run
cd workers/fantasy-mcp && npx vitest run
```

All must pass.

**Step 2: Run type checks per worker**

Root `npm run build` and `npm run lint` only cover `/web`. Run type checks per worker:

```bash
cd workers/auth-worker && npx tsc --noEmit
cd workers/espn-client && npx tsc --noEmit
cd workers/yahoo-client && npx tsc --noEmit
cd workers/fantasy-mcp && npx tsc --noEmit
```

**Step 3: Run frontend lint**

```bash
cd web && npm run lint
```

**Step 4: Run flaim-eval against production**

After deploying to preview or prod:

```bash
cd /Users/ggugger/Code/flaim-eval
npm run eval
```

Verify all scenarios pass with the auth hardening changes.

**Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "chore: sprint A final verification pass"
```

---

## Summary

| Task | Workstream | What it does |
|------|-----------|--------------|
| 1 | WS1 | PKCE S256-only |
| 2 | WS1 | Strict redirect URI validation |
| 3 | WS1 | Resource/audience enforcement in token validation |
| 4 | WS1 | Per-tool scope enforcement |
| 5 | WS1 | Per-tool securitySchemes declaration + _meta mirror |
| 6 | WS1 | _meta[mcp/www_authenticate] in auth errors |
| 7 | WS1 | resource_metadata in 401 WWW-Authenticate |
| 8 | WS2 | Centralize error codes into shared package |
| 9 | WS2 | Migrate workers to shared error utilities |
| 10 | WS2 | Document error codes and idempotency |
| 11 | WS6 spike | Basketball/hockey API shape verification |
| 12 | All | Full test suite verification |

Tasks 1-7 are auth hardening (Workstream 1). Tasks 8-10 are error taxonomy (Workstream 2). Task 11 is the de-risking spike for Workstream 6. Task 12 is the verification gate.
