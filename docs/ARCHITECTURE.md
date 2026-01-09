# Flaim Architecture

Flaim is an MCP (Model Context Protocol) service that connects ESPN fantasy leagues to AI assistants like Claude and ChatGPT. It handles authentication, credential management, and real-time data fetching — the built-in chat is a secondary feature for testing.

## Quick Start

```bash
git clone https://github.com/yourusername/flaim
cd flaim
npm install
cp web/.env.example web/.env.local   # add keys
npm run dev
```

**Prerequisites:** Node 24+, npm, `npm i -g wrangler`

## Core Pieces

- **Chrome Extension (`/extension`)**: Captures ESPN cookies (SWID, espn_s2) and syncs them to Flaim via pairing code flow.
- **Next.js web app (`/web`)**: Site pages (landing, leagues, connectors, extension setup, privacy policy), OAuth consent screens, optional chat UI.
- **Auth worker (`/workers/auth-worker`)**: Supabase credential + league storage, JWT verification, OAuth token management, extension pairing, rate limiting.
- **Sport MCP workers (`/workers/baseball-espn-mcp`, `/workers/football-espn-mcp`)**: ESPN API calls + MCP tools. Fetch creds/leagues from auth-worker; no local storage.
- **Supabase Postgres**: `espn_credentials`, `espn_leagues` (per-season rows), `oauth_tokens`, `oauth_codes`, `extension_tokens`, `extension_pairing_codes`, `rate_limits`.

## Runtime Choices (Next.js)

- **API routes run on the Node.js runtime (default).** We removed Edge runtime flags because these routes are simple proxies/handlers and don't need Edge-specific features.
- This avoids Edge limitations (no ISR, tighter API compatibility) and keeps behavior predictable for Node APIs like `Buffer`.


## Directory Structure

```
web/                        # Next.js app (see web/README.md)
workers/                    # Cloudflare Workers (see workers/README.md)
extension/                  # Chrome extension (see extension/README.md)
docs/                       # Documentation
```

## What Flaim Is

Flaim is an **authentication and data service**, not a chatbot:

- **MCP Server**: Exposes fantasy league data to Claude and ChatGPT via Model Context Protocol
- **OAuth Provider**: Handles secure authentication between AI clients and ESPN data
- **Credential Manager**: Securely stores ESPN session cookies (via extension or manual entry)

The built-in `/chat` is for testing and users without Claude/ChatGPT subscriptions.

## Primary User Flow

1. **Connect ESPN** — Install Chrome extension → sync credentials automatically (or add manually at `/leagues`)
2. **Add leagues** at `/leagues` — Select teams and confirm season year (auto-defaults based on sport)
3. **Discover seasons (optional)** — Auto-add historical seasons for a league
4. **Connect AI** at `/connectors` — Link Claude.ai, Claude Desktop, or ChatGPT
5. **Use MCP tools** — Ask about roster, matchups, standings directly in AI

## Season Year Defaults

Season year defaults are deterministic and use America/New_York time:

- **Baseball (flb)**: Defaults to the previous year until Feb 1, then switches to the current year
- **Football (ffl)**: Defaults to the previous year until Jun 1, then switches to the current year

## Chrome Extension

The extension simplifies ESPN credential capture. See `extension/README.md` for full documentation.

```
Extension Popup → POST /api/extension/pair → Auth Worker → Supabase
     ↓
ESPN Cookies → POST /api/extension/sync → Auth Worker → Supabase
```

**Pairing flow:**
1. User generates 6-character code at `/extension` (valid 10 minutes)
2. User enters code in extension popup
3. Extension receives token, stores locally
4. Extension reads ESPN cookies and syncs to Flaim

