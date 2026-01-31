# Changelog (Condensed)

Follow Keep a Changelog; SemVer applies.

## [Unreleased]

### Infrastructure
- **Removed**: Legacy sport MCP workers (`baseball-espn-mcp`, `football-espn-mcp`) archived and removed from repository. Unified gateway (`fantasy-mcp`) is now the sole MCP endpoint.
- **Changed**: Removed legacy workers from CI/CD pipeline, local dev scripts, and documentation.
- **Preserved**: Legacy worker code preserved in git tag `legacy-sport-mcp-workers` for reference. Access via `git checkout legacy-sport-mcp-workers` or browse on GitHub.

### Documentation
- **Added**: `docs/STYLE-GUIDE.md` — Comprehensive frontend style guide covering design tokens, typography, spacing, component guidelines, accessibility standards, and code conventions.
- **Added**: `workers/yahoo-client/README.md` — Yahoo client worker documentation covering OAuth, JSON normalizers, and sports handlers.
- **Changed**: Promoted UI consistency rules from `docs/dev/ui-consistency.md` to permanent documentation with expanded scope.
- **Changed**: Archived `docs/dev/ADD_YAHOO_PLATFORM.md` to `docs/archive/` (Phase 3 complete).

### Site Loading States
- **Fixed**: Leagues page no longer shows full-page spinner while checking ESPN credentials. Page structure renders immediately after Clerk auth loads.
- **Added**: "Loading your leagues..." label on league list spinner for clearer feedback.
- **Added**: Inline "Checking..." badge in ESPN maintenance section while credential status loads.
- **Fixed**: Homepage ESPN and Yahoo platform columns no longer shift height when status checks complete (added `min-h`).
- **Changed**: ESPN maintenance buttons restyled to match Yahoo — side-by-side `sm` buttons instead of stacked full-width.

### Chat UX
- **Fixed**: Chat loading indicator no longer disappears 5+ seconds before content appears. Loading state stays visible until actual text or tool call UI renders.
- **Added**: Collapsible "Thinking..." pill replaces the tiny 12px pulsing dot. Shows a spinner with status text. When using reasoning models, the pill can be expanded to show live reasoning summary text.
- **Added**: Handles new SSE events (`response.created`, `response.in_progress`, `response.reasoning_summary_text.delta`) for richer loading feedback.
- **Added**: `reasoning: { summary: "auto" }` to OpenAI API call to enable reasoning summary streaming.

### UI Consistency
All frontend components now use semantic design tokens instead of hard-coded Tailwind palette classes, ensuring consistent light/dark theme support.

- **Added**: Semantic CSS tokens (`success`, `warning`, `info`) in `globals.css` and `tailwind.config.ts`.
- **Added**: `success`, `warning`, `info` variants for Alert and Badge components.
- **Added**: `npm run ui:check` script to detect hard-coded color violations.
- **Added**: `docs/dev/ui-consistency.md` developer guide.
- **Changed**: All chat, landing, leagues, and config components migrated to design tokens.
- **Removed**: Dead components (`panel.tsx`, `StepSyncEspn.tsx`, `EspnCredentialsCard.tsx`).

### Yahoo Fantasy Platform Support
Yahoo Fantasy now works through the unified gateway alongside ESPN. **Full feature parity achieved for both football and baseball (5/5 tools each).**

- **Added**: `yahoo-client` worker - Yahoo Fantasy API client for all sports
- **Added**: Yahoo OAuth token refresh flow via auth-worker
- **Added**: Yahoo-specific JSON normalizers for quirky API format (numeric-keyed objects, nested arrays)
- **Added**: Yahoo football handlers: `get_league_info`, `get_standings`, `get_roster`, `get_matchups`, `get_free_agents`
- **Added**: Yahoo baseball handlers: `get_league_info`, `get_standings`, `get_roster`, `get_matchups`, `get_free_agents` (Phase 3 complete)
- **Added**: Baseball position mappings (C, 1B, 2B, 3B, SS, OF, SP, RP, P, Util)
- **Added**: Position filter mapping for Yahoo free agent searches (football + baseball)
- **Added**: `YAHOO` service binding in fantasy-mcp gateway
- **Added**: `yahoo-client` to CI/CD pipeline (test + deploy) and `docs/STATUS.md`
- **Added**: Unit tests for Yahoo normalizers (27 tests)
- **Fixed**: Snake_case/camelCase mismatch between auth-worker and yahoo-client credentials
- **Fixed**: Yahoo matchup parsing for numeric-keyed object structure
- **Fixed**: Team key construction for roster endpoint (Yahoo requires full key, not just numeric ID)

