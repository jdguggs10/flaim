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

**Prerequisites:** Node 22+, npm, `npm i -g wrangler`

## Core Pieces

- **Chrome Extension (`/extension`)**: Captures ESPN cookies (SWID, espn_s2) and syncs them to Flaim via pairing code flow.
- **Next.js web app (`/web`)**: Site pages (landing, leagues, connectors, extension setup, privacy policy), OAuth consent screens, optional chat UI.
- **Auth worker (`/workers/auth-worker`)**: Supabase credential + league storage, JWT verification, OAuth token management, extension pairing, rate limiting.
- **Sport MCP workers (`/workers/baseball-espn-mcp`, `/workers/football-espn-mcp`)**: ESPN API calls + MCP tools. Fetch creds/leagues from auth-worker; no local storage.
- **Supabase Postgres**: `espn_credentials`, `espn_leagues`, `oauth_tokens`, `oauth_codes`, `extension_tokens`, `extension_pairing_codes`, `rate_limits`.

## Directory Structure

```
extension/                  # Chrome extension (Manifest V3)
├── dist/                   # Built output for Chrome
├── src/
│   ├── popup/              # React popup UI
│   └── lib/                # API client, storage, ESPN cookie capture
├── manifest.json           # Extension manifest
└── vite.config.ts          # Build config (strips localhost in prod)

web/
├── app/
│   ├── (site)/              # Site pages
│   │   ├── page.tsx         # Landing (/)
│   │   ├── leagues/         # League management (/leagues)
│   │   ├── connectors/      # Connection status (/connectors)
│   │   ├── extension/       # Extension setup + pairing (/extension)
│   │   ├── privacy/         # Privacy policy (/privacy)
│   │   ├── account/         # Account settings (/account)
│   │   └── oauth/consent/   # OAuth consent screen
│   │
│   ├── (chat)/chat/         # Built-in chat UI (/chat) - secondary feature
│   │
│   └── api/
│       ├── auth/            # Platform auth APIs
│       ├── espn/            # League management APIs
│       ├── extension/       # Extension pairing APIs (code, pair, sync, status, token)
│       ├── oauth/           # OAuth APIs (status, revoke)
│       └── chat/            # Chat-only APIs (turn_response, etc.)
│
├── components/
│   ├── site/                # Site-only components
│   ├── chat/                # Chat-only components
│   └── ui/                  # Shared shadcn components
│
└── lib/chat/                # Chat libraries (secondary)
```

**Boundary rules:** Site and chat code are isolated. No cross-imports between `components/site/` and `components/chat/`. Both can use `components/ui/`.

## What Flaim Is

Flaim is an **authentication and data service**, not a chatbot:

- **MCP Server**: Exposes fantasy league data to Claude and ChatGPT via Model Context Protocol
- **OAuth Provider**: Handles secure authentication between AI clients and ESPN data
- **Credential Manager**: Securely stores ESPN session cookies (via extension or manual entry)

The built-in `/chat` is for testing and users without Claude/ChatGPT subscriptions.

## Primary User Flow

1. **Connect ESPN** — Install Chrome extension → sync credentials automatically (or add manually at `/leagues`)
2. **Add leagues** at `/leagues` — Select fantasy teams to connect
3. **Connect AI** at `/connectors` — Link Claude.ai, Claude Desktop, or ChatGPT
4. **Use MCP tools** — Ask about roster, matchups, standings directly in AI

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

See `docs/MCP_CONNECTOR_RESEARCH.md` for full implementation details.

## MCP Tools

Tools available via the MCP servers:

- **Session**: `get_user_session` (both workers) — returns user's configured leagues, team IDs, current date/season.
- **Baseball**: `get_espn_league_info`, `get_espn_team_roster`, `get_espn_matchups`.
- **Football**: `get_espn_football_league_info`, `get_espn_football_team`, `get_espn_football_matchups`, `get_espn_football_standings`.

## Security

