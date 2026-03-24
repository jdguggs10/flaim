# Flaim Architecture

Doc routing: see `docs/INDEX.md`.

Flaim is an MCP (Model Context Protocol) service that connects ESPN, Yahoo, and Sleeper fantasy leagues to AI assistants like Claude, ChatGPT, and Gemini CLI. It handles authentication, credential management, and real-time data fetching — the built-in chat is a secondary feature for testing.

## Quick Start

```bash
git clone https://github.com/jdguggs10/flaim
cd flaim
npm install
cp web/.env.example web/.env.local   # add keys
npm run dev
```

**Prerequisites:** Node 24+, npm, `npm i -g wrangler`

## Core Pieces

- **Chrome Extension (`/extension`)**: Captures ESPN cookies (SWID, espn_s2) and syncs them to Flaim using Clerk Sync Host (no pairing codes).
- **Next.js web app (`/web`)**: Site pages (landing with setup flow, leagues, privacy policy), OAuth consent screens, public live chat demo, and internal dev chat surface.
- **Auth worker (`/workers/auth-worker`)**: Supabase credential + league storage, JWT verification, OAuth token management, extension APIs. Uses Hono for routing.
- **Unified Gateway (`/workers/fantasy-mcp`)**: Single MCP endpoint exposing unified tools for all platforms and sports. Routes to platform-specific workers via service bindings.
- **ESPN Client (`/workers/espn-client`)**: Internal worker handling all ESPN API calls for all sports (football, baseball, basketball, hockey). Called by fantasy-mcp gateway.
- **Yahoo Client (`/workers/yahoo-client`)**: Internal worker handling all Yahoo Fantasy API calls for all sports (football, baseball, basketball, hockey). Called by fantasy-mcp gateway.
- **Sleeper Client (`/workers/sleeper-client`)**: Internal worker handling all Sleeper API calls for NFL and NBA (public API, no auth required). Called by fantasy-mcp gateway.
- **Shared package (`/workers/shared`)**: Common utilities (CORS middleware, auth-fetch helper, types) used by all workers.
- **Supabase Postgres**: `espn_credentials`, `espn_leagues`, `yahoo_leagues`, `sleeper_connections`, `sleeper_leagues`, `user_preferences` (defaults), `oauth_tokens`, `oauth_codes`, `public_chat_runs` (public demo guardrail + run log), plus legacy `rate_limits` (inert — replaced by CF Workers native rate limiting), `extension_tokens`/`extension_pairing_codes` (deprecated).

## Runtime Choices (Next.js)

- **API routes run on the Node.js runtime (default).** We removed Edge runtime flags because these routes are simple proxies/handlers and don't need Edge-specific features.
- This avoids Edge limitations (no ISR, tighter API compatibility) and keeps behavior predictable for Node APIs like `Buffer`.


## Directory Structure

```
web/                        # Next.js app (see web/README.md)
workers/                    # Cloudflare Workers (see workers/README.md)
  auth-worker/              # Auth, OAuth, credentials, leagues
  fantasy-mcp/              # Unified MCP gateway (routes to platform workers)
  espn-client/              # ESPN API client (called by fantasy-mcp)
  yahoo-client/             # Yahoo API client (called by fantasy-mcp)
  sleeper-client/           # Sleeper API client (called by fantasy-mcp; public API)
  shared/                   # @flaim/worker-shared package
extension/                  # Chrome extension (see extension/README.md)
docs/                       # Documentation
```

## What Flaim Is

Flaim is an **authentication and data service**, not a chatbot:

- **MCP Server**: Exposes fantasy league data to Claude, ChatGPT, and Gemini CLI via Model Context Protocol
- **OAuth Provider**: Handles secure authentication between AI clients and ESPN data
- **Credential Manager**: Securely stores ESPN session cookies (via extension or manual entry)

The built-in `/dev` surface is an internal dev/debug lab, not a product feature. It is gated behind Clerk metadata (`chatAccess: true`) at both the page and API level. It exists for manual tool testing and exploratory debugging alongside the structured eval harness (`flaim-eval/`). The public `/chat` route is a separate preset-driven live showcase backed by a dedicated demo account and server-owned auth. See `web/README.md` for access setup.

## Primary User Flow

**Extension path (automatic on sync):**
1. **Sign in** — Create an account at `flaim.app`
2. **Connect ESPN** — Install extension → sync credentials
3. **Auto-discover leagues + past seasons** — Runs during sync/re-sync
4. **Set defaults** — Manage at `/leagues` (extension v1.4.0 no longer handles defaults)

