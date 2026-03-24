# Auth Worker

Centralized Cloudflare Worker for authentication, credential storage, and OAuth. Uses Hono for routing, Supabase for persistence.

## Overview

This worker has three distinct responsibilities:

1. **Credential/Connection Storage** — ESPN credentials, Yahoo tokens, Sleeper connections, and league data, stored in Supabase.
2. **OAuth 2.1 Provider** — Flaim *issues* access tokens to AI clients (Claude, ChatGPT, Gemini) so they can call MCP tools on behalf of users.
3. **OAuth 2.0 Client** — Flaim *obtains* tokens from Yahoo so it can call Yahoo Fantasy APIs on behalf of users.

> Roles 2 and 3 are opposite sides of OAuth. The provider issues tokens; the client consumes them. They share no code paths.

## Endpoints

### Health

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /health` | None | Health check with Supabase connectivity test |

### OAuth 2.1 Provider (AI clients → Flaim)

These endpoints let Claude, ChatGPT, and Gemini authenticate via MCP.

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /.well-known/oauth-authorization-server` | None | Server metadata discovery |
| `POST /auth/register` | None | Dynamic Client Registration (RFC 7591) |
| `GET /auth/authorize` | None | Authorization endpoint → redirects to consent page |
| `POST /auth/token` | None | Token exchange (auth code → access token) |
| `POST /auth/revoke` | None | Token revocation |
| `POST /oauth/code` | Clerk JWT | Frontend creates auth code after user consent |
| `GET /oauth/status` | Clerk JWT | Check if user has active AI connections |
| `POST /oauth/revoke-all` | Clerk JWT | Revoke all AI client tokens |
| `POST /oauth/revoke` | Clerk JWT | Revoke a single AI client token |

OAuth consent callback note:
The consent screen accepts `oauth_state` (preferred) and legacy `state` query params.
This avoids state collisions during sign-in redirects while maintaining backward compatibility.

### Yahoo Connect (Flaim → Yahoo)

These endpoints manage the OAuth 2.0 client flow with Yahoo Fantasy.

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /connect/yahoo/authorize` | Clerk JWT | Start Yahoo OAuth flow |
| `GET /connect/yahoo/callback` | None (state param) | Handle Yahoo redirect |
| `GET /internal/connect/yahoo/credentials` | Internal + Clerk JWT / OAuth / static API key | Get Yahoo tokens (auto-refreshes) for internal workers |
| `GET /connect/yahoo/status` | Clerk JWT | Check Yahoo connection status |
| `DELETE /connect/yahoo/disconnect` | Clerk JWT | Remove Yahoo connection |
| `POST /connect/yahoo/discover` | Clerk JWT | Discover Yahoo leagues |
| `GET /leagues/yahoo` | Clerk JWT | Get stored Yahoo leagues |
| `GET /internal/leagues/yahoo` | Internal + Clerk JWT / OAuth / static API key | Get stored Yahoo leagues for internal workers |
| `DELETE /leagues/yahoo/:id` | Clerk JWT | Delete a Yahoo league |

### Extension APIs

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /extension/sync` | Clerk JWT | Sync ESPN credentials from extension |
| `GET /extension/status` | Clerk JWT | Extension connection status |
| `GET /extension/connection` | Clerk JWT | Web UI connection check |
| `POST /extension/discover` | Clerk JWT | Auto-discover ESPN leagues |

### ESPN Credentials & Leagues

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /credentials/espn` | Clerk JWT | Store ESPN credentials |
| `GET /credentials/espn` | Clerk JWT | Get ESPN credential metadata |
| `GET /internal/credentials/espn/raw` | Internal + Clerk JWT / OAuth / static API key | Get raw ESPN credentials for internal workers |
| `DELETE /credentials/espn` | Clerk JWT | Delete ESPN credentials |
| `GET /leagues` | Clerk JWT | Get ESPN leagues |
| `GET /internal/leagues` | Internal + Clerk JWT / OAuth / static API key | Get ESPN leagues for internal workers |
| `POST /leagues` | Clerk JWT | Store ESPN leagues |
| `POST /leagues/add` | Clerk JWT | Add a single ESPN league (season-aware) |
| `DELETE /leagues` | Clerk JWT | Remove all seasons for a league |
| `PATCH /leagues/:leagueId/team` | Clerk JWT | Update team selection |
| `POST /leagues/default` | Clerk JWT | Set default league |
| `DELETE /leagues/default/:sport` | Clerk JWT | Remove default league |

### User Preferences

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /user/preferences` | Clerk JWT | Get user preferences |
| `GET /internal/user/preferences` | Internal + Clerk JWT / OAuth / static API key | Get user preferences for internal workers |
| `POST /user/preferences/default-sport` | Clerk JWT | Set default sport |

