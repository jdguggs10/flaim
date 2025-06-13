# OpenAI Responses API & MCP Tools — Implementation Guide  
*Last updated 2025‑06‑12*

## 1. Key Updates in the Responses API (May 21 2025)

- **Remote MCP server support** — declare any endpoint with `type:"mcp"` and the runtime connects directly, eliminating custom proxy plumbing. 
- **New built‑in tools**:  
  - `gpt‑image‑1` image generation with streaming & multi‑turn edits  
  - `code_interpreter` for data‑analysis & math  
  - upgraded `file_search` (multi‑vector, array filters)  
- **Native tool‑calling in‑thought** for o‑series (o3, o4‑mini) & GPT‑4* models, cutting latency by re‑using reasoning tokens across calls. 
- **Platform features**: background mode (async jobs), reasoning summaries (debuggable chain‑of‑thought), encrypted reasoning items (ZDR‑compliant reuse). 
- **Pricing snapshot** — image gen $5/1M text | $10/1M image in | $40/1M image out; Code Interpreter $0.03/container; file search $0.10/GB/day + $2.50/1k calls; MCP itself is free (only output tokens billed). 

---

## 2. MCP Tool Deep‑Dive

### 2.1 Why MCP?

Traditional function‑calling bounced every action from model → backend → service → backend → model, stacking latency. MCP servers expose a **standard command catalogue** the model can call directly, collapsing hops and orchestration.

### 2.2 Minimal Declaration

