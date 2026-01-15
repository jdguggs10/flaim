# Architectural Analysis: Adopting @modelcontextprotocol/sdk

**Date**: 2026-01-15
**Updated**: 2026-01-15 (Extended Research)
**Status**: Investigation Complete
**Author**: Claude (Architecture Analysis)

## Executive Summary

Adopting the official MCP SDK would **replace approximately 600-800 lines of protocol boilerplate per worker** while gaining automatic spec compliance, better type safety, and official transport implementations. The SDK is now at **version 1.25.x** with mature authentication context support.

**Key Finding**: There are now **two viable paths** for Cloudflare Workers:
1. **Native Cloudflare approach** using `createMcpHandler` + `WorkerTransport` (recommended)
2. **Standard SDK** with `fetch-to-node` shim for `StreamableHTTPServerTransport`

Your custom OAuth flow (`_meta["mcp/www_authenticate"]`) is **compliant with MCP spec** (RFC 9728) and can be preserved.

---

## 1. Current Implementation Analysis

### Code Inventory

| File | Lines | Purpose |
|------|-------|---------|
| `baseball-espn-mcp/src/mcp/agent.ts` | 1,216 | Main MCP agent with protocol handling |
| `football-espn-mcp/src/mcp/football-agent.ts` | 1,023 | Football MCP agent (mostly duplicated) |
| `baseball-espn-mcp/src/index.ts` | 794 | Entry point + onboarding |
| `football-espn-mcp/src/index.ts` | 791 | Entry point + onboarding |
| **Total MCP-related code** | **3,824 lines** | |

### Manual Protocol Handling (Lines Replaceable by SDK)

**Per agent (~300-350 lines each):**

1. **JSON-RPC Types** (`agent.ts:86-102`) - 17 lines
   ```typescript
   interface JsonRpcRequest { jsonrpc: "2.0"; method: string; ... }
   interface JsonRpcResponse { jsonrpc: "2.0"; result?: any; error?: {...}; ... }
   ```

2. **Request Routing** (`agent.ts:249-331`) - 82 lines
   ```typescript
   handleJsonRpc() // GET discovery, POST routing, JSON parsing, validation
   ```

3. **Initialize Handler** (`agent.ts:336-348`) - 12 lines
   ```typescript
   handleInitialize() // protocolVersion, capabilities, serverInfo
   ```

4. **Tools List Handler** (`agent.ts:353-356`) - 4 lines

5. **Tools Call Handler** (`agent.ts:361-488`) - 127 lines
   ```typescript
   handleToolsCall() // param extraction, validation, response formatting
   ```

6. **Response Helpers** (`agent.ts:493-517`) - 25 lines
   ```typescript
   jsonRpcSuccess() / jsonRpcError()
   ```

7. **Tool Definitions** (`agent.ts:522-658`) - 136 lines
   ```typescript
   getToolDefinitions() // securitySchemes, inputSchema for each tool
   ```

**Estimated replaceable code: ~600-700 lines across both workers**

---

## 2. Official MCP SDK Capabilities

### Package Structure

```bash
npm install @modelcontextprotocol/sdk zod
```

**Key exports:**
- `@modelcontextprotocol/sdk/server/mcp.js` → `McpServer`
- `@modelcontextprotocol/sdk/server/streamableHttp.js` → `StreamableHTTPServerTransport`
- `@modelcontextprotocol/sdk/server/auth/router.js` → `mcpAuthRouter`
- `@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js` → `ProxyOAuthServerProvider`

### Tool Registration APIs

**Important**: The SDK has two APIs - use `registerTool()` (recommended), not the deprecated `tool()`:

| Method | Status | Schema Support |
|--------|--------|----------------|
| `registerTool()` | **Current/Recommended** | Full Zod support including `z.union()`, `z.intersection()` |
| `tool()` | Deprecated | Limited to `ZodRawShape` only |

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({
  name: "fantasy-baseball-mcp",
  version: "4.0.0"
});

