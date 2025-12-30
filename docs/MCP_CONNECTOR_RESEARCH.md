# MCP Connector Research: Direct Access + Cost-Aware Options

> **Status**: ✅ **WORKING** — Claude + ChatGPT direct access via MCP is fully operational as of December 28, 2025.
>
> **Next Phase**: Optional API integrations (Anthropic/Gemini) if needed.
>
> **Purpose**: This document summarizes how to connect Flaim's MCP workers to AI platforms, with emphasis on direct access to shift model costs to end users.
>
> **Definitions**:
> - **Developer**: You, the Flaim maintainer operating the domain, workers, and OAuth flow.
> - **End user**: The person using Claude and connecting your MCP server.
>
> **Last Updated**: December 28, 2025
> **Research Context**: Flaim uses Cloudflare Workers implementing MCP (Model Context Protocol) for ESPN fantasy sports data. Current architecture uses OpenAI Responses API with custom MCP workers.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Two Integration Paths](#two-integration-paths)
3. [Current Flaim Architecture](#current-flaim-architecture)
4. [Direct Access (Claude + ChatGPT) Implementation Notes](#direct-access-claude--chatgpt-implementation-notes)
5. [Implementation Phases](#next-steps-phased)
   - [Phase 6: OpenAI ChatGPT Integration](#phase-6--openai-chatgpt-integration-implemented)
6. [References](#references)

---

## Executive Summary

### Strategic Pivot: API vs. Direct Access

Research identified **two distinct integration paths**. A strategic review against **Solo Developer Guidelines** initially favored **API Integration**, but ongoing token costs make **Direct User Access** a meaningful option to offload usage costs to users. The recommendation below reflects a cost-aware, staged approach.

| Path | Description | Verdict |
|------|-------------|---------|
| **Path A: API Integration** | Your backend calls AI APIs (Claude/Gemini) | **RECOMMENDED**. Aligns with current architecture. Low effort (2-4h). |
| **Path B: Direct User Access** | Users connect from Claude.ai/ChatGPT/Gemini apps | **OPTIONAL**. Cost-shifting benefits, but requires public OAuth support and higher support burden. Claude + ChatGPT are supported; Gemini is blocked. |

### Strategic Divergence & Analysis

*   **Claude's Research Findings**: Correctly identified that Path B is *technically feasible* on Anthropic/Gemini without Dynamic Client Registration (DCR), making it simpler than OpenAI. The research argued for Path B primarily to shift AI costs to the user's subscription.
*   **Cost Pressure**: At modest user counts, per-token costs can become a material monthly expense. This makes a "bring your own Claude account" option attractive despite added OAuth and support complexity.
*   **Architectural Counter-Argument**: Path B fundamentally changes Flaim from a "Web App" to a "Public API Provider."
    *   **Risk**: You lose control over the UI/UX. Debugging user issues inside a 3rd-party chat interface (where you cannot see logs or errors easily) creates a high support burden.
    *   **Complexity**: Requires Clerk to act as a robust OAuth provider for external clients, introducing edge cases (token audience, scope validation) not present in the current internal-only JWT flow.
    *   **Guideline Violation**: This violates the "Solo Developer Guidelines" to favor "boring, stable solutions" and "avoid over-engineering."

### Revised Recommendation (Updated December 28, 2025)

| Priority | Integration | Platform | Effort | Status |
|----------|-------------|----------|--------|--------|
| **1st** | **Direct Access** | **Anthropic Claude** | **Done** | ✅ **WORKING** — Verified 2025-12-28 |
| **2nd** | **Direct Access** | **OpenAI ChatGPT** | **Done** | ✅ **WORKING** — Verified 2025-12-28 |
| 3rd | API Integration | Anthropic/Gemini | 2-4 hours | Backend redundancy; keeps user in your UI. |
| 4th | Direct Access | Google Gemini | Blocked | Gemini CLI has [discovery bug](https://github.com/google-gemini/gemini-cli/issues/12628). Wait for fix. |

### Monetization Option: Split Access by Cost

To manage token costs, consider offering **two access tiers**:
- **Paid tier**: End users use the full Flaim app with your API keys (you pay tokens), including richer UI and support.
- **Free tier**: End users use Claude/ChatGPT direct access (BYO subscription) to generate interest while shifting model cost to users.
This keeps a controlled, premium experience for paying users while providing a lower-cost acquisition path.

### Minimum Flaim Domain UI for Direct Access

Even with Claude as the chat UI, you (the developer) still need a small web surface for end users:
- **Sign in / account**: Clerk login so you can tie a Claude connection to a real user.
- **ESPN credentials**: Form to enter SWID and espn_s2; stored in Supabase.
- **League selection**: Choose league IDs and team to avoid ambiguous tool calls.
- **Connectors page**: Button to start Claude/ChatGPT OAuth, plus status (connected/disconnected).
- **Consent screen**: "Allow Claude to access your Flaim data" before redirecting back to Claude.
- **Disconnect / revoke**: Allow users to revoke Claude access and rotate tokens.
- **Plan messaging**: Explain free direct access vs paid in-app chat (cost rationale).
- **Support / troubleshooting**: Basic guidance when Claude says "connector failed."

### OAuth Flow Ownership (Developer vs End User)

```
End User (Claude/ChatGPT UI)  Your Domain (Developer UI)         Your Backend (Developer)
────────────────────         ─────────────────────────         ─────────────────────────
1) Add connector URL   ───▶   2) Sign in with Clerk       ───▶   3) Create auth code
                             4) Consent screen                 5) Issue token
6) Client exchanges code ─▶                                    7) Validate token on MCP calls
```

Notes:
- End users initiate the connector from Claude or ChatGPT.
- You (the developer) must host the login + consent flow and issue tokens.
- Your MCP servers must validate the token and map to the correct user.

Suggested route layout (developer-owned):
- `GET /connectors`: Show Claude connection status, MCP URLs, and setup instructions.
- `GET /authorize`: OAuth start; redirects to Clerk login + consent screen.
- `POST /token`: Exchange code for access token (Claude calls this).
- `POST /revoke`: Disconnect Claude and invalidate tokens.
- `POST /auth/oauth/code`: Internal API for frontend to get auth code after consent.
- `GET /auth/oauth/status`: Internal API for frontend connection status.
- `POST /auth/oauth/revoke-all`: Internal API to revoke all tokens for a user (UI disconnect).
- `GET /settings/espn`: SWID/espn_s2 entry and league selection.

Note: `/revoke` is the OAuth spec endpoint used by Claude/ChatGPT. `/auth/oauth/revoke-all` is an internal admin endpoint for the Flaim UI to disconnect all tokens.

Minimal data model (developer-owned):
- `oauth_codes`: one-time auth codes issued after consent.
  - `code` (string, random)
  - `user_id` (Clerk user id)
  - `expires_at` (short TTL, e.g., 5-10 min)
- `oauth_tokens`: access tokens used by Claude to call MCP.
  - `token` (string, random or signed JWT)
  - `user_id` (Clerk user id)
  - `scopes` (optional, e.g., `mcp:read`)
  - `expires_at` (short TTL, e.g., 1-24 hours)
  - `revoked_at` (nullable)

Token validation flow (developer-owned):
- MCP worker receives `Authorization: Bearer <token>` from Claude.
- Worker calls auth-worker to validate token + map to `user_id`.
- Auth-worker checks `oauth_tokens` (or verifies JWT), enforces expiry/revocation, and returns `user_id`.
- MCP worker uses `user_id` to fetch ESPN credentials/league data from Supabase.

Lightweight security checklist (reasonable for a fantasy sports app):
- Short token TTLs + revoke on disconnect.
- Basic rate limits per user to prevent abuse or runaway loops.
- Minimal logging of token usage (user_id + timestamp).
- Optional Claude IP allowlisting if you want to block non-Claude clients.

### Compatibility Summary (Updated December 28, 2025)

| Platform | Direct Access Auth | Flaim Status | Notes |
|----------|-------------------|--------------|-------|
| **Anthropic Claude** | OAuth 2.1 + DCR | ✅ **Working** | Verified 2025-12-28 |
| **OpenAI ChatGPT** | OAuth 2.1 + DCR + `securitySchemes` | ✅ **Working** | Verified 2025-12-28 |
| **Google Gemini CLI** | OAuth 2.1 + DCR | ❌ **Blocked** | Their CLI has [discovery bug #12628](https://github.com/google-gemini/gemini-cli/issues/12628) |

---

## Two Integration Paths

### Path A: API Integration (Your Backend Calls AI APIs)

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Your App   │────▶│  Your API   │────▶│  AI API     │────▶│  MCP Worker │
│  (Clerk)    │     │  Route      │     │  (Claude/   │     │             │
└─────────────┘     └─────────────┘     │  Gemini)    │     └─────────────┘
                                        └─────────────┘
```

- **You pay** for AI API usage
- **Simple auth**: Pass Clerk JWT as `authorization_token`
- **Effort**: 2-4 hours
- **User experience**: Users interact through your app

### Path B: Direct User Access (Users Connect from AI Apps)

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Claude.ai  │────▶│  Flaim      │────▶│  MCP Worker │
│  or Desktop │     │  OAuth      │     │             │
└─────────────┘     └─────────────┘     └─────────────┘
```

- **Users pay** via their Claude Pro/Gemini subscription
- **OAuth required**: Must identify user to load their ESPN credentials
- **Effort**: 2-4 days
- **User experience**: End users interact through Claude/Gemini directly
- **Still need Flaim UI**: You (the developer) must host a small account/consent UI on your domain so end users can (a) connect Claude via OAuth, (b) manage connector status, and (c) enter SWID/espn_s2 to store in Supabase. Claude cannot capture these credentials directly.

---

## Current Flaim Architecture

### Existing Components

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Next.js App    │────▶│  OpenAI         │────▶│  MCP Workers    │
│  (Clerk Auth)   │     │  Responses API  │     │  (Cloudflare)   │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                                              │
        │ Clerk JWT                                    │
        └──────────────────────────────────────────────┘
                    Authorization: Bearer <jwt>
```

### MCP Workers

| Worker | Endpoint | Tools |
|--------|----------|-------|
| `baseball-espn-mcp` | `https://api.flaim.app/baseball/mcp` | `get_espn_league_info`, `get_espn_team_roster`, `get_espn_matchups` |
| `football-espn-mcp` | `https://api.flaim.app/football/mcp` | `get_espn_football_league_info`, `get_espn_football_team`, `get_espn_football_matchups`, `get_espn_football_standings` |
| `auth-worker` | `https://api.flaim.app/auth/*` | Credential/league storage, JWT validation |

### Current MCP Implementation

- **Transport**: Streamable HTTP (JSON-RPC 2.0 at `POST /mcp`)
- **Methods**: `initialize`, `tools/list`, `tools/call`, `ping`
- **Auth**: Clerk JWT validated via JWKS in auth-worker
- **Credential Flow**: MCP workers call auth-worker to fetch ESPN credentials per user

---

## Direct Access (Claude + ChatGPT) Implementation Notes

### Phase 0 Verified Details (December 22, 2025)

The following details were verified against official Claude documentation and MCP specs:

**OAuth Callback URLs** (allowlist both) [Source: Claude Support](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp):
```
https://claude.ai/api/mcp/auth_callback   (current)
https://claude.com/api/mcp/auth_callback  (future)
```

**Note**: The `localhost:6274` callbacks are for **Claude Code CLI only**, not Claude.ai/Desktop.

**OAuth Specification**:
- **OAuth 2.1** with **PKCE (S256) MANDATORY** for all clients.
- Authorization Code grant for end users.
- **Dynamic Client Registration (RFC 7591) REQUIRED** for MCP clients like Claude Desktop.
- **Header Required**: `MCP-Protocol-Version: 2025-03-26` (Client must send this; server should default to it if missing). [Source: MCP Spec](https://modelcontextprotocol.io/specification/2025-03-26)

**OAuth Discovery Chain** (per RFC 9728 + RFC 8414):

1. MCP server returns `401 Unauthorized` on connect with:
   ```
   WWW-Authenticate: Bearer resource_metadata="https://api.flaim.app/football/.well-known/oauth-protected-resource"
   ```

2. Claude fetches **Protected Resource Metadata** (RFC 9728) from the MCP server:
   ```
   GET https://api.flaim.app/football/.well-known/oauth-protected-resource
   ```
   Returns: `authorization_servers`, `scopes_supported`, etc.

3. Claude fetches **Authorization Server Metadata** (RFC 8414) from the auth server:
   ```
   GET https://api.flaim.app/.well-known/oauth-authorization-server
   ```
   Returns: `authorization_endpoint`, `token_endpoint`, `registration_endpoint`, etc.

4. Claude uses **Dynamic Client Registration** (RFC 7591):
   ```
   POST https://api.flaim.app/auth/register
   ```
   Returns: `client_id`, `grant_types`, etc.

5. Claude starts OAuth Authorization Code flow with PKCE.

**Required OAuth Endpoints** (Flaim implementation):
| Endpoint | Path | Purpose |
|----------|------|---------|
| Protected Resource Metadata | `/{sport}/.well-known/oauth-protected-resource` | Points to auth server |
| Authorization Server Metadata | `/.well-known/oauth-authorization-server` | OAuth server discovery |
| Client Registration | `/auth/register` or `/register` | Dynamic client registration |
| Authorization | `/auth/authorize` | User consent flow + redirect |
| Token | `/auth/token` | Code → token exchange |
| Revocation | `/auth/revoke` | Token revocation (RFC 7009) |

**Note on Fallback URLs**: The MCP spec defines fallback paths if metadata discovery fails:
- `/authorize`, `/token`, `/register` at the authorization base URL.
- Flaim supports both `/auth/*` prefixed and base paths.

**Claude Outbound IPs** (for optional allowlisting) [Source: Claude Docs](https://docs.anthropic.com/en/docs/resources/ip-addresses):
```
160.79.104.0/21  (IPv4)
2607:6bc0::/32   (IPv6)
```

**Transport**: Streamable HTTP is current standard; SSE deprecated but supported.

**Loopback Redirect URIs**: Claude Desktop uses dynamic loopback URIs (e.g., `http://127.0.0.1:<PORT>/callback`). Per RFC 8252, these must be validated by host/path only, ignoring port.

**DCR Client Deletion Signal**: Return HTTP 401 with `invalid_client` error from token endpoint to trigger re-registration.

### Implementation Notes

- Claude custom connectors allow you to add a remote MCP URL; OAuth client ID/secret are supported for authenticated servers.
- OAuth is required to map a Claude request to a specific end user (for ESPN credentials).
- Use public HTTPS MCP endpoints (e.g., `https://api.flaim.app/{sport}/mcp`) that speak JSON-RPC 2.0 (`POST /mcp`).
- **Critical**: Worker-to-worker calls MUST use `.workers.dev` URLs (e.g., `auth-worker.gerrygugger.workers.dev`). Custom domain (`api.flaim.app`) causes 522 timeouts for intra-zone Cloudflare requests.
- Auth-worker should support **two token types**: Clerk JWT (in-app) and OAuth access token (Claude).
- Claude sends `Authorization: Bearer <token>` on MCP calls after OAuth.

## Next Steps (Phased)

### Phase 0: Verify Claude Connector Docs (Up-to-Date)

Status: Complete (December 22, 2025).

Before coding, use Context7 to pull the latest Claude connector guidance:
- Run Context7 queries for "custom connectors", "remote MCP", and "OAuth".
- Confirm current OAuth callback URLs and any required headers or beta flags.

### Phase 1: OAuth + Token Validation (Core Access)

Status: Complete (December 22, 2025).

1) **Create OAuth endpoints** (`/authorize`, `/token`, `/revoke`) that issue opaque tokens stored in Supabase.
2) **Store auth state** in Supabase (`oauth_codes`, `oauth_tokens`) with TTL + revoke support.
3) **Validate tokens** in auth-worker and return `user_id` to MCP workers (no fallback user).

### Phase 2: Minimum UI (User Setup)

Status: Complete (December 22, 2025).

4) **Build minimal UI** (`/connectors`, `/settings/espn`) for login, consent, ESPN cookies, league selection, and connector status.
5) **Expose management endpoints** for the connectors UI (`/auth/oauth/status`, `/auth/oauth/revoke-all`) to check status and disconnect.

### Phase 3: Safety + Verification (Hardening)

Status: Complete (December 27, 2025).

6) **Add rate limits + logs** (per-user call cap + request_id logging).
7) **Test end-to-end** in Claude Desktop: connect → consent → tool call → revoke.

**Implementation Details:**
- Rate limit: 200 calls/day per user, enforced in auth-worker (`RATE_LIMIT_PER_DAY`)
- Rate limit headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`
- Rate limit storage: `rate_limits` table with SQL RPC function for atomic increment
- 429 response with clear error message and reset time when limit exceeded

### Phase 4: MCP OAuth 2.1 Compliance (December 27, 2025)

Status: Complete.

8) **Protected Resource Metadata (RFC 9728)**: Added `/.well-known/oauth-protected-resource` endpoint to MCP workers.
9) **Dynamic Client Registration (RFC 7591)**: Added `/register` endpoint for Claude Desktop to obtain `client_id`.
10) **401 on Connect**: MCP workers now return 401 Unauthorized on ANY unauthenticated request (including `initialize`).
11) **WWW-Authenticate Header**: Points to Protected Resource Metadata URL.
12) **Loopback Redirect URIs**: Added support for Claude Desktop's dynamic `http://127.0.0.1:<PORT>/callback` patterns.

**Key Files Modified:**
- `workers/auth-worker/src/oauth-handlers.ts`: Added DCR handler, updated metadata
- `workers/auth-worker/src/index.ts`: Added `/register` route
- `workers/auth-worker/wrangler.jsonc`: Added route for `/register`
- `workers/football-espn-mcp/src/index.ts`: Added Protected Resource Metadata endpoint
- `workers/baseball-espn-mcp/src/index.ts`: Added Protected Resource Metadata endpoint
- `workers/*/src/mcp/agent.ts`: Moved 401 check before method routing

---

## End-to-End Testing Guide

### Prerequisites
1. Flaim app deployed to production or preview environment
2. ESPN credentials configured in Flaim (`/settings/espn`)
3. At least one league with a team selected
4. Claude Pro subscription (for Claude.ai) or Claude Desktop app

### Test 1: OAuth Flow (Connect)

**Steps:**
1. Open Claude.ai or Claude Desktop
2. Navigate to Settings → Integrations (or MCP Servers)
3. Click "Add Connector" or "Add MCP Server"
4. Enter the MCP URL: `https://api.flaim.app/football/mcp` (or `/baseball/mcp`)
5. Claude should redirect to `https://flaim.app/oauth/consent`
6. Sign in with Clerk if not already authenticated
7. Verify the consent screen shows:
   - "Authorize Claude" header
   - List of permissions (view league info, rosters, matchups)
   - Scope badge (`mcp:read`)
8. Click "Allow"
9. Verify redirect back to Claude with success

**Expected Result:** Claude shows the connector as connected.

### Test 2: Tool Calls

**Steps:**
1. In Claude, ask: "What's my fantasy football team's record?"
2. Observe Claude making MCP tool calls

**Expected Result:** Claude returns your team's current record and standings.

**Additional Queries to Test:**
- "Show me this week's matchup"
- "Who's on my roster?"
- "What are the league standings?"

### Test 3: Rate Limiting

**Steps:**
1. Make many rapid requests (or check current usage in Supabase `rate_limits` table)
2. After 200 calls in a day, the next request should fail

**Expected Result:** 429 response with message about limit and reset time.

### Test 4: Token Expiry

**Steps:**
1. Wait for access token to expire (1 hour) or manually update `expires_at` in Supabase
2. Try a tool call in Claude

**Expected Result:** Claude should automatically refresh the token using the refresh token, or prompt for re-authentication if refresh token is also expired (7 days).

### Test 5: Revocation

**Steps:**
1. Go to `https://flaim.app/connectors`
2. Click "Disconnect" on the Claude connection
3. Return to Claude and try a tool call

**Expected Result:** Tool call fails with authentication error. User must re-authorize.

### Test 6: Reconnect After Revoke

**Steps:**
1. After revoking (Test 5), add the connector again in Claude
2. Complete the OAuth flow

**Expected Result:** Successfully reconnects and tool calls work again.

### Verification Checklist

| Test | Status | Notes |
|------|--------|-------|
| OAuth flow completes | ✅ | Verified 2025-12-28 |
| Consent screen displays correctly | ✅ | |
| Tool calls return data | ✅ | Fixed worker-to-worker routing |
| Rate limit enforced at 200/day | ✅ | |
| Token refresh works | ☐ | Low priority - test when convenient |
| Revocation stops access | ☐ | Low priority - test when convenient |
| Reconnect after revoke works | ☐ | Low priority - test when convenient |

> **Note**: Remaining tests are validation of already-implemented functionality. Not blocking; complete when convenient.

---

## Structured Logging Recommendations (Future Enhancement)

For production debugging, consider adding structured request logging with the following fields:

### Proposed Log Schema

```typescript
interface MCPRequestLog {
  // Request identification
  request_id: string;      // UUID for tracing
  timestamp: string;       // ISO 8601
  
  // User context
  user_id: string;         // Masked: "user_abc1..." 
  auth_type: 'clerk' | 'oauth';
  
  // Request details
  method: string;          // MCP method: 'tools/call', 'tools/list', etc.
  tool_name?: string;      // For tools/call: 'get_espn_league_info', etc.
  sport: 'baseball' | 'football';
  
  // Response details
  status: 'success' | 'error' | 'rate_limited';
  duration_ms: number;
  error_code?: string;     // If error
  
// Rate limit context
  rate_limit_remaining?: number;
}
```

### Implementation Approach

1. **Add request ID generation** at entry point of each MCP worker
2. **Pass request ID through** to auth-worker calls
3. **Log at key points:**
   - Request received (with parsed method/tool)
   - Auth validation result
   - ESPN API call start/end
   - Response sent
4. **Use Cloudflare Logpush** to export logs to external service (optional)

### Log Query Examples

```sql
-- Find all failed requests for a user
SELECT * FROM logs 
WHERE user_id LIKE 'user_abc1%' 
AND status = 'error'
ORDER BY timestamp DESC;

-- Check rate limit hits
SELECT user_id, COUNT(*) as hits
FROM logs
WHERE status = 'rate_limited'
AND timestamp > NOW() - INTERVAL '24 hours'
GROUP BY user_id;

-- Slow requests
SELECT * FROM logs
WHERE duration_ms > 5000
ORDER BY duration_ms DESC;
```

---

## Common Errors & Troubleshooting

### User-Facing Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "No ESPN credentials found" | User hasn't set up ESPN cookies | Go to `/settings/espn` and add SWID + espn_s2 |
| "No leagues configured" | User hasn't selected a league/team | Complete onboarding or visit `/settings/espn` |
| "Rate limit exceeded" | 200 calls/day limit reached | Wait until midnight UTC for reset |
| "Token expired" | Access token expired and refresh failed | Disconnect and reconnect Claude |
| "Authentication required" | Invalid or missing token | Reconnect Claude via OAuth |

### Developer Debugging

| Symptom | Check | Fix |
|---------|-------|-----|
| OAuth redirect fails | Wrangler routes include `/authorize`, `/token`, `/register` | Verify `wrangler.jsonc` prod routes |
| Claude shows "authentication error" | Protected Resource Metadata not found | Verify `/.well-known/oauth-protected-resource` returns correctly |
| DCR fails | Registration endpoint not routed | Add `/register` route to wrangler.jsonc |
| 401 on tool calls | Token validation in auth-worker | Check `oauth_tokens` table, verify not revoked/expired |
| 500 on ESPN calls | ESPN credentials in Supabase | Verify `espn_credentials` table has valid SWID/s2 |
| CORS errors | `ALLOWED_ORIGINS` in workers | Add missing origin to allowlist |
| **522 timeout / "No leagues"** | **MCP workers calling auth-worker via custom domain** | **Use `.workers.dev` URL for `AUTH_WORKER_URL` (critical fix!)** |
| Worker-to-worker timeout | Using custom domain for internal calls | Use `.workers.dev` URL, ensure `workers_dev: true` |
| Claude loopback redirect rejected | Loopback URI validation | Verify `isLoopbackRedirectUri` function in oauth-handlers.ts |

### Useful Supabase Queries

```sql
-- Check if user has active OAuth token
SELECT * FROM oauth_tokens 
WHERE user_id = 'user_xxx' 
AND revoked_at IS NULL 
AND expires_at > NOW();

-- Check user's rate limit usage today
SELECT * FROM rate_limits 
WHERE user_id = 'user_xxx' 
AND window_date = CURRENT_DATE;

-- List all active connections
SELECT user_id, created_at, expires_at 
FROM oauth_tokens 
WHERE revoked_at IS NULL 
AND expires_at > NOW()
ORDER BY created_at DESC;
```

---

## Documentation Guidance

- Keep `/connectors` and `/settings/espn` self-serve with short, direct copy.
- Add a short "How to connect Claude" step list with screenshots later (optional).
- Include "common errors" and fixes: expired ESPN cookies, revoked connector, rate limit hit.
- Remind end users that Claude/ChatGPT direct access is BYO subscription and support is limited.

---

## Implementation Tasks (AI Agent Checklist)

### Phase 1 — Auth + Tokens ✅

- [x] Create `oauth_codes` table: `code`, `user_id`, `expires_at`.
- [x] Create `oauth_tokens` table: `token`, `user_id`, `scopes`, `expires_at`, `revoked_at`.
- [x] Implement `/authorize`: Clerk login, consent screen, issue one-time `code`.
- [x] Implement `/token`: exchange `code` for `token` (opaque), return `access_token`.
- [x] Implement `/revoke`: mark token revoked and clear connector status.
- [x] Auth-worker: add token validation endpoint (token → `user_id`).
- [x] MCP workers: require `Authorization: Bearer <token>` for direct access.
- [x] Enforce default league + team on server side (don't rely on Claude).
- [x] Return clear tool errors with a link to `/settings/espn` when credentials are missing.
- [x] Implement `/auth/oauth/status` and `/auth/oauth/revoke-all` for UI status + disconnect.

### Phase 2 — UI Surfaces (Developer Domain) ✅

- [x] `/connectors`: show Claude connection status; "Connect Claude" button; "Disconnect".
- [x] `/settings/espn`: SWID + espn_s2 form; league selection + default team.
- [x] Consent screen: "Claude will access your ESPN data via Flaim."
- [x] Plan messaging: Paid in-app chat vs free Claude connector (BYO tokens).
- [x] Persist default league/team in Supabase so Claude requests always resolve without frontend state.

### Phase 3 — Cost + Safety ✅

- [x] Add per-user call caps (e.g., 200 tool calls/day) with friendly error.
- [ ] Log `request_id`, `user_id`, `tool_name`, and status for debugging. *(Basic logging exists; structured logging is a future enhancement)*
- [x] Keep tool output compact (summary-first; expand only when requested).

### Phase 4 — MCP OAuth 2.1 Full Compliance ✅

- [x] Protected Resource Metadata (RFC 9728): `/.well-known/oauth-protected-resource` on MCP workers.
- [x] Dynamic Client Registration (RFC 7591): `/register` endpoint for Claude Desktop.
- [x] 401 on Connect: MCP returns 401 on `initialize` to trigger OAuth immediately.
- [x] WWW-Authenticate header: Points to Protected Resource Metadata URL.
- [x] Loopback redirect URIs: Support for Claude Desktop's `http://127.0.0.1:<PORT>/callback`.
- [x] Authorization Server Metadata: Includes `registration_endpoint`.

### Phase 5 — Testing ✅ (Core Complete)

- [x] Manual: Claude.ai → add custom connector → OAuth → tool call. (Verified 2025-12-28)
- [x] Worker-to-worker routing: Fixed 522 timeout by using `.workers.dev` URLs for auth-worker.
- [ ] Token expiry: verify re-auth on expired token. *(Low priority - test when convenient)*
- [ ] Revoke: verify tools fail after revoke and reconnect works. *(Low priority - test when convenient)*

### Phase 6 — OpenAI ChatGPT Integration (Implemented)

> **Status**: ✅ Completed and verified (2025-12-28).

Flaim now supports ChatGPT direct access via MCP with OAuth 2.1. The implementation mirrors Claude’s flow with ChatGPT-specific requirements layered on top.

#### What’s Implemented

- ChatGPT redirect URIs are allowlisted for OAuth callbacks.
- RFC 8707 `resource` is captured in the OAuth flow and stored with codes/tokens.
- All MCP tool definitions include `securitySchemes` (OpenAI extension).
- MCP workers return 401 with `WWW-Authenticate` **and** `_meta["mcp/www_authenticate"]` on:
  - initial unauthenticated connects
  - invalid/expired tokens (auth-worker returns 401/403)
- Refresh tokens preserve the `resource` value when issuing a new access token.

#### Auth UI Trigger (ChatGPT)

ChatGPT requires both HTTP-level and MCP-level auth metadata. Flaim returns an array of Bearer challenges on the error object:

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32001,
    "message": "Authentication required. Please authorize via OAuth.",
    "_meta": {
      "mcp/www_authenticate": [
        "Bearer resource_metadata=\"https://api.flaim.app/football/.well-known/oauth-protected-resource\", error=\"unauthorized\", error_description=\"Authentication required\""
      ]
    }
  },
  "id": null
}
```

#### Implementation Checklist (Done)

- [x] Add ChatGPT redirect URIs to OAuth allowlist
- [x] Propagate `resource` through OAuth code/token storage
- [x] Add `securitySchemes` to all MCP tools
- [x] Add `_meta["mcp/www_authenticate"]` to 401 error responses
- [x] Return 401 + `_meta` on invalid/expired tokens
- [x] Preserve `resource` on refresh tokens

#### Deferred

- [ ] Validate `resource`/audience in MCP workers (optional hardening)
- [ ] Add `_meta["openai/toolInvocation/*"]` fields (optional UX polish)

#### Testing Notes

**ChatGPT Developer Mode**: Use [Developer Mode](https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta) to test custom MCP servers before submitting to the app marketplace.

**Known Issues to Watch**:
- DCR generates many short-lived client IDs (one per session). OpenAI is developing [Client Metadata Documents (CMID)](https://developers.openai.com/apps-sdk/build/auth/) as a future alternative.
- Some developers report token exchange failures in ChatGPT that work in MCP Inspector ([community thread](https://community.openai.com/t/mcp-oauth-token-exchange-fails-in-chatgpt-app-works-in-mcp-inspector/1369928)).

#### References for OpenAI Integration

- [OpenAI Apps SDK Authentication](https://developers.openai.com/apps-sdk/build/auth/)
- [OpenAI MCP Server Concepts](https://developers.openai.com/apps-sdk/concepts/mcp-server/)
- [OpenAI Apps SDK Reference](https://developers.openai.com/apps-sdk/reference/)
- [ChatGPT Developer Mode](https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta)
- [RFC 8707 - Resource Indicators for OAuth 2.0](https://datatracker.ietf.org/doc/html/rfc8707)

---

## References

- [Anthropic MCP Connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)
- [Google Gemini MCP Integration](https://ai.google.dev/gemini-api/docs/interactions)
- [OpenAI MCP/Connectors Guide](https://platform.openai.com/docs/guides/tools-connectors-mcp)
- [MCP Specification (Latest)](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP Specification (2025-03-26 Baseline)](https://modelcontextprotocol.io/specification/2025-03-26)

### Authentication References
- [MCP Authorization Spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/authorization)
- [RFC 9728 - OAuth 2.0 Protected Resource Metadata](https://datatracker.ietf.org/doc/html/rfc9728)
- [RFC 8707 - Resource Indicators for OAuth 2.0](https://datatracker.ietf.org/doc/html/rfc8707) *(Required for OpenAI)*
- [RFC 7591 - OAuth 2.0 Dynamic Client Registration](https://datatracker.ietf.org/doc/html/rfc7591)
- [RFC 8414 - OAuth 2.0 Authorization Server Metadata](https://datatracker.ietf.org/doc/html/rfc8414)
- [RFC 8252 - OAuth 2.0 for Native Apps (Loopback URIs)](https://datatracker.ietf.org/doc/html/rfc8252)

### OpenAI-Specific References
- [OpenAI Apps SDK Authentication](https://developers.openai.com/apps-sdk/build/auth/)
- [OpenAI MCP Server Concepts](https://developers.openai.com/apps-sdk/concepts/mcp-server/)
- [OpenAI Apps SDK Reference](https://developers.openai.com/apps-sdk/reference/)
- [ChatGPT Developer Mode](https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta)