**Manual site path (independent):**
1. **Sign in** — Create an account at `flaim.app`
2. **Add credentials manually** — Use the manual credentials dialog on the landing page
3. **Add leagues** at `/leagues` — Enter league ID + season
4. **Discover seasons (optional)** — Manual per-league action
5. **Pick a default** — `/leagues` default toggle

Both paths write to the same `espn_leagues` storage.

**Connect AI (both paths):**
- Copy the MCP URL from the landing page and add it in Claude, ChatGPT, or Gemini CLI MCP settings.

## Season Year Defaults

Season year defaults are deterministic and use America/New_York time. The canonical form always stores the **start year** of the season.

| Sport | Rollover Date | Rationale |
|-------|--------------|-----------|
| Baseball | Feb 1 | ~10 weeks before Opening Day (late March) |
| Football | Jul 1 | ~10 weeks before NFL kickoff (early September) |
| Basketball | Aug 1 | ~10 weeks before NBA opening night (late October) |
| Hockey | Aug 1 | ~10 weeks before NHL opening night (early October) |

**ESPN normalization:** ESPN uses the END year for NBA/NHL seasons (e.g., `2025` for the 2024-25 season). Flaim normalizes this to the start year internally via `toCanonicalYear()`/`toPlatformYear()` in `workers/auth-worker/src/season-utils.ts`.

## User Defaults

Defaults are stored centrally in `user_preferences`:

- `default_sport` - User's preferred sport (football, baseball, etc.)
- `default_football` - Default football league: `{ platform, leagueId, seasonYear }`
- `default_baseball` - Default baseball league
- `default_basketball` - Default basketball league
- `default_hockey` - Default hockey league

Each per-sport column is nullable JSONB. Cross-platform exclusivity is automatic (one column per sport = one value).

## Chrome Extension

The extension simplifies ESPN credential capture. See `extension/README.md` for full documentation.

```
Extension Popup → Clerk Sync Host → POST /api/extension/sync → Auth Worker → Supabase
     ↓
ESPN Cookies → POST /api/extension/sync → Auth Worker → Supabase
```

**Sync Host flow:**
1. User signs in at `flaim.app` (Clerk session)
2. Extension popup detects the session via Sync Host
3. Extension reads ESPN cookies and syncs to Flaim with Clerk JWT

**Extension APIs** (via Next.js proxy → auth-worker):
| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /extension/sync` | Clerk JWT | Sync ESPN credentials |
| `POST /extension/discover` | Clerk JWT | Discover leagues + historical seasons |
| `GET /extension/status` | Clerk JWT | Check connection status |
| `GET /extension/connection` | Clerk | Web UI status check |

**Security:**
- Clerk JWT verification in auth-worker
- Extension never stores long-lived custom tokens

## Claude + ChatGPT OAuth 2.1

Users connect their own AI subscription to Flaim's MCP servers:

- **MCP URL**: `https://api.flaim.app/mcp` (unified gateway - handles all sports; `/fantasy/mcp` also works as legacy alias)
- **OAuth Flow**: Full OAuth 2.1 with PKCE, Dynamic Client Registration (RFC 7591), Protected Resource Metadata (RFC 9728)
- **Endpoints**: `/auth/register` (DCR), `/auth/authorize`, `/auth/token`, `/auth/revoke`
- **Metadata**: `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource`

**User flow**: Add MCP URL in Claude/ChatGPT → 401 triggers OAuth → user consents at `flaim.app/oauth/consent` → token exchange → tools available.

## MCP Tools

The unified gateway exposes tools with explicit parameters (`platform`, `sport`, `league_id`, `season_year`). See the Unified Gateway Architecture section below for the full tool list. Legacy per-sport workers are still functional but deprecated.

## Unified Gateway Architecture

The unified gateway (`fantasy-mcp`) provides a single MCP endpoint for all platforms and sports, replacing the per-sport workers.

```
Claude/ChatGPT/Gemini CLI → fantasy-mcp (gateway) → espn-client    → ESPN API
                                       → yahoo-client   → Yahoo API
                                       → sleeper-client → Sleeper API (public)
                                       → auth-worker    → Supabase
```