// Using registerTool (recommended API)
server.registerTool(
  "get_espn_baseball_league_info",
  {
    title: "Baseball League Info",
    description: "Get ESPN fantasy baseball league information",
    inputSchema: {
      leagueId: z.string().describe("ESPN league ID"),
      seasonId: z.string().optional().describe("Season year")
    }
  },
  async ({ leagueId, seasonId }, extra) => {
    // Access auth context via extra.authInfo (added in PR #399)
    const token = extra.authInfo?.token;
    const result = await getEspnLeagueInfo(...);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);
```

### Authentication Context in Tool Handlers

**Good news**: The SDK now natively supports passing auth context to tool handlers (resolved via [PR #166](https://github.com/modelcontextprotocol/typescript-sdk/issues/171) and [PR #399](https://github.com/modelcontextprotocol/typescript-sdk/issues/397)):

```typescript
server.registerTool("my_tool", {...}, async (args, extra) => {
  // Access authentication info directly
  const token = extra.authInfo?.token;        // The bearer token
  const clientId = extra.authInfo?.clientId;  // OAuth client ID

  // Use token for downstream API calls (e.g., ESPN API)
  return { content: [...] };
});
```

This eliminates the need for workarounds like manually injecting context into message params.

---

## 3. Cloudflare Workers Compatibility

### Two Approaches for Workers

Cloudflare has **first-class MCP support** as of 2025 with two main patterns:

#### Approach 1: Native Cloudflare (`createMcpHandler` + `WorkerTransport`) - RECOMMENDED

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler, getMcpAuthContext } from "@cloudflare/agents";
import { z } from "zod";

const server = new McpServer({ name: "fantasy-baseball-mcp", version: "4.0.0" });

server.registerTool("get_league_info", {
  title: "League Info",
  description: "Get ESPN fantasy league information",
  inputSchema: { leagueId: z.string() }
}, async ({ leagueId }) => {
  // Access auth context via Cloudflare's helper
  const authContext = getMcpAuthContext();
  const token = authContext?.token;
  // ... your logic
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

export default {
  fetch: createMcpHandler(server)
};
```

**Benefits**:
- `WorkerTransport` is built on web standards, native to Workers
- No `fetch-to-node` shim needed
- `getMcpAuthContext()` provides auth info to tools
- Handles CORS, SSE streaming, session management automatically

#### Approach 2: Standard SDK with `fetch-to-node` Shim

```typescript
import { Hono } from 'hono';
import { toFetchResponse, toReqRes } from 'fetch-to-node';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const app = new Hono();

app.post('/mcp', async (c) => {
  const { req, res } = toReqRes(c.req.raw);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, await c.req.json());
  return toFetchResponse(res);
});
```

**When to use**: If you need features not yet in Cloudflare's wrapper.

### Node.js Compatibility in Workers (Improved)

Cloudflare Workers now have [extensive Node.js compatibility](https://blog.cloudflare.com/nodejs-workers-2025/):

- Enable `nodejs_compat` flag in `wrangler.toml`
- Full Node.js streams implementation available
- `node:http` supported via compatibility flags

```toml
# wrangler.toml
compatibility_flags = ["nodejs_compat"]
compatibility_date = "2024-09-23"
```

### Your Specific Challenges (Reassessed)

| Your Feature | SDK Support | Complexity | Notes |
|--------------|-------------|------------|-------|
| Custom OAuth via `_meta["mcp/www_authenticate"]` | **✅ Compliant** | Low | RFC 9728 standard |
| Service bindings to auth-worker | Via context | Medium | Pass through `getMcpAuthContext()` |
| Legacy REST endpoints (`/mcp/tools/list`) | You maintain | Low | Deprecate over time |
| Onboarding/discovery endpoints | Separate concern | Low | Keep outside MCP handler |
| Sport-specific tool normalization | In tool handlers | Low | Unchanged |

### OAuth 401 Response (Your Implementation is Correct)

Your current 401 response pattern follows [MCP Authorization Spec (RFC 9728)](https://modelcontextprotocol.io/specification/draft/basic/authorization):

```typescript
// Your current pattern - THIS IS CORRECT
return new Response(JSON.stringify({
  error: { code: -32001, message: "Unauthorized" },
  _meta: { "mcp/www_authenticate": { ... } }
}), {
  status: 401,
  headers: {
    'WWW-Authenticate': 'Bearer resource_metadata="https://api.flaim.app/.well-known/oauth-protected-resource"'
  }
});
```

The MCP spec states: "MCP servers MUST use the HTTP header WWW-Authenticate when returning a 401 Unauthorized to indicate the location of the resource server metadata URL."

---

## 4. Migration Architecture Options

### Option A: Minimal SDK Adoption (Recommended First Step)

**Keep** your current request routing and auth handling, but use `McpServer` for:
- Tool registration with Zod schemas (type-safe)
- Protocol-compliant responses (auto-formatting)
- `tools/list` and `tools/call` implementations

```typescript
// Current index.ts stays mostly the same
if (pathname === '/mcp') {
  // Your auth middleware (unchanged)
  if (!authHeader) {
    return yourCustom401Response(); // Keep your _meta handling
  }

  // SDK handles tool routing
  return await mcpHandler.handleRequest(request);
}
```

**Benefit**: Incremental migration, keep custom auth
**Lines removed**: ~200-250 per worker

---

### Option B: Full SDK Adoption with Hono

Rewrite to use SDK's Streamable HTTP transport:

```typescript
import { Hono } from 'hono';
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { toFetchResponse, toReqRes } from 'fetch-to-node';
import { z } from 'zod';

const app = new Hono<{ Bindings: Env }>();
const server = new McpServer({ name: "fantasy-baseball-mcp", version: "4.0.0" });

// Register all tools
server.registerTool("get_user_session", {
  title: "User Session",
  description: "...",
  inputSchema: {}
}, async (_args, extra) => {
  // Access env and auth from extra context
  const env = extra.env as Env;
  const authHeader = extra.authHeader;
  // ... your logic
});

app.post('/mcp', async (c) => {
  // Custom auth check BEFORE SDK handles request
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return c.json({ /* your custom 401 */ }, 401);
  }

  const { req, res } = toReqRes(c.req.raw);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  // Inject context for tools to access
  await server.connect(transport);
  await transport.handleRequest(req, res, await c.req.json());
  return toFetchResponse(res);
});
```

**Benefit**: Full spec compliance, future-proof
**Lines removed**: ~400-500 per worker
**New dependencies**: `hono`, `fetch-to-node`, `@modelcontextprotocol/sdk`, `zod`

---

### Option C: Cloudflare Agents SDK (McpAgent Class)

Use Cloudflare's official wrapper which handles transport automatically:

```typescript
import { McpAgent } from "agents/mcp";

export class BaseballMcpAgent extends McpAgent<Env, State> {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
  }

  async init() {
    this.server.registerTool("get_espn_baseball_league_info", {...}, handler);
  }
}
```

**Considerations**:
- Requires Durable Objects (different billing model)
- Some timeout issues reported (GitHub Issue #640)
- Tighter Cloudflare lock-in

---

### Option D: Native Cloudflare with `createMcpHandler` (NEW RECOMMENDED)

Use `createMcpHandler` for stateless Workers without Durable Objects:

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpHandler, getMcpAuthContext, WorkerTransport } from "@cloudflare/agents";
import { z } from "zod";

// Create MCP server with all tools
const server = new McpServer({ name: "fantasy-baseball-mcp", version: "4.0.0" });

// Register tools
server.registerTool("get_user_session", {
  title: "User Session",
  description: "Get user session and league data",
  inputSchema: {}
}, async (args, extra) => {
  const authContext = getMcpAuthContext();
  // Access your auth-worker via service binding passed in env
  // ...
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
});

// Custom handler with your auth middleware
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Keep your existing non-MCP routes
    if (url.pathname === '/health') { /* ... */ }
    if (url.pathname === '/onboarding/initialize') { /* ... */ }

    // Custom auth check BEFORE MCP handler
    if (url.pathname === '/mcp') {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader) {
        return yourCustom401Response(); // Keep your _meta handling
      }
    }

    // Delegate to MCP handler
    return createMcpHandler(server, {
      path: '/mcp',
      // Pass env to tools via context
    })(request, env);
  }
};
```

**Benefits**:
- No Durable Objects required (regular Worker billing)
- Native `WorkerTransport` - no `fetch-to-node` needed
- Keep your custom auth middleware
- Stateless by default (each request = new session)

**Considerations**:
- Newer API, less community examples
- Need to verify `getMcpAuthContext()` works with your custom auth

---

## 5. Specific Code That Would Be Replaced

### Completely Removed (SDK handles these)

| Current Code | Location | Lines | SDK Replacement |
|--------------|----------|-------|-----------------|
| `JsonRpcRequest`/`JsonRpcResponse` interfaces | agent.ts:86-102 | 17 | Built-in types |
| `handleJsonRpc()` routing | agent.ts:249-331 | 82 | Transport + McpServer |
| `handleInitialize()` | agent.ts:336-348 | 12 | Auto-generated |
| `handleToolsList()` | agent.ts:353-356 | 4 | `server.getTools()` |
| `jsonRpcSuccess()`/`jsonRpcError()` | agent.ts:493-517 | 25 | Auto-formatted |
| Tool definitions object | agent.ts:522-658 | 136 | `registerTool()` with Zod |

### Must Keep/Adapt

| Current Code | Why |
|--------------|-----|
| `authWorkerFetch()` | Service binding logic |
| `fetchUserLeagues()` | Business logic |
| `executeTool()` switch statement | Becomes individual `registerTool` handlers |
| `getEspnLeagueInfo()`, etc. | Tool implementations (unchanged) |
| Custom 401 with `_meta` | OpenAI ChatGPT-specific OAuth flow |

---

## 6. New Dependencies Required

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.x",
    "zod": "^3.25",
    // If using Option B:
    "hono": "^4.x",
    "fetch-to-node": "^1.x"
  }
}
```

