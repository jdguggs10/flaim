# MCP Distribution Buildout Plan (Claude, ChatGPT, Gemini)

Last verified: 2026-02-06
Owner: Flaim
Status: Revised draft (code-verified)

## Purpose

Take Flaim from "working MCP service" to "distribution-ready connector/app" across:
- Claude custom connectors + Anthropic Connectors Directory
- ChatGPT custom connector + ChatGPT Apps Directory
- Gemini CLI direct MCP usage + optional extension packaging

## Scope

In scope:
- OAuth/auth hardening for cross-client compliance.
- Error taxonomy and tool contract cleanup.
- Basketball and hockey sport buildout (ESPN + Yahoo).
- Testing runbooks and submission packaging.
- Gemini CLI setup documentation.

Out of scope:
- Built-in chat (`/chat`) — dev-only tool, no changes this phase.
- New platforms beyond ESPN and Yahoo.
- New tool types (write/trade operations).

## Constraints

- Solo maintainer: optimize for low maintenance overhead.
- No urgency on directory submissions — build the infrastructure right first, expect slow review cycles.
- Re-verify vendor submission docs within 7 days before each submission.

## Current implementation baseline (code-verified 2026-02-06)

### A) Core MCP architecture

Verified:
- Hosted unified MCP endpoint: `https://api.flaim.app/mcp`.
- Unified gateway worker with tool routing to ESPN/Yahoo workers via service bindings.
- OAuth protected resource metadata endpoint is live.
- Streamable HTTP transport in gateway.

Evidence: `workers/fantasy-mcp/src/index.ts`, `workers/fantasy-mcp/src/mcp/create-mcp-handler.ts`, `workers/fantasy-mcp/src/router.ts`

### B) Tool surface

Verified:
- 7 tools: `get_user_session`, `get_ancient_history`, `get_league_info`, `get_standings`, `get_matchups`, `get_roster`, `get_free_agents`.
- All tools registered with `readOnlyHint: true` and `title` annotations.
- No `destructiveHint` annotations (none needed — all tools are read-only).
- Platform routing supports `espn` + `yahoo`.
- Sport enum includes `football`, `baseball`, `basketball`, `hockey` — but basketball/hockey return `NOT_SUPPORTED` from both clients.

Evidence: `workers/fantasy-mcp/src/mcp/tools.ts`, `workers/fantasy-mcp/src/mcp/server.ts`

### C) OAuth/provider stack

Verified:
- Authorization server metadata endpoint (advertises both `S256` and `plain` PKCE).
- Dynamic client registration endpoint.
- Authorization code + refresh token flow.
- PKCE support (both methods implemented).
- OAuth state storage/validation and consent flow.
- Redirect URI allowlist includes Claude + ChatGPT callbacks.
- Redirect URI validation uses `startsWith()` prefix matching for localhost URIs — functional but more permissive than ideal.
- `resource` parameter accepted, stored in authorization codes and tokens, but **not enforced** during token validation.

Evidence: `workers/auth-worker/src/oauth-handlers.ts`, `workers/auth-worker/src/oauth-storage.ts`

### D) Platform clients

Verified:
- ESPN: football + baseball handlers complete.
- Yahoo: football + baseball handlers complete.
- Both clients return `{ success: false, error: '...not yet supported', code: 'NOT_SUPPORTED' }` for basketball and hockey.
- Auth-worker credentials/token retrieval for both platforms.

Evidence: `workers/espn-client/src/index.ts`, `workers/yahoo-client/src/index.ts`

### E) Auth signaling (what's missing)

Verified absent:
- No per-tool `securitySchemes` declaration — security is global request-level only (`index.ts` lines 152-154).
- No `_meta["securitySchemes"]` mirror.
- No `_meta["mcp/www_authenticate"]` in tool error responses — tool errors use `mcpError()` which returns `{ content: [{ type: 'text', text }], isError: true }` with no `_meta` field.
- 401 `WWW-Authenticate` header includes `realm` and `resource` but **not** `resource_metadata`.
- `McpToolResponse` interface has no `_meta` field.
- Auth failures throw plain `Error('AUTH_FAILED: Authentication failed')` with no structured metadata.

Evidence: `workers/fantasy-mcp/src/index.ts` (lines 109-136), `workers/fantasy-mcp/src/mcp/tools.ts` (lines 18-23, 137-142, 284)

