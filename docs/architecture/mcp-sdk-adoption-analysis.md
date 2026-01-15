# Architectural Analysis: Adopting @modelcontextprotocol/sdk

**Date**: 2026-01-15
**Status**: Investigation Complete
**Author**: Claude (Architecture Analysis)

## Executive Summary

Adopting the official MCP SDK would **replace approximately 600-800 lines of protocol boilerplate per worker** while gaining automatic spec compliance, better type safety, and official transport implementations. However, there are **significant complexity considerations** for your Cloudflare Workers environment with OAuth integration.

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

### Tool Registration with SDK

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
  async ({ leagueId, seasonId }) => {
    const result = await getEspnLeagueInfo(...);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  }
);
```

---

## 3. Cloudflare Workers Compatibility

### Official Support Exists

Cloudflare has **first-class MCP support** as of 2025:

- Cloudflare Agents SDK provides `McpAgent` class
- Streamable HTTP transport works in serverless mode
- `mcp-hono-stateless` demonstrates stateless Workers deployment

### Challenge: The SDK Wasn't Built for Serverless

The official SDK uses Node.js-style streams, requiring adaptations:

```typescript
// Required adapter for Workers: fetch-to-node
import { toFetchResponse, toReqRes } from 'fetch-to-node';

app.post('/mcp', async (c) => {
  const { req, res } = toReqRes(c.req.raw);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, await c.req.json());
  return toFetchResponse(res);
});
```

### Your Specific Challenges

| Your Feature | SDK Support | Complexity |
|--------------|-------------|------------|
| Custom OAuth via `_meta["mcp/www_authenticate"]` | Partial | High - SDK expects standard OAuth flow |
| Service bindings to auth-worker | Not built-in | Medium - pass through context |
| Legacy REST endpoints (`/mcp/tools/list`) | You maintain | Low |
| Onboarding/discovery endpoints | Separate concern | Low |
| Sport-specific tool normalization | In tool handlers | Low |

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

| Approach | Lines Removed | New Lines | Net Change | Complexity |
|----------|---------------|-----------|------------|------------|
| Option A (Minimal) | ~400 | ~150 | **-250** | Low |
| Option B (Full Hono) | ~700 | ~200 | **-500** | Medium |
| Option C (CF Agents) | ~800 | ~300 | **-500** | High |

**Recommendation**: Start with **Option A** on the baseball worker. The minimal adoption gives you:
- Zod-based type safety
- Automatic protocol compliance
- A path to full adoption later
- Minimal disruption to your working OAuth flow

---

## 10. Key Resources

- [TypeScript SDK Repository](https://github.com/modelcontextprotocol/typescript-sdk)
- [npm Package](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- [Server Documentation](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md)
- [Example Remote Server](https://github.com/modelcontextprotocol/example-remote-server)
- [mcp-hono-stateless](https://github.com/mhart/mcp-hono-stateless) - Stateless Workers pattern
- [Cloudflare MCP Docs](https://developers.cloudflare.com/agents/model-context-protocol/)
- [Cloudflare Agents Issue #640](https://github.com/cloudflare/agents/issues/640) - McpAgent timeout issues
- [MCP Authorization Tutorial](https://modelcontextprotocol.io/docs/tutorials/security/authorization)