### Bundle Size Impact

| Package | Size (approx) |
|---------|---------------|
| @modelcontextprotocol/sdk | ~150KB |
| zod | ~60KB |
| hono | ~30KB |
| fetch-to-node | ~15KB |

---

## 7. Migration Effort Assessment

### Phase 1: Shared Base Class (Low risk)

Create a shared base that both workers extend:

```
workers/shared/
├── mcp-base.ts      # Protocol handling extracted
├── mcp-auth.ts      # Auth middleware
└── types.ts         # Shared interfaces
```

**Effort**: 1-2 days
**Risk**: Low

### Phase 2: SDK Integration (Medium risk)

Replace protocol handling with SDK:

1. Add dependencies
2. Migrate tool definitions to `registerTool()` with Zod
3. Create custom transport adapter for Workers
4. Test thoroughly (protocol edge cases)

**Effort**: 3-5 days per worker
**Risk**: Medium (transport compatibility)

### Phase 3: Deduplication (Low risk)

Extract sport-agnostic patterns:

```typescript
// workers/shared/mcp-server.ts
export function createMcpServer(sport: 'baseball' | 'football', env: Env) {
  const server = new McpServer({ name: `fantasy-${sport}-mcp`, version: '4.0.0' });
  registerCommonTools(server, sport, env);
  return server;
}
```