### F) Error taxonomy (current state)

Verified:
- Errors follow `ExecuteResponse` interface: `{ success, data?, error?, code? }`.
- Error codes extracted from messages via regex (`/^([A-Z_]+):/`), fallback `INTERNAL_ERROR`.
- Known codes: `NOT_SUPPORTED`, `UNKNOWN_TOOL`, `INVALID_SPORT`, `PLATFORM_NOT_SUPPORTED`, `PLATFORM_ERROR`, `ROUTING_ERROR`, `INTERNAL_ERROR`, `ESPN_INVALID_RESPONSE`, `ESPN_NOT_FOUND`, `ESPN_ERROR`, `AUTH_FAILED`, `CREDENTIALS_MISSING`, `LEAGUES_MISSING`, `SPORT_NOT_SUPPORTED`, `LIMIT_EXCEEDED`.
- No centralized error taxonomy document. Codes are ad-hoc and distributed across handlers.
- No idempotency documentation for any tool.

### G) Testing and observability

Verified:
- Unit tests across workers.
- Eval trace propagation/logging scaffolding in production workers.
- CI deploy pipeline (GitHub Actions).
- **flaim-eval** (separate repo) provides end-to-end MCP tool call testing via OpenAI Responses API, with full trace capture, tool call matching, server-side log enrichment via Cloudflare, structured artifacts, and formal acceptance protocol.

flaim-eval covers:
- Real OAuth token refresh flow (bootstrap + refresh cycle).
- All MCP tools exercised against production endpoint.
- Expected-vs-actual tool call matching per scenario.
- Server-side log enrichment and trace isolation validation.
- Skill/instruction file iteration for prompt development.

flaim-eval does not cover:
- Cross-client OAuth connect-from-scratch flows (Claude, ChatGPT, Gemini).
- 401 → re-auth behavior testing.
- Negative/error scenarios (invalid sport, wrong platform, expired tokens).

These gaps are covered by manual runbooks (see Workstream 3).

## Gap analysis (what blocks distribution)

### Gap 1: Auth signaling + token validation (P0)

What's missing:
1. No per-tool `securitySchemes` declaration.
2. No `_meta["securitySchemes"]` mirror for compatibility.
3. No `_meta["mcp/www_authenticate"]` in tool error results.
4. 401 `WWW-Authenticate` missing `resource_metadata` semantics.
5. `resource`/audience stored but not enforced at token validation.
6. No scope checks at tool boundary (read/write separation).
7. PKCE advertises `plain` — should require `S256` only for production.
8. Redirect URI validation uses `startsWith()` prefix matching for localhost.

Impact: High risk for ChatGPT Apps review. Lower confidence for cross-client auth interop. Security gap in token validation.

### Gap 2: Tool contract mismatches (P0)

What's missing:
1. Basketball and hockey in tool enums but guaranteed `NOT_SUPPORTED` — schema promises what the backend can't deliver.
2. No idempotency documentation for any tool.
3. Error codes are ad-hoc with no client-facing taxonomy.

Impact: Review friction, confusing user experience, support burden.

### Gap 3: Cross-client testing (P1)

What's missing:
1. No manual runbook for OAuth connect flows per client (Claude, ChatGPT, Gemini).
2. No negative test scenarios in flaim-eval.
3. No pre-submission checklist tying flaim-eval results to submission readiness.

Impact: Manual regression risk during auth/contract changes.

### Gap 4: Submission packaging (P1)

What's missing:
1. No Anthropic submission packet (privacy URL, support contact, test account, usage instructions, safety notes).
2. No OpenAI submission packet (app metadata, test instructions, screenshots, known limitations, support policy).
3. No Gemini CLI setup guide in permanent docs.

Impact: Slow, error-prone submissions.

## Channel readiness matrix

| Channel | Works today | Ready for listing | Primary blockers |
|---|---|---|---|
| Claude custom connector | Yes (OAuth flow) | No | Auth signaling, submission packet |
| Anthropic Connectors Directory | Partial | No | All of the above + review package |
| ChatGPT custom connector | Yes (dev mode) | No | `securitySchemes`, `www_authenticate`, token hardening |
| ChatGPT Apps Directory | Partial | No | All of the above + review package |
| Gemini CLI direct MCP | Yes | No (no docs) | Setup guide, auth walkthrough |
| Gemini CLI extension | Not started | No | Extension package/repo/release process |