## Authentication

Three user auth mechanisms, depending on caller:

- **Clerk JWT** — used by the web app, extension, and frontend OAuth consent flow.
- **OAuth access token** — used by AI clients (Claude, ChatGPT, Gemini) after completing the OAuth 2.1 flow.
- **Static API keys** — fixed-user keys for eval/CI and the public demo account. These bypass browser-based OAuth.

Public app routes are Clerk-only. Internal helper routes additionally require `X-Flaim-Internal-Token` and can resolve Clerk, OAuth, or static API key auth to a user ID.

### Static API Keys

A static Bearer token resolves to a specific Clerk user ID with `mcp:read` scope. Flaim currently uses two:

- `EVAL_API_KEY` / `EVAL_USER_ID` for headless eval and CI
- `DEMO_API_KEY` / `DEMO_USER_ID` for the public `/chat` demo account

**Security model:**
- **Default-deny:** Only routes that explicitly opt in via `{ allowStaticApiKey: true }` accept these keys. New routes reject them by default.
- **Fixed scope:** Always `mcp:read` — no write/admin access.
- **Constant-time comparison:** Uses SHA-256 digest comparison to prevent timing attacks.
- **Both secrets required:** each key requires its matching user ID. If a key is set without its user ID, that auth path is skipped (logged) and falls through to OAuth.

**Allowlisted internal routes (MCP-read path only):**
- `GET /auth/internal/introspect`
- `GET /auth/internal/credentials/espn/raw`
- `GET /auth/internal/connect/yahoo/credentials`
- `GET /auth/internal/leagues`
- `GET /auth/internal/leagues/yahoo`
- `GET /auth/internal/user/preferences`

**Setup:**
```bash
openssl rand -hex 32   # generate key
cd workers/auth-worker
wrangler secret put EVAL_API_KEY --env prod    # paste key with flaim_eval_ prefix
wrangler secret put EVAL_USER_ID --env prod    # paste Clerk user ID
wrangler secret put DEMO_API_KEY --env prod    # paste key with flaim_demo_ prefix
wrangler secret put DEMO_USER_ID --env prod    # paste Clerk user ID for demo@flaim.app
```

## Key Source Files

| File | Role | Purpose |
|------|------|---------|
| `index-hono.ts` | Router | All route definitions, JWT verification, middleware |
| `oauth-handlers.ts` | Provider | OAuth 2.1 authorization server endpoints |
| `oauth-storage.ts` | Provider | Auth codes, tokens, rate limits in Supabase |
| `yahoo-connect-handlers.ts` | Client | Yahoo OAuth 2.0 client flow |
| `yahoo-storage.ts` | Client | Yahoo tokens in Supabase |
| `supabase-storage.ts` | Storage | ESPN credentials and leagues |
| `extension-handlers.ts` | Extension | Chrome extension sync APIs |

## Setup

### 1. Supabase

Run migrations from `docs/migrations/` in order.

### 2. Cloudflare Secrets

```bash
wrangler secret put SUPABASE_URL --env preview
wrangler secret put SUPABASE_SERVICE_KEY --env preview
wrangler secret put YAHOO_CLIENT_ID --env preview
wrangler secret put YAHOO_CLIENT_SECRET --env preview
# Eval API key (optional — for headless eval/CI)
wrangler secret put EVAL_API_KEY --env preview
wrangler secret put EVAL_USER_ID --env preview
# Public demo API key (optional — for /chat)
wrangler secret put DEMO_API_KEY --env preview
wrangler secret put DEMO_USER_ID --env preview
```

### 3. Local Development

Create `.dev.vars` in `workers/auth-worker/`:
```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
YAHOO_CLIENT_ID=your-yahoo-client-id
YAHOO_CLIENT_SECRET=your-yahoo-client-secret
EVAL_API_KEY=flaim_eval_local
EVAL_USER_ID=user_eval_local
DEMO_API_KEY=flaim_demo_local
DEMO_USER_ID=user_demo_local
```

## Development

```bash
npm run dev          # Start dev server
npx tsc --noEmit     # Type check
npm run deploy       # Deploy
```

## League Storage Notes

- Leagues are stored per season year; `(user, sport, leagueId, seasonYear)` is unique.
- Deleting a league removes all seasons for that league.
- OAuth/token and credential helper routes use Cloudflare native rate limiters.
- The public `/chat` demo uses a dedicated 5 requests / 60 seconds per-visitor limiter plus a single in-flight run cap backed by `public_chat_runs`.
