# Claude MCP Connector Directory: Gap Analysis for Flaim

**Date:** January 23, 2026
**Status:** Research Complete
**Author:** Claude (assisted analysis)

---

## Executive Summary

Flaim's MCP implementation is **technically compliant** with Anthropic's connector directory requirements. The gaps are primarily **documentation and operational**—not code changes.

**Estimated effort to submit:** 4-5 hours

---

## Current State: What Flaim Already Has

| Requirement | Status | Location |
|-------------|--------|----------|
| OAuth 2.1 with PKCE | ✅ | `workers/auth-worker/src/oauth-handlers.ts` |
| Dynamic Client Registration (RFC 7591) | ✅ | `handleClientRegistration()` |
| Token Expiry & Refresh | ✅ | `handleToken()` with refresh_token grant |
| Streamable HTTP Transport | ✅ | `WebStandardStreamableHTTPServerTransport` |
| OAuth Metadata Discovery (RFC 8414) | ✅ | `/.well-known/oauth-authorization-server` |
| Protected Resource Metadata (RFC 9728) | ✅ | `/.well-known/oauth-protected-resource` |
| Tool `title` property | ✅ | All 6 tools in `server.ts` |
| Tool `readOnlyHint` annotation | ✅ | All tools marked `readOnlyHint: true` |
| Read-only tools only | ✅ | No destructive operations |
| Privacy policy page | ✅ | `web/app/(site)/privacy/page.tsx` |
| HTTPS endpoint | ✅ | `https://api.flaim.app/fantasy/mcp` |
| SDK supporting 2025-06-18 spec | ✅ | `@modelcontextprotocol/sdk: ^1.25.2` |
| Error handling | ✅ | JSON-RPC error responses implemented |

---

## Correcting Common Misconceptions

### HEAD Endpoint with Protocol Version Header ❌ NOT REQUIRED

A previous analysis claimed Flaim needs a HEAD endpoint returning `MCP-Protocol-Version: 2025-06-18`. **This is incorrect.**