**Key benefits:**
- Single MCP URL for all sports: `https://api.flaim.app/mcp`
- Explicit tool parameters: `platform`, `sport`, `league_id`, `season_year`
- Easier multi-platform support (ESPN + Yahoo + Sleeper)
- Service bindings for worker-to-worker communication (no 522 timeouts)

**Unified tools:**
- `get_user_session` — Current-season leagues only with `structuredContent` for ChatGPT widget rendering
- `get_ancient_history` — Past seasons and historical leagues (everything not in the current season)
- `get_league_info` — League settings (requires platform, sport, league_id, season_year)
- `get_standings` — League standings
- `get_matchups` — Current/specified week matchups
- `get_roster` — Team roster with player details
- `get_free_agents` — Available free agents (platform/sport dependent)
- `get_players` — Player lookup across roster statuses with market/global ownership context (`market_percent_owned`, `ownership_scope`); not league ownership
- `get_transactions` — Recent transactions (adds, drops, waivers, trades)
  - Week semantics are platform-specific in v1: ESPN/Sleeper support explicit week windows; Yahoo uses a recent 14-day timestamp window and ignores explicit week.
  - Yahoo `type=waiver` filter is intentionally unsupported in v1 (waiver enrichment is a separate phase).

**Status:**
- Unified gateway is the sole MCP endpoint (Jan 2026)

## Security

- JWKS-based Clerk JWT verification in auth-worker (5m cache). Prod rejects spoofed headers.
- MCP workers forward `Authorization`; auth-worker alone validates tokens.
- Per-user isolation via verified `sub`; credentials never sent back to client after setup.
- Rate limiting: Cloudflare Workers native `rate_limits` bindings — 10 req/60s per IP on token endpoint, 15 req/60s per user on credentials endpoint, and 5 req/60s per visitor on the public `/chat` demo.
- Public chat concurrency/logging: auth-worker reserves demo runs in Supabase (`public_chat_runs`) so one visitor cannot stack overlapping runs and failures remain visible after the request finishes.
- Public chat warm context: the web app caches Gerry session context and a short "sports today" pulse in Supabase (`public_chat_context_cache`) so the public demo can prewarm context on page load and reduce repeat per-turn latency.
- OAuth tokens stored in Supabase with expiration tracking.
- ESPN credentials: AES-256 encrypted at rest (Supabase default).

See `workers/README.md` for worker-to-worker communication requirements.

## Data Flow

1. User syncs ESPN credentials via extension (or manual entry) → stored in Supabase via auth-worker.
2. User adds leagues at `/leagues` (per-season rows) → stored in Supabase.
3. User connects Claude/ChatGPT → OAuth flow → token stored in Supabase.
4. Claude/ChatGPT calls MCP tool → MCP worker fetches creds from auth-worker → calls ESPN → returns data.

---

## Deployment

### Quick Reference

| I want to... | Do this | What happens |
|--------------|---------|--------------|
| Deploy to prod | Push/merge to `main` | Workers + Frontend auto-deploy (~1-2 min) |
| Test in preview | Open a PR | Workers + Frontend deploy to preview URLs |
| Test locally | `npm run dev` | Nothing deploys, runs on localhost |
| Check deploy status | `gh run list --limit 5` | Shows recent GitHub Actions runs |
| Fix broken prod | Revert commit, push to `main` | Auto-redeploys with fix |
| Instant worker rollback | `wrangler rollback --env prod` in worker dir | Reverts to previous version without git commit |
| Update extension | Manual CWS upload | See `extension/README.md` |

### Automatic Deployment (CI/CD)

**Everything deploys automatically on merge to `main`:**

| Component | Platform | Trigger | Environment |
|-----------|----------|---------|-------------|
| Workers (auth-worker, espn-client, yahoo-client, sleeper-client, fantasy-mcp) | Cloudflare | Push to `main` | `--env prod` |
| Workers (auth-worker, espn-client, yahoo-client, sleeper-client, fantasy-mcp) | Cloudflare | PR opened/updated | `--env preview` |
| Frontend (`/web`) | Vercel | Push to `main` | Production |
| Frontend (`/web`) | Vercel | PR opened/updated | Preview |
| Extension | Chrome Web Store | Manual | N/A |

**GitHub Actions workflows** (`.github/workflows/`):
- `deploy-workers.yml` — Tests + deploys all 5 workers on push/PR (paths-filtered to `workers/**`)
- `check-web.yml` — Lint + type-check for Next.js app (paths-filtered to `web/**`)
- `claude.yml` — Claude Code bot responds to `@claude` mentions in issues/PRs
- `claude-code-review.yml` — Auto-reviews PRs with Claude

