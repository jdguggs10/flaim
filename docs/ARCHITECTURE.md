# Flaim Architecture

Doc routing: see `docs/INDEX.md`.

Flaim is an MCP (Model Context Protocol) service that connects ESPN fantasy leagues to AI assistants like Claude, ChatGPT, and Gemini CLI. It handles authentication, credential management, and real-time data fetching — the built-in chat is a secondary feature for testing.

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
- **Next.js web app (`/web`)**: Site pages (landing with setup flow, leagues, privacy policy), OAuth consent screens, optional chat UI.
- **Auth worker (`/workers/auth-worker`)**: Supabase credential + league storage, JWT verification, OAuth token management, extension APIs. Uses Hono for routing.
- **Unified Gateway (`/workers/fantasy-mcp`)**: Single MCP endpoint exposing unified tools for all platforms and sports. Routes to platform-specific workers via service bindings.
- **ESPN Client (`/workers/espn-client`)**: Internal worker handling all ESPN API calls for all sports (football, baseball, basketball, hockey). Called by fantasy-mcp gateway.
- **Yahoo Client (`/workers/yahoo-client`)**: Internal worker handling all Yahoo Fantasy API calls for all sports (football, baseball, basketball, hockey). Called by fantasy-mcp gateway.
- **Sleeper Client (`/workers/sleeper-client`)**: Internal worker handling all Sleeper API calls for NFL and NBA (public API, no auth required). Called by fantasy-mcp gateway.
- **Shared package (`/workers/shared`)**: Common utilities (CORS middleware, auth-fetch helper, types) used by all workers.
- **Supabase Postgres**: `espn_credentials`, `espn_leagues`, `yahoo_leagues`, `sleeper_connections`, `sleeper_leagues`, `user_preferences` (defaults), `oauth_tokens`, `oauth_codes`, `rate_limits`, plus legacy `extension_tokens`/`extension_pairing_codes` (deprecated).

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

The built-in `/chat` is for testing and users without Claude/ChatGPT subscriptions.

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
- Copy the MCP URLs from the landing page and add them as custom connectors in Claude, ChatGPT, or Gemini CLI.

## Season Year Defaults

Season year defaults are deterministic and use America/New_York time:

- **Baseball (flb)**: Defaults to the previous year until Feb 1, then switches to the current year
- **Football (ffl)**: Defaults to the previous year until Jul 1, then switches to the current year

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
- `get_user_session` — All configured leagues across platforms with IDs
- `get_ancient_history` — Historical leagues and seasons (2+ years old)
- `get_league_info` — League settings (requires platform, sport, league_id, season_year)
- `get_standings` — League standings
- `get_matchups` — Current/specified week matchups
- `get_roster` — Team roster with player details
- `get_free_agents` — Available free agents (platform/sport dependent)

**Status:**
- Unified gateway is the sole MCP endpoint (Jan 2026)

## Security

- JWKS-based Clerk JWT verification in auth-worker (5m cache). Prod rejects spoofed headers.
- MCP workers forward `Authorization`; auth-worker alone validates tokens.
- Per-user isolation via verified `sub`; credentials never sent back to client after setup.
- Rate limiting: 200 MCP calls/day per user via `rate_limits` table.
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
- `deploy-workers.yml` — Deploys all 5 workers on push/PR via wrangler
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