```jsonc
{
  "type": "mcp",
  "server_label": "stripe",
  "server_url": "https://mcp.stripe.com",
  "headers": { "Authorization": "Bearer <api‑key>" },
  "allowed_tools": ["create_payment_link"],
  "require_approval": "never"
}


1. **Declare** the server block — transport auto‑detected (HTTP streaming or SSE). 
2. **Tool‑list import** — runtime calls `tools/list`, caches result as `mcp_list_tools`; limit visibility via `allowed_tools`. 
3. **Invoke & approve** — each call yields an `mcp_tool_call`; set `require_approval` to `"never"` in prod once audited. 

### 2.3 Best Practices

| Goal | Technique |
|------|-----------|
| Keep context small | Use `allowed_tools` to whitelist only what you need; many servers expose dozens of verbose schemas. |
| Reduce latency | Pass `previous_response_id` (or the cached items) so `tools/list` isn’t refetched; avoid reasoning models unless necessary. |
| Prevent runaway loops | In your system prompt: ask clarifying Qs when info is missing; cap search results (e.g., 4 items) before continuing. |
| Orchestrate multi‑service flows | Remember MCP is just another `tools[]` entry; you can stack it alongside `code_interpreter`, `web_search_preview`, etc. |

---

## 3. Common Use‑Cases Simplified by MCP

| Domain | Example Workflow | Pre‑MCP Pain |
|--------|------------------|--------------|
| Commerce | “Add Allbirds Tree Dasher 2, size 10” → returns checkout URL in one turn | Custom `cart_add` wrappers & relay server |
| Payments | Generate Stripe payment link | Same |
| Dev‑Ops | Query Sentry error → open GitHub issue with suggested fix | Webhook glue & state juggling |
| Notifications | Summarize soccer headlines, text via Twilio | Manual batching & SMS payload |

---

## 4. Implementation Checklist

1. Model each external service as an MCP server; group by domain (payments, CRM, internal microservice).  
2. Whitelist endpoints via `allowed_tools`; review/write actions separately.  
3. Use `require_approval:"manual"` in staging, flip to `"never"` post‑security review.  
4. Persist `previous_response_id` to reuse context (cached `mcp_list_tools` & reasoning tokens).  
5. Switch on **background mode** for tasks > 30 s.  
6. Log `reasoning.summary` for debugging; drop or encrypt in production for privacy.  
7. Enable encrypted reasoning items (`store:false`, `include:["reasoning.encrypted_content"]`) when you need Zero Data Retention. 

---

## 5. Further Reading

- OpenAI blog: *“New tools and features in the Responses API”* (May 21 2025).  
- Cookbook: *“Guide to Using the Responses API’s MCP Tool”* (May 21 2025).  
- The Verge interview on the transition from Assistants API to Responses API.

## 6. June 2025 Updates & Cloudflare MCP Authentication Guide  

### 6.1 Responses API — Key Changes (June 2025)  
- **o3‑pro reasoning model** released (June 5) with ~15‑20% lower latency and +8% win‑rate versus standard o3.  
- **Chain‑of‑thought token reuse** is now automatic when you pass `previous_response_id`, even across background jobs.  
- **Encrypted reasoning items** can now be *replayed* across requests when `store:false` so long as you include the encrypted payload in `include`.  
- **Background mode default timeout** raised to 15 min. Use this for long‑running MCP chains or code‑interpreter sessions.  
- **Pricing tweaks**: `gpt‑image‑1` text tokens now $4/1M (down from $5); Code Interpreter container $0.025/run.  

### 6.2 `previous_response_id` & Latency Optimization  
```bash
# pattern to chain calls while re‑using cached mcp_list_tools
response = client.responses.create(
  model="o3-pro",
  previous_response_id=prev.id,  # ← carry context
  tools=[…],
  input="continue the workflow…"
)
```
Use this pattern to avoid re‑fetching `tools/list`; latency savings are 200‑400 ms per remote MCP server.

### 6.3 Remote MCP Quick‑Start Recap  
```jsonc
{
  "type": "mcp",
  "server_label": "stripe",
  "server_url": "https://mcp.stripe.com",
  "headers": { "Authorization": "Bearer <api-key>" },
  "allowed_tools": ["create_payment_link", "refund"],
  "require_approval": "never"
}
```
Key flags:  
- **`allowed_tools`** – keep payloads lean; prevents tool‑explosion.  
- **`require_approval`** – set to `"manual"` in staging, `"never"` in prod once audited.  

### 6.4 Deploying a Remote MCP Server on Cloudflare Workers (with OAuth)  
1. **Scaffold**  
   ```bash
   npm create cloudflare@latest my-mcp-server \
     --template=cloudflare/ai/demos/remote-mcp-authless
   cd my-mcp-server && npm start         # local SSE at :8787/sse
   ```  
2. **Add GitHub OAuth** (swap for Google, Auth0, etc.)  
   ```ts
   import OAuthProvider from "@cloudflare/workers-oauth-provider";
   import MyMCP from "./mcp";            // your McpAgent subclass
   import GitHubHandler from "./github-handler";

   export default new OAuthProvider({
     apiRoute: "/sse",
     apiHandler: MyMCP.Router,
     defaultHandler: GitHubHandler,      // handles login + token exchange
     authorizeEndpoint: "/authorize",
     tokenEndpoint: "/token",
     clientRegistrationEndpoint: "/register",
   });
   ```  
3. **Deploy**  
   ```bash
   wrangler secret put GITHUB_CLIENT_ID
   wrangler secret put GITHUB_CLIENT_SECRET
   npx wrangler deploy
   ```  
4. **Connect from Responses API**  
   ```json
   {
     "type": "mcp",
     "server_label": "myshop",
     "server_url": "https://my-mcp-server.workers.dev/sse",
     "headers": { "Authorization": "Bearer ${access_token}" }
   }
   ```  

### 6.5 Security Watch‑List  
| Date | Item | Action | Notes |
|------|------|--------|-------|
| 2025‑05‑14 | **workers‑oauth‑provider < 0.0.5** PKCE bypass (GHSA‑4pc9‑x2fx‑p7vj) | **Upgrade to 0.0.5+** | Affects redirect URI validation |
| 2025‑06‑08 | Refresh‑token rotation bug (#43) | Patch pending | Tokens stay valid after rotation – mitigate via short TTL |
| 2025‑04‑30 | `McpAgent` WebSocket‑upgrade bug (#172) | Monitor | Impacts SSE clients; workaround is to pin `@cloudflare/agents` 0.4.3 |

### 6.6 Checklist for Auth‑Enabled MCP Servers  
- [ ] Use HTTPS everywhere (auto on Workers).  
- [ ] Short‑lived access tokens (≤1 h).  
- [ ] Rotate refresh tokens and revoke on logout.  
- [ ] Map OAuth scopes ⟺ tool permissions (`requirePermission()` helper).  
- [ ] Log `context.props.claims.sub` for audit trails; never store full tokens.  

---

## 7. Further Reading

- OpenAI blog: *“New tools and features in the Responses API”* (May 21 2025).  
- Cookbook: *“Guide to Using the Responses API’s MCP Tool”* (May 21 2025).  
- The Verge interview on the transition from Assistants API to Responses API.  
- Cloudflare Docs: *“Build a Remote MCP Server”* (Apr 30 2025)  
- Cloudflare Docs: *“Authorization for MCP Servers”* (May 14 2025)  
- MCP Specification: *OAuth 2.1 Authorization* (Mar 26 2025)  
- GitHub: *workers‑oauth‑provider* security advisory GHSA‑4pc9‑x2fx‑p7vj (May 1 2025)  
- The Verge: *“OpenAI will let other apps deploy its computer‑operating AI”* (Mar 2025)  