### Environments

| Env | ENVIRONMENT | NODE_ENV | Notes |
|-----|-------------|----------|-------|
| dev | dev | development | Local `npm run dev` |
| preview | preview | production | PR deploys (auto) |
| prod | prod | production | main branch (auto) |

### Manual Deploy Commands

Usually not needed since CI/CD handles it, but available for debugging:

- **Workers** (manual fallback, per worker):
  - `cd workers/auth-worker && wrangler deploy --env preview` (or `--env prod`)
  - `cd workers/fantasy-mcp && npm run deploy:preview` (or `npm run deploy:prod`)
  - `cd workers/espn-client && npm run deploy:preview` (or `npm run deploy:prod`)
  - `cd workers/yahoo-client && npm run deploy:preview` (or `npm run deploy:prod`)
  - `cd workers/sleeper-client && npm run deploy:preview` (or `npm run deploy:prod`)
- **Frontend**: Push to `main` or PR (Vercel auto-deploys)
- **Extension**: See `extension/README.md` for Chrome Web Store update process

### Secrets & Environment Variables

- **Frontend**: `web/.env.local` (see `web/README.md`)
- **Workers**: Via `wrangler dev` locally, Cloudflare Dashboard in prod (see `workers/README.md`)
- **GitHub Actions**: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` in repo secrets

### Preview Environment

Opening a PR triggers a full preview stack: Vercel preview deploy + all 5 Cloudflare Workers in `--env preview`. The preview chain is fully isolated from production at the worker level (preview workers bind to each other via service bindings).

**Key differences from production:**

| Layer | Production | Preview |
|-------|-----------|---------|
| Frontend | `flaim.app` (Vercel) | `flaim-git-{branch}-gerald-guggers-projects.vercel.app` |
| Clerk | Production instance (`pk_live_`) | Development instance (`pk_test_`), separate user pool |
| Workers | `auth-worker`, `fantasy-mcp`, etc. | `auth-worker-preview`, `fantasy-mcp-preview`, etc. |
| Supabase | Shared (same instance) | Shared (same instance) |
| Worker URLs | Custom domains (`api.flaim.app/*`) | `.workers.dev` URLs |

**Vercel env vars are scoped by environment.** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_AUTH_WORKER_URL`, and `NEXT_PUBLIC_FANTASY_MCP_URL` each have separate Production and Preview values. Preview points to dev Clerk and preview worker URLs.

**Auth-worker resolves frontend redirects dynamically in preview** — no static `FRONTEND_URL` needed. It reads the `Origin` header (OAuth consent) or stored `redirect_after` (Yahoo callback) and accepts any `flaim-*.vercel.app` origin.

**Supabase is shared.** Preview and prod write to the same database. Clerk instance isolation prevents cross-contamination (dev Clerk user IDs never match prod user IDs). Preview testing may leave orphan rows keyed to dev Clerk IDs — these are inert and can be cleaned up periodically.

**Triggering preview deploys:** Workers only deploy on PRs (not bare branch pushes). A PR must exist for GitHub Actions to run `deploy-workers.yml` with `--env preview`. Vercel deploys on any push.

See Notion (Platform + Infrastructure) for decision rationale.

### DNS for Custom Routes

Cloudflare DNS: `A` record, name `api`, IPv4 `192.0.2.1`, proxied (orange).

Verify: `curl https://api.flaim.app/auth/health`

### Verification

- **Local**: `curl http://localhost:8786/health` (auth-worker), `localhost:3000` (frontend)
- **Remote**: Deployed worker URL + `/health`
- **Check deploy status**: `gh run list --limit 5`

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Double slashes in URLs | Trailing slash in env vars | Remove trailing slashes |
| Extension "Failed to fetch" | Production build loaded locally | Rebuild with `NODE_ENV=development npm run build` |
| Extension not signed in | Clerk session not syncing | Close/reopen extension popup, confirm flaim.app sign-in |
| Chat MCP error 424 "Failed Dependency" | OpenAI can't reach localhost MCP URLs | Deploy workers to preview, update `.env.local` with preview URLs |
| Node.js v25 localStorage warning | Known Node v25 regression | Harmless; suppressed via `--no-webstorage` in dev script |

See `workers/README.md` for worker-specific troubleshooting (522s, 404s, 500s).