## Execution plan

### Workstream 1: OAuth/auth contract hardening (P0)

Goal: Make auth behavior explicitly compliant and review-friendly across MCP clients.

Tasks:
1. Add per-tool `securitySchemes` in MCP tool descriptors.
2. Add `_meta["securitySchemes"]` mirror for compatibility.
3. Standardize auth failure payloads to include `_meta["mcp/www_authenticate"]` with resource metadata URL. Requires extending `McpToolResponse` interface to support `_meta`.
4. Update 401 `WWW-Authenticate` construction to include `resource_metadata` semantics.
5. Enforce `resource`/audience checks in `validateAccessToken()` (`oauth-storage.ts` lines 436-462).
6. Enforce scope checks at tool boundary (read/write separation even though all current tools are read).
7. Tighten PKCE policy: remove `plain` from `code_challenge_methods_supported`, require `S256` only.
8. Tighten redirect URI validation: replace `startsWith()` prefix matching with exact match + port-aware localhost parsing.

Acceptance:
- ChatGPT dev-mode connection + relink flow succeeds from clean account.
- Claude connector connection + token refresh succeeds from clean account.
- Negative tests for invalid scope/resource/redirect all fail correctly.
- MCP Inspector auth scenarios pass.

### Workstream 2: Error taxonomy + tool contract cleanup (P0)

Goal: Make tool behavior predictable, well-documented, and consistent.

Tasks:
1. Centralize error codes into a shared enum/constant set used by all workers.
2. Standardize client-facing error response format (consistent structure across all tools).
3. Document idempotency expectations for each tool (all current tools are safe to retry).
4. Document error codes and their meanings for reviewers and consumers.
5. Keep annotations accurate (`readOnlyHint: true` for all current tools; future write tools must set `destructiveHint: true`).

Acceptance:
- Error codes are defined in one place and used consistently.
- Tool schema + runtime behavior match exactly in happy and error paths.
- Idempotency expectations documented per tool.

### Workstream 3: Testing runbooks (P1)

Goal: Repeatable pre-submission confidence gates.

Automated (flaim-eval):
- Existing flaim-eval covers tool call validation, trace capture, and acceptance protocol.
- Add negative test scenarios to flaim-eval (invalid sport, wrong platform, missing credentials).
- Add pre-submission checklist script that maps flaim-eval results to submission readiness.

Manual runbook:
- Document per-client OAuth connect flow (Claude, ChatGPT, Gemini CLI):
  - Fresh connect from clean account.
  - Token refresh after expiry.
  - 401 → re-auth behavior.
  - 2-3 canonical tool calls.
- Run manually before each submission. No browser automation.

Acceptance:
- `npm run eval` in flaim-eval passes all scenarios including negative tests.
- Manual runbook exists and has been executed once per client.

### Workstream 4: Submission packaging (P1)

Goal: Reduce submission friction and rework.

Tasks:
1. Build Anthropic submission packet: privacy URL, support contact, test account, usage instructions, safety notes.
2. Build OpenAI submission packet: app metadata, test instructions, screenshots, known limitations, support policy.
3. Document versioning rules for tool schema changes to avoid post-publish breakage.

Acceptance:
- Both packets complete and internally reviewed.
- Resubmission path documented for tool contract changes.

### Workstream 5: Gemini CLI distribution (P1)

Goal: Ship the lowest-friction distribution channel first — no app store review required.

Tasks:
1. Publish official Gemini CLI direct MCP setup guide in permanent docs.
2. Add auth walkthrough with troubleshooting.
3. Optional: create Gemini extension package repo with `gemini-extension.json` and release flow.

Acceptance:
- Clean-machine setup to first successful tool call in <=5 minutes.

### Workstream 6: Basketball + hockey buildout (P1)

Goal: Fulfill the tool contract — every sport in the schema must work.

Decision: Build out basketball and hockey support rather than trimming the schema. The existing football and baseball handlers provide a well-established pattern. This is not greenfield work.

Pre-work (spike, do early to de-risk):
- Hit ESPN and Yahoo basketball/hockey APIs directly. Confirm response structure matches the football/baseball pattern. If it doesn't, reassess scope before committing.