- JWKS-based Clerk JWT verification in auth-worker (5m cache). Prod rejects spoofed headers.
- MCP workers forward `Authorization`; auth-worker alone validates tokens.
- Per-user isolation via verified `sub`; credentials never sent back to client after setup.
- Rate limiting: 200 MCP calls/day per user via `rate_limits` table.
- OAuth tokens stored in Supabase with expiration tracking.
- Extension tokens: 64-char hex, rotated on re-pair, revocable.
- ESPN credentials: AES-256 encrypted at rest (Supabase default).

**Critical**: Worker-to-worker calls must use `.workers.dev` URLs. Custom domain (`api.flaim.app`) causes 522 timeouts for intra-zone requests.

## Data Flow

1. User syncs ESPN credentials via extension (or manual entry) → stored in Supabase via auth-worker.
2. User adds leagues at `/leagues` → stored in Supabase.
3. User connects Claude/ChatGPT → OAuth flow → token stored in Supabase.
4. Claude/ChatGPT calls MCP tool → MCP worker fetches creds from auth-worker → calls ESPN → returns data.

## Built-in Chat (Secondary Feature)

The `/chat` page is gated by Clerk metadata and intended for testing:

**Access control**: Users need `publicMetadata.chatAccess: true` in Clerk to access `/chat`. Set this in Clerk Dashboard → Users → [user] → Public metadata:
```json
{ "chatAccess": true }
```

Without this metadata, `/chat` redirects to the home page.

**Debug mode**: Toggle in the tools panel to show raw JSON request/response and execution timing on tool calls. Useful for debugging MCP servers.

---

## Deployment

### Environments

| Env | ENVIRONMENT | NODE_ENV | Notes |
|-----|-------------|----------|-------|
| dev | dev | development | Local `npm run dev` |
| preview | preview | production | PR deploys |
| prod | prod | production | main branch |

### Secrets & Environment Variables

**Local**: `web/.env.local` for frontend, worker vars via `wrangler dev`.

**Preview/Prod**: Vercel for frontend; Cloudflare Dashboard → Worker → Settings → Variables & Secrets for workers.

#### Frontend (`web/.env.local`)

```
OPENAI_API_KEY=...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
NEXT_PUBLIC_AUTH_WORKER_URL=https://api.flaim.app/auth
NEXT_PUBLIC_BASEBALL_ESPN_MCP_URL=https://api.flaim.app/baseball
NEXT_PUBLIC_FOOTBALL_ESPN_MCP_URL=https://api.flaim.app/football
```

#### Auth Worker

```
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=sb_secret_...
CLERK_SECRET_KEY=...
ENVIRONMENT=prod|preview|dev
NODE_ENV=production|development
```

#### MCP Workers (baseball/football)

```
AUTH_WORKER_URL=https://auth-worker.YOUR-ACCOUNT.workers.dev   # direct URL!
CLERK_SECRET_KEY=... (optional)
ENVIRONMENT=prod|preview|dev
NODE_ENV=production|development
```

Ensure auth-worker `wrangler.jsonc` has `"workers_dev": true` in prod so the `.workers.dev` URL exists.

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
| 500s in prod | Missing Cloudflare secrets | Add secrets in dashboard |
| 404s on custom routes | Worker expects stripped path | Remove `/auth`, `/baseball`, `/football` prefixes |
| 522 timeouts (worker-to-worker) | Using custom domain for internal calls | Use `.workers.dev` URL for `AUTH_WORKER_URL` |
| 424 from Responses API | Wrong MCP endpoint | Ensure `server_url` ends with `/mcp` |
| Double slashes in URLs | Trailing slash in env vars | Remove trailing slashes |
| Extension "Failed to fetch" | Production build loaded locally | Rebuild with `NODE_ENV=development npm run build` |
| Extension won't pair | Code expired or invalid | Generate new code at `/extension` |

### ESPN API Reference

Host: `https://lm-api-reads.fantasy.espn.com`

Required headers:
```
Cookie: SWID=...; espn_s2=...
Accept: application/json
X-Fantasy-Source: kona
X-Fantasy-Platform: kona-web-2.0.0
```