### Chrome Extension v1.4.1 - Clerk Sync Host Fix
Critical fix for extension authentication - users can now sign in successfully via Clerk Sync Host.

- **Fixed**: Clerk Sync Host now correctly points to `https://clerk.flaim.app` instead of `https://flaim.app`, resolving authentication failures where extension couldn't detect signed-in status from flaim.app.
- **Changed**: Extension version bumped to 1.4.1.

### Chrome Extension Simplification
Default league selection removed from extension - defaults are now managed exclusively via the web UI at `/leagues`.

- **Removed**: Default league selection step from extension setup flow.
- **Removed**: `POST /extension/set-default` endpoint (both Next.js proxy and auth-worker handler).
- **Changed**: Extension flow simplified to: sync → discover → complete.
- **Changed**: Extension version bumped to 1.4.0.

### Unified Gateway Architecture (Phase 0) - Complete
Major architectural restructure implementing a unified gateway pattern for multi-platform fantasy sports support. **Validated and promoted as primary endpoint (Jan 2026).**

- **Added**: `fantasy-mcp` worker - unified MCP gateway with platform-agnostic tools
- **Added**: `espn-client` worker - internal ESPN API client for all sports
- **Added**: Service bindings between gateway and platform workers
- **Added**: Unified MCP tools: `get_user_session`, `get_league_info`, `get_standings`, `get_matchups`, `get_roster`, `get_free_agents`
- **Added**: `/fantasy/*` routes on `api.flaim.app` for gateway access
- **Added**: `platform` field to auth-worker league responses
- **Added**: Request logging in `espn-client` for observability (tool, sport, league, timing)
- **Changed**: ESPN handlers consolidated from per-sport workers into `espn-client`
- **Changed**: Auth binding renamed from `AUTH` to `AUTH_WORKER` for consistency
- **Changed**: Frontend updated to show unified gateway URL as primary connector
- **Fixed**: Football season rollover date (March 1 → June 1) to match documentation
- **Deprecated**: Legacy workers (`baseball-espn-mcp`, `football-espn-mcp`) - still functional as fallback

See `docs/plans/2025-01-19-phase0-unified-gateway.md` for implementation details.

### Worker Infrastructure: Hono + MCP SDK
Migrated all 3 Cloudflare Workers to Hono routing framework and official MCP SDK. Cleaner code, better testing support, ~400 lines removed.

- **Added**: Hono routing framework to all workers (auth-worker, baseball-mcp, football-mcp).
- **Added**: Official MCP SDK (`@modelcontextprotocol/sdk`) for protocol handling in MCP workers.
- **Added**: `@flaim/worker-shared` package with CORS middleware, auth-fetch helper, and shared types.
- **Added**: Zod schemas for all MCP tool inputs with runtime validation.
- **Added**: Tool annotations (`readOnlyHint`, `title`) for Claude/ChatGPT directory compatibility.
- **Changed**: MCP workers now use `WebStandardStreamableHTTPServerTransport` (no Node shims).
- **Changed**: Manual `if (pathname === ...)` routing replaced with Hono routes.
- **Changed**: Manual JSON-RPC parsing replaced with SDK handlers.
- **Removed**: Old `index.ts` entry points (3 workers).
- **Removed**: Old MCP agent files (`agent.ts`, `football-agent.ts`).

### Developer Console Overhaul
Replaced the chat sidebar with an enhanced Developer Console for MCP debugging. Includes dynamic tool fetching and UI optimizations.

- **Added**: Developer Console with 3 collapsible sections (MCP, Tools, Debug).
- **Added**: Compact header popovers for Account and ESPN status.
- **Added**: Minimal chat header with league dropdown, season dropdown, and environment badge.
- **Added**: Dynamic tool fetching from MCP server via `tools/list` (no static fallback).
- **Added**: `/api/debug/test-mcp` endpoint for MCP connection testing (SSRF-protected), with latency + timestamps.
- **Added**: LLM MCP payload preview (redacted), tool schema previews, and session-scoped tool call log.
- **Added**: `mcpAvailableTools` and `disabledMcpTools` store fields for tool management.
- **Changed**: Environment badge, league selector, season selector, Account/ESPN status moved from sidebar to header.
- **Changed**: Tool toggles now use `disabledMcpTools` array instead of CSV `allowed_tools`.
- **Fixed**: Developer Console sidebar now scrolls correctly when multiple sections are expanded.
- **Removed**: `components/chat/tools-panel.tsx` and `components/chat/mcp-config.tsx` (replaced).