**Extension APIs** (via Next.js proxy → auth-worker):
| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /extension/code` | Clerk | Generate pairing code |
| `POST /extension/pair` | Code | Exchange code for token |
| `POST /extension/sync` | Bearer | Sync ESPN credentials |
| `POST /extension/discover` | Bearer | Discover leagues + historical seasons |
| `POST /extension/set-default` | Bearer | Set user's default league |
| `GET /extension/status` | Bearer | Check connection status |
| `GET /extension/connection` | Clerk | Web UI status check |
| `DELETE /extension/token` | Clerk | Revoke extension |

**Security:**
- Rate limiting: 5 codes/hour per user, 10 pair attempts/10min per IP
- Atomic pairing prevents race conditions
- Token rotation on re-pair (old extension gets 401)

## Claude + ChatGPT OAuth 2.1

Users connect their own AI subscription to Flaim's MCP servers:

- **MCP URLs**: `https://api.flaim.app/football/mcp`, `https://api.flaim.app/baseball/mcp`
- **OAuth Flow**: Full OAuth 2.1 with PKCE, Dynamic Client Registration (RFC 7591), Protected Resource Metadata (RFC 9728)
- **Endpoints**: `/auth/register` (DCR), `/auth/authorize`, `/auth/token`, `/auth/revoke`
- **Metadata**: `/.well-known/oauth-authorization-server`, `/{sport}/.well-known/oauth-protected-resource`

**User flow**: Add MCP URL in Claude/ChatGPT → 401 triggers OAuth → user consents at `flaim.app/oauth/consent` → token exchange → tools available.

## MCP Tools

Both MCP workers expose `get_user_session` plus sport-specific tools for league info, rosters, matchups, and standings. `get_user_session` includes season year per league and the current default league. See `workers/README.md` for the full tool list and ESPN API reference.

## Security

- JWKS-based Clerk JWT verification in auth-worker (5m cache). Prod rejects spoofed headers.
- MCP workers forward `Authorization`; auth-worker alone validates tokens.
- Per-user isolation via verified `sub`; credentials never sent back to client after setup.
- Rate limiting: 200 MCP calls/day per user via `rate_limits` table.
- OAuth tokens stored in Supabase with expiration tracking.
- Extension tokens: 64-char hex, rotated on re-pair, revocable.
- ESPN credentials: AES-256 encrypted at rest (Supabase default).

See `workers/README.md` for worker-to-worker communication requirements.

## Data Flow

1. User syncs ESPN credentials via extension (or manual entry) → stored in Supabase via auth-worker.
2. User adds leagues at `/leagues` (per-season rows) → stored in Supabase.
3. User connects Claude/ChatGPT → OAuth flow → token stored in Supabase.
4. Claude/ChatGPT calls MCP tool → MCP worker fetches creds from auth-worker → calls ESPN → returns data.

---

## Deployment

### Environments

| Env | ENVIRONMENT | NODE_ENV | Notes |
|-----|-------------|----------|-------|
| dev | dev | development | Local `npm run dev` |
| preview | preview | production | PR deploys |
| prod | prod | production | main branch |

### Secrets & Environment Variables

- **Frontend**: `web/.env.local` (see `web/README.md`)
- **Workers**: Via `wrangler dev` locally, Cloudflare Dashboard in prod (see `workers/README.md`)

### DNS for Custom Routes

Cloudflare DNS: `A` record, name `api`, IPv4 `192.0.2.1`, proxied (orange).

Verify: `curl https://api.flaim.app/auth/health`

### Deploy Commands

- **Workers**: `npm run deploy:workers:preview` or `npm run deploy:workers:prod`
- **Frontend**: Automatic via Vercel (PR → preview, main → prod)
- **Extension**: See `extension/README.md` for CWS update process

### CI/CD

Add to GitHub Actions secrets:
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Used by `.github/workflows/deploy-workers.yml`.

### Verification

- **Local**: `curl http://localhost:8786/health` (auth-worker), `localhost:3000` (frontend)
- **Remote**: Deployed worker URL + `/health`

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Double slashes in URLs | Trailing slash in env vars | Remove trailing slashes |
| Extension "Failed to fetch" | Production build loaded locally | Rebuild with `NODE_ENV=development npm run build` |
| Extension won't pair | Code expired or invalid | Generate new code at `/extension` |

See `workers/README.md` for worker-specific troubleshooting (522s, 404s, 500s).
