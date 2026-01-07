# Changelog (Condensed)

Follow Keep a Changelog; SemVer applies. Planning docs live in `docs/dev`.

## [Unreleased]

### Chrome Extension v1.1 - Auto-Discovery
After syncing ESPN credentials, the extension now automatically discovers all your leagues and lets you pick a default - no manual league entry required.

- **Added**: Auto-discovery of all ESPN leagues after syncing credentials.
- **Added**: Historical season discovery for each league (all previous seasons saved automatically).
- **Added**: Default league selection in extension popup before completing setup.
- **Added**: Progress UI showing sync/discovery/select steps with progress bar.
- **Added**: Popup close recovery (setup state persisted in chrome.storage.local).
- **Added**: `POST /extension/discover` endpoint for league discovery.
- **Added**: `POST /extension/set-default` endpoint for setting default league.
- **Added**: `leagueExists()` and `getCurrentSeasonLeagues()` storage helpers.
- **Added**: `discoverAndSaveLeagues()` and `discoverHistoricalSeasons()` in league-discovery.ts.
- **Added**: Historical season membership validation via ESPN team list fetch (prevents incorrect historical entries).
- **Changed**: "Sync to Flaim" now runs full setup flow (sync + discover + select default).
- **Changed**: Extension version bumped to 1.1.0.

### Maintenance
- **Removed**: `/account` page — redundant with Clerk's `<UserButton>` modal which provides identical account management functionality.
- **Changed**: Dependency restructure — removed frontend deps from root package.json, aligned versions (jest 30, typescript 5.6.2), deleted orphaned root jest.config.js, fixed auth-worker jest config.

## [7.2.0] - 2026-01-05

### Multi-Season League Support
Users can now track historical seasons alongside current ones. Each league is stored per season year, enabling year-over-year analysis and historical data access.

### Leagues & Seasons
- **Added**: Season year pass-through across web, API, and MCP workers.
- **Added**: Deterministic season default helper (baseball Feb 1, football Jun 1, America/New_York).
- **Added**: Multi-season league storage (unique on user + sport + league + season year).
- **Added**: Discover-seasons flow to auto-add historical league seasons.
- **Changed**: League deletion removes all seasons for a league (no per-season delete).
- **Changed**: `get_user_session` now returns seasonYear per league and the default league.
- **Added**: Migration `007_espn_leagues_unique_season_year.sql` to update the unique constraint.

## [7.1.1] - 2025-12-31

### Chrome Extension
- **Added**: Chrome extension for automatic ESPN credential capture (Manifest V3, React popup).
- **Added**: Extension pairing flow with 6-character codes (10-minute expiry).
- **Added**: `/extension` page for pairing code generation and connection management.
- **Added**: Extension API routes (`/api/extension/*`) proxying to auth-worker.
- **Added**: `extension_pairing_codes` and `extension_tokens` tables in Supabase.
- **Added**: Rate limiting for extension pairing (5 codes/hour per user, 10 attempts/10min per IP).
- **Added**: Build-time localhost stripping in `vite.config.ts` for production builds.
- **Added**: Dev/prod detection via `chrome.management.getSelf()` API.
- **Submitted**: Chrome Web Store submission (Dec 31, 2025) - awaiting review.

### Privacy & Compliance
- **Added**: Privacy policy page at `/privacy` for Chrome Web Store compliance.
- **Added**: ESPN non-affiliation disclaimer.
- **Added**: Data retention and user rights documentation.

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

### Documentation
- **Updated**: README.md reframed Flaim as MCP/auth service (not chatbot).
- **Updated**: ARCHITECTURE.md added extension architecture, APIs, and deployment (merged from GETTING_STARTED.md).
- **Moved**: Chrome extension docs to `extension/README.md`.
- **Removed**: GETTING_STARTED.md (consolidated into ARCHITECTURE.md).
- **Updated**: All docs de-emphasize chat as secondary feature.

## [7.1.0] - 2025-12-28

### ChatGPT Direct Access - Now Working!
Users can connect Flaim to ChatGPT as a custom MCP connector with OAuth 2.1, bringing their own subscription.

### OpenAI ChatGPT OAuth Support
- **Added**: ChatGPT redirect URIs to OAuth allowlist.
- **Added**: RFC 8707 `resource` propagation through OAuth code/token storage.
- **Added**: `securitySchemes` on all MCP tool definitions.
- **Added**: `_meta["mcp/www_authenticate"]` on 401 responses (initial connect + invalid tokens).
- **Fixed**: Refresh token flow preserves `resource` for audience-aware tokens.

## [7.0.0] - 2025-12-28

### Claude Direct Access - Now Working!
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