Tasks:
1. ESPN basketball handlers (league info, standings, matchups, roster, free agents).
2. ESPN hockey handlers (same 5 tools).
3. Yahoo basketball handlers (same 5 tools + normalizers).
4. Yahoo hockey handlers (same 5 tools + normalizers).
5. Position mappings for basketball and hockey (both platforms).
6. Unit tests for new handlers and normalizers.
7. flaim-eval scenarios for basketball and hockey.

Acceptance:
- All 7 MCP tools work for all 4 sports on both platforms.
- No tool call returns `NOT_SUPPORTED` for any declared sport.
- flaim-eval passes for basketball and hockey scenarios.

## Sequencing

### Sprint A (P0 — foundation)
- Workstream 1: Auth hardening.
- Workstream 2: Error taxonomy + tool contract cleanup.
- Workstream 6 spike only: API shape verification for basketball/hockey (30 min per sport per platform — 2 hours total).
- Freeze auth contract at end of sprint.

### Sprint B (P1 — testing + packaging + Gemini)
- Workstream 3: Testing runbooks + flaim-eval negative scenarios.
- Workstream 4: Submission packets.
- Workstream 5: Gemini CLI docs (first channel to ship).

### Sprint C (P1 — sport buildout + submissions)
- Workstream 6: Basketball + hockey buildout.
- Freeze tool contract at end of sprint.
- Submit to Claude and ChatGPT directories.
- Gemini extension packaging (optional).

## Definition of done

- Auth signaling, metadata, and token checks satisfy client expectations.
- Declared tool contract exactly matches backend support for all 4 sports.
- Error taxonomy is centralized and documented.
- flaim-eval passes all scenarios (happy path + negative).
- Manual runbook executed once per client before submission.
- Anthropic and OpenAI submission artifacts are complete.
- Gemini CLI path is documented and validated.

## Known risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Vendor policy drift | Submission churn | Re-verify docs within 7 days before submission |
| Auth behavior differs by client | Failed onboarding | Manual runbook per client; flaim-eval for regression |
| ESPN/Yahoo basketball/hockey APIs differ structurally | Sprint C scope blows up | API spike in Sprint A; reassess before committing |
| Solo maintainer bandwidth | Slow execution | No urgency on submissions; build infrastructure right |
| flaim-eval gaps (no negative tests) | False confidence | Add negative scenarios in Sprint B before relying on it |

## Sources

- MCP spec: https://modelcontextprotocol.io/specification/2025-11-25
- Anthropic custom connectors guide: https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp
- Anthropic build guide: https://support.claude.com/en/articles/11503834-building-custom-connectors-via-remote-mcp-servers
- Anthropic submission guide: https://support.claude.com/en/articles/12922490-remote-mcp-server-submission-guide
- Anthropic connectors directory FAQ: https://support.claude.com/en/articles/11596036-anthropic-connectors-directory-faq
- Anthropic API MCP connector docs: https://platform.claude.com/docs/en/agents-and-tools/mcp-connector
- OpenAI Apps SDK MCP concept: https://developers.openai.com/apps-sdk/concepts/mcp-server/
- OpenAI Apps SDK auth: https://developers.openai.com/apps-sdk/build/auth/
- OpenAI connect from ChatGPT: https://developers.openai.com/apps-sdk/deploy/connect-chatgpt
- OpenAI app submission: https://developers.openai.com/apps-sdk/deploy/submission/
- OpenAI app submission guidelines: https://developers.openai.com/apps-sdk/app-submission-guidelines
- Gemini CLI MCP docs: https://geminicli.com/docs/tools/mcp-server
- Gemini CLI extensions docs: https://geminicli.com/docs/extensions/
- Gemini CLI extension writing: https://geminicli.com/docs/extensions/writing-extensions/
- Gemini CLI extension reference: https://geminicli.com/docs/extensions/reference/
- Gemini CLI extension releasing: https://geminicli.com/docs/extensions/releasing/
- Gemini CLI command reference: https://geminicli.com/docs/cli/commands

## Confidence notes

- High confidence:
  - All baseline findings code-verified against specific files and line numbers.
  - Gap analysis confirmed by reading actual implementations, not inferred from docs.
  - flaim-eval capabilities verified by reading its source, types, and scenarios.
- Medium confidence:
  - Directory/store policy details and review workflows may change quickly.
  - ESPN/Yahoo basketball/hockey API structure assumed similar to football/baseball — spike needed.
  - Re-check all listing constraints immediately before submission.