**Effort**: 1-2 days
**Risk**: Low

---

## 8. Recommendations

### Short-Term (Next Sprint)

1. **Extract shared code first** - Create `workers/shared/` with common interfaces, auth helpers, and logging. This is valuable regardless of SDK adoption.

2. **Prototype Option A** - Try minimal SDK adoption on one worker (baseball). Keep your auth handling, just replace tool registration.

### Medium-Term

3. **Evaluate transport stability** - The mcp-hono-stateless approach with `fetch-to-node` works but adds a conversion layer. Monitor for edge cases with SSE streaming.

4. **Consider Zod migration benefits** - Even without full SDK, switching to Zod schemas gives you runtime validation and auto-generated TypeScript types.

### Not Recommended Now

- **Cloudflare Agents SDK (McpAgent)** - Still maturing, Durable Objects add complexity, timeout issues reported
- **Full rewrite to Hono** - Your current Express-less approach works fine

---

## 9. Code Reduction Summary

| Approach | Lines Removed | New Lines | Net Change | Complexity | Recommended? |
|----------|---------------|-----------|------------|------------|--------------|
| Option A (Minimal) | ~400 | ~150 | **-250** | Low | Good start |
| Option B (Full Hono) | ~700 | ~200 | **-500** | Medium | If portable |
| Option C (CF Agents McpAgent) | ~800 | ~300 | **-500** | High | Not now |
| **Option D (createMcpHandler)** | ~700 | ~150 | **-550** | **Low-Medium** | **✅ BEST** |