### Chrome Extension v1.3.0 - Clerk Direct Auth
Replaces custom pairing-code token exchange with direct Clerk authentication via Sync Host. Users signed into flaim.app automatically authenticate in the extension.

- **Added**: `@clerk/chrome-extension` SDK integration with Sync Host.
- **Added**: `ClerkProvider.tsx` wrapper component for extension popup.
- **Added**: Clerk session sync from flaim.app to extension (no pairing codes needed).
- **Added**: `createClerkClient` in background service worker for ping responses.
- **Added**: `signedIn` and `userId` fields in extension ping response.
- **Changed**: Extension popup uses Clerk `useAuth()` hook instead of custom token storage.
- **Changed**: All extension API endpoints now accept Clerk JWTs (not custom extension tokens).
- **Changed**: Web `/extension` page simplified (removed pairing code UI, disconnect button).
- **Changed**: `extension-ping.ts` updated for new `signedIn`/`userId` response format.
- **Removed**: Pairing code generation (`/api/extension/code`).
- **Removed**: Code exchange (`/api/extension/pair`).
- **Removed**: Token revocation (`/api/extension/token`).
- **Removed**: `extension-storage.ts` (extension token CRUD).
- **Removed**: Custom extension token validation in auth-worker.

### Chrome Extension v1.2.1 - Extension Status Ping
Adds direct website-to-extension ping to show real-time connection status, with better non-Chrome fallbacks and local dev support.

- **Added**: `externally_connectable` ping from `flaim.app` and `localhost` for real-time status checks.
- **Added**: Extension background service worker responds to external ping requests.
- **Added**: Local dev support via `NEXT_PUBLIC_EXTENSION_IDS` to ping unpacked extensions.
- **Changed**: Extension status UI now prefers ping results over server records; non-Chrome browsers show server fallback.

### Chrome Extension v1.2.0 - Fan API Discovery Refactor
ESPN deprecated the `mUserLeagues` endpoint, breaking auto-discovery. This release switches to the new Fan API endpoint, massively simplifying the code while fixing the issue.

- **Fixed**: League auto-discovery now works again (ESPN deprecated old endpoint).
- **Changed**: Replaced `lm-api-reads.fantasy.espn.com` with `fan.api.espn.com/apis/v2/fans/{SWID}`.
- **Changed**: Discovery now uses single API call instead of 4+ calls (one per sport + N per league).
- **Changed**: All league data (leagueId, teamId, teamName, seasonId, sport) returned in one response.
- **Added**: SWID normalization to ensure brace format `{UUID}` for Fan API compatibility.
- **Added**: ESPN-recommended headers (`x-p13n-swid`, `X-Personalization-Source`) for API parity.
- **Added**: Numeric-to-string game ID mapping (1→ffl, 2→flb, 3→fba, 4→fhl).
- **Removed**: Sport iteration loop (no longer needed).
- **Removed**: PII from logs (partial SWID, league names).

### Chrome Extension v1.1.1 - Improved Discovery Messaging
Fixes confusing messaging during league discovery and re-sync. Now shows granular counts for leagues and past seasons.

- **Added**: `SeasonCounts` type with `found`/`added`/`alreadySaved` for granular messaging.
- **Added**: `currentSeason` and `pastSeasons` objects in discovery API response.
- **Added**: `getDiscoveryMessage()` helper for context-aware discovery status.
- **Added**: `getCompletionSummary()` helper for setup completion summary.
- **Added**: Legacy field migration for popup recovery from v1.1 state.
- **Fixed**: "Found 0 leagues" shown incorrectly when re-syncing (now shows "N leagues already saved").
- **Fixed**: Past seasons `found` count now only includes seasons where user was actually a member.
- **Changed**: Discovery messages now distinguish new vs already-saved for both leagues and past seasons.
- **Changed**: Renamed "historical" to "past seasons" for clarity.
- **Changed**: Extension version bumped to 1.1.1.

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
