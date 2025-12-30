# Changelog (Condensed)

Follow Keep a Changelog; SemVer applies. Planning docs live in `docs/dev`.

## [Unreleased]

### Chat Debug Mode
- **Added**: Debug mode toggle in chat tools panel for MCP debugging.
- **Added**: Timing badges on all tool calls (shows execution duration in ms).
- **Added**: REQUEST/RESPONSE labels when debug mode is enabled.
- **Added**: `ToolCallMetadata` interface for tracking tool execution timing.

### Chat Debug UI Improvements (Phase 2)
- **Added**: Copy buttons on request/response JSON blocks.
- **Added**: Clear conversation button (trash icon) to reset chat.
- **Added**: Keyboard shortcut `Cmd+D` / `Ctrl+D` to toggle debug mode.
- **Added**: Collapsible JSON blocks with chevron toggle.
- **Added**: Error styling with red borders, error banners, and actionable suggestions.
- **Added**: MCP server URL display in debug mode.
- **Added**: Debug mode badge (amber "DEBUG" pill in chat header).
- **Added**: Active league indicator badge (blue pill with league name).
- **Fixed**: Page scrolling broken by `overflow-hidden` on main layout.

### Chat Simplification
- **Removed**: Usage tracking from built-in chat (message limits, free tier tracking).
- **Removed**: `/api/chat/usage` endpoint and `UsageDisplay` component.
- **Removed**: "Account & Usage" section from chat tools panel.
- **Changed**: Chat now requires only Clerk auth, no usage limits enforced.

## [7.1.0] - 2025-12-28

### 🤖 ChatGPT Direct Access - Now Working!
Users can connect Flaim to ChatGPT as a custom MCP connector with OAuth 2.1, bringing their own subscription.

### OpenAI ChatGPT OAuth Support
- **Added**: ChatGPT redirect URIs to OAuth allowlist.
- **Added**: RFC 8707 `resource` propagation through OAuth code/token storage.
- **Added**: `securitySchemes` on all MCP tool definitions.
- **Added**: `_meta["mcp/www_authenticate"]` on 401 responses (initial connect + invalid tokens).
- **Fixed**: Refresh token flow preserves `resource` for audience-aware tokens.

## [7.0.0] - 2025-12-28

### 🎉 Claude Direct Access - Now Working!
Users can now connect Flaim to Claude.ai or Claude Desktop as a custom MCP connector. This enables "bring your own Claude subscription" usage, shifting AI costs to users while providing full access to ESPN fantasy data.

### OAuth 2.1 for Claude Direct Access
- **Added**: Full MCP OAuth 2.1 implementation for Claude Desktop/Claude.ai integration.
- **Added**: Dynamic Client Registration (RFC 7591) - `/register` and `/auth/register` endpoints.
- **Added**: Protected Resource Metadata (RFC 9728) - `/.well-known/oauth-protected-resource` on MCP workers.
- **Added**: Authorization Server Metadata (RFC 8414) - includes `registration_endpoint`.
- **Added**: Support for loopback redirect URIs (RFC 8252) for Claude Desktop.
- **Added**: `get_user_session` tool - returns user's configured leagues, team IDs, and current season context.
- **Changed**: MCP servers now return 401 on `initialize` to trigger OAuth immediately on connect.
- **Changed**: WWW-Authenticate header points to Protected Resource Metadata URL.
- **Added**: Rate limiting (200 calls/day per user) with appropriate headers.
- **Added**: Consent screen at `/oauth/consent` for user authorization.
- **Added**: Connectors page at `/connectors` for connection management.

### Critical Fix: Worker-to-Worker Routing
- **Fixed**: MCP workers now use `.workers.dev` URLs for auth-worker calls instead of custom domain.
- **Root cause**: Custom domain (`api.flaim.app`) caused HTTP 522 timeouts for intra-zone Cloudflare requests.
- **Impact**: `get_user_session` and all MCP tools now work correctly via Claude direct access.

### Other Fixes
- Note: OpenAI usage now references the **Responses API** (not legacy chat completions).
- Fix: Strip custom-domain prefixes for auth/baseball/football workers; avoid 404s.
- Fix: Credential check returns 200 with `hasCredentials: false` instead of 404.
- Fix: Trailing slash env URLs no longer break onboarding; timeouts resolved by direct URLs.
- Security: JWKS-based JWT verification enforced in prod; workers forward `Authorization`.
- Infra: Secrets for prod workers set via Cloudflare Dashboard (not `wrangler secret put`).
- Docs: Added onboarding explanation, DNS setup, and timeout/404 troubleshooting.

## [6.1.0] - 2025-07-08
- Updated to React 19.1.0 / Next.js 15.3.4. 
- Migrated worker configs to `wrangler.jsonc`; fixed Next.js route handler builds.

## [6.0.0]
- Added unified dev/prod scripts (now replaced by GitOps); centralized auth-worker; moved credentials to Supabase.

## [4.1.1]
- Added automatic ESPN league discovery.

## [4.1.0]
- Extracted modular `flaim/auth`; added football MCP worker.

## [4.0.0]
- Security fix: removed header spoofing by enforcing server-side Clerk verification.

## [3.0.0]
- Integrated Clerk auth; added secure credential management.

## [2.0.0]
- Introduced Stripe-first microservices architecture with OpenAI chat (later simplified).

## [1.0.0]
- Initial release with basic ESPN data and simple web UI.