**Revised Recommendation**: Start with **Option D** (`createMcpHandler`) on the baseball worker:
- Native Cloudflare transport (no shims)
- No Durable Objects overhead
- Keep your custom 401 auth flow
- Zod-based type safety
- Clean migration path

---

## 10. Key Resources

### Official SDK Documentation
- [TypeScript SDK Repository](https://github.com/modelcontextprotocol/typescript-sdk) - Version 1.25.x
- [npm Package](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- [Server Documentation](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md)
- [SDK Releases & Changelog](https://github.com/modelcontextprotocol/typescript-sdk/releases)
- [MCP Spec Changelog (2025-11-25)](https://modelcontextprotocol.io/specification/2025-11-25/changelog)

### Cloudflare Workers Integration
- [Cloudflare MCP Docs](https://developers.cloudflare.com/agents/model-context-protocol/)
- [createMcpHandler API Reference](https://developers.cloudflare.com/agents/model-context-protocol/mcp-handler-api/)
- [WorkerTransport Documentation](https://developers.cloudflare.com/agents/model-context-protocol/transport/)
- [MCP Tools Registration](https://developers.cloudflare.com/agents/model-context-protocol/tools/)
- [Build Remote MCP Server Guide](https://developers.cloudflare.com/agents/guides/remote-mcp-server/)
- [Cloudflare Blog: Remote MCP Servers](https://blog.cloudflare.com/remote-model-context-protocol-servers-mcp/)
- [Node.js Compatibility in Workers (2025)](https://blog.cloudflare.com/nodejs-workers-2025/)

### Authentication & OAuth
- [MCP Authorization Spec](https://modelcontextprotocol.io/specification/draft/basic/authorization) - RFC 9728
- [Auth Context in Tool Handlers (Issue #171)](https://github.com/modelcontextprotocol/typescript-sdk/issues/171) - RESOLVED
- [AuthInfo in RequestHandlerExtra (Issue #397)](https://github.com/modelcontextprotocol/typescript-sdk/issues/397) - RESOLVED
- [MCP Auth Implementation Guide](https://stytch.com/blog/MCP-authentication-and-authorization-guide/)

### Examples & Patterns
- [Example Remote Server](https://github.com/modelcontextprotocol/example-remote-server)
- [mcp-hono-stateless](https://github.com/mhart/mcp-hono-stateless) - Stateless Workers with Hono
- [Learn MCP Tutorial](https://learnmcp.examples.workers.dev/)

### Known Issues
- [McpAgent Timeout Issues](https://github.com/cloudflare/agents/issues/640)
- [Zod v4 Compatibility](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1429)

---

## 11. Appendix: SDK Version Compatibility

| SDK Version | Protocol Version | Key Features |
|-------------|------------------|--------------|
| 1.25.x | 2025-11-25 | Latest spec, authInfo in handlers |
| 1.24.x | 2025-11-25 | Framework-agnostic refactor |
| 1.23.x | 2025-06-18 | SSE priming behavior changes |

**Zod Compatibility**: SDK uses `zod/v4` internally but works with `zod@3.25+`. Avoid `zod@3.23.x` due to type mismatches.