Per the [MCP 2025-06-18 specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#protocol-version-header):

> "If using HTTP, the **client MUST** include the `MCP-Protocol-Version: <protocol-version>` HTTP header on all subsequent requests"

The protocol version header is sent **by the client**, not exposed by the server. The MCP SDK handles version negotiation during initialization automatically.

### Session ID Management ❌ NOT REQUIRED

The spec states session IDs are **optional**:

> "A server using the Streamable HTTP transport **MAY** assign a session ID at initialization time"

For stateless read-only servers like Flaim that use OAuth tokens for user identity, session IDs provide no benefit. The current implementation (`sessionIdGenerator: undefined`) is valid.

### Additional Tool Annotations ❌ NOT REQUIRED

Per [Anthropic's submission guide](https://support.claude.com/en/articles/12922490-remote-mcp-server-submission-guide):

> "Every tool MUST include safety annotations: `readOnlyHint: true` for read-only operations"

Flaim already has `readOnlyHint: true` on all tools. The annotations `destructiveHint: false`, `idempotentHint`, and `openWorldHint` are **not mentioned** as requirements in Anthropic's directory policy.

---

## Actual Gaps: What's Missing

### 1. Working Examples (REQUIRED) ❌

**Requirement:** Minimum 3 working usage examples demonstrating core functionality.

**Current state:** No documented examples exist.

**Action:** Create example prompts document showing realistic usage:

```markdown
## Example 1: View Roster
**Prompt:** "Show me my fantasy football roster for this week"
**Expected:** Returns current roster with player names, positions, projected points

## Example 2: Free Agent Search
**Prompt:** "Who are the top available free agents in my baseball league?"
**Expected:** Returns list of unrostered players sorted by ownership %

## Example 3: League Standings
**Prompt:** "What are the current standings in my league?"
**Expected:** Returns team rankings, records, and playoff positions
```

**Effort:** 1-2 hours

### 2. Test Credentials (REQUIRED) ❌

**Requirement:** Test account with representative sample data for Anthropic reviewers.

**Current state:** No test account exists.

**Action:**
- Create dedicated ESPN account for testing
- Join or create sample leagues (football + baseball)
- Configure leagues in Flaim with this account
- Document credentials and setup for submission

**Effort:** 1-2 hours

### 3. AI Data Flow Documentation (RECOMMENDED) ⚠️

**Requirement:** Per [MCP Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy), users should understand data flow.

**Current state:** Privacy policy covers ESPN credential handling but not AI integration specifics.

**Action:** Add section to privacy policy:

```markdown
## AI Platform Integration

When you connect Flaim to Claude or ChatGPT:

- **What flows to the AI:** League data, rosters, standings, matchups (public fantasy data)
- **What never flows to the AI:** Your ESPN credentials (SWID, espn_s2)
- **Anthropic telemetry:** Per Anthropic's policy, tool parameters and responses may be collected as telemetry

Flaim acts as a data bridge—your AI subscription provider's privacy policy governs how they handle the fantasy data.
```

**Effort:** 30 minutes

### 4. Dedicated Support Contact (RECOMMENDED) ⚠️

**Requirement:** Dedicated support channel (email or web).

**Current state:** `privacy@flaim.app` exists but no general support contact.

**Action:** Add `support@flaim.app` or contact form.

**Effort:** 30 minutes

---

## Directory Submission Process

### Pre-Submission Checklist

- [ ] Server is production-ready (GA status)
- [ ] All tools have `readOnlyHint` or `destructiveHint` annotations
- [ ] OAuth 2.0 authentication implemented
- [ ] HTTPS with valid TLS certificates
- [ ] Privacy policy published
- [ ] 3+ working examples documented
- [ ] Test credentials prepared
- [ ] Support contact available

### Submission Form

Submit via: [MCP Directory Server Review Form](https://forms.gle/Mhr9cSEz7aSPdV3q7)

**Required information:**
- Server URL: `https://api.flaim.app/fantasy/mcp`
- Documentation link
- Test credentials (username/password or instructions)
- Minimum 3 example prompts
- Contact information
- Privacy policy URL: `https://flaim.app/privacy`

### Post-Submission

Per the [FAQ](https://support.claude.com/en/articles/11596036-anthropic-connectors-directory-faq):

> "While we strive to review every submission as quickly as we can, due to overwhelming interest we cannot promise that we will accept your submission or respond to it individually."

Expect no guaranteed timeline. Maintain the test account active during and after review.

---

## Technical Specifications Reference

### Response Limits

| Metric | Limit |
|--------|-------|
| Tool result size | 25,000 tokens max |
| Timeout (Claude.ai/Desktop) | 300 seconds |
| Timeout (Claude Code) | Configurable via `MCP_TOOL_TIMEOUT` |

### Required OAuth Callback URLs

Allowlist these in OAuth configuration:
- `http://localhost:6274/oauth/callback`
- `http://localhost:6274/oauth/callback/debug`
- `https://claude.ai/api/mcp/auth_callback`
- `https://claude.com/api/mcp/auth_callback`

### Protocol Version Support

The [MCP 2025-06-18 specification](https://modelcontextprotocol.io/specification/2025-06-18) is current. Key features:
- Structured tool outputs
- OAuth-based authorization (RFC 8707 resource indicators)
- Elicitation for server-initiated user interactions
- No JSON-RPC batching (removed in this version)

Flaim's SDK (`@modelcontextprotocol/sdk: ^1.25.2`) supports protocol versions: 2025-06-18, 2025-03-26, 2024-11-05.

---

## Existing Directory Connectors (Reference)

The [Anthropic Connectors Directory](https://claude.com/connectors) includes 100+ approved connectors such as:

- Asana, ClickUp (project management)
- Atlassian Rovo (Jira/Confluence)
- Box (content management)
- Amplitude (analytics)
- GitHub, GitLab (development)
- Slack (communication)

These are maintained by third-party developers using MCP. Each has their own terms and privacy policy presented during OAuth.

---

## Action Plan Summary

| Task | Priority | Effort | Status |
|------|----------|--------|--------|
| Create 3+ example prompts | HIGH | 1-2 hours | Not started |
| Prepare test ESPN account | HIGH | 1-2 hours | Not started |
| Add AI data flow to privacy policy | MEDIUM | 30 min | Not started |
| Add support contact | MEDIUM | 30 min | Not started |
| Submit to directory | — | 30 min | Blocked by above |

**Total estimated effort:** 4-5 hours

---

## Sources

- [MCP 2025-06-18 Specification - Transports](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
- [MCP 2025-06-18 Specification - Lifecycle](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle)
- [Remote MCP Server Submission Guide](https://support.claude.com/en/articles/12922490-remote-mcp-server-submission-guide)
- [Anthropic MCP Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy)
- [Anthropic Connectors Directory FAQ](https://support.claude.com/en/articles/11596036-anthropic-connectors-directory-faq)
- [Getting Started with Custom Connectors](https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp)
- [@modelcontextprotocol/sdk on npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- [MCP Servers GitHub Repository](https://github.com/modelcontextprotocol/servers)
