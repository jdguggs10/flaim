# Auth Worker

Centralized Cloudflare Worker for authentication, credential storage, and OAuth. Uses Hono for routing, Supabase for persistence.

## Overview

This worker has three distinct responsibilities:

1. **Credential Storage** — ESPN cookies and league data, stored in Supabase.
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

### Yahoo Connect (Flaim → Yahoo)

These endpoints manage the OAuth 2.0 client flow with Yahoo Fantasy.

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /connect/yahoo/authorize` | Clerk JWT | Start Yahoo OAuth flow |
| `GET /connect/yahoo/callback` | None (state param) | Handle Yahoo redirect |
| `GET /connect/yahoo/credentials` | Clerk JWT / OAuth | Get Yahoo tokens (auto-refreshes) |
| `GET /connect/yahoo/status` | Clerk JWT | Check Yahoo connection status |
| `DELETE /connect/yahoo/disconnect` | Clerk JWT | Remove Yahoo connection |
| `POST /connect/yahoo/discover` | Clerk JWT | Discover Yahoo leagues |
| `GET /leagues/yahoo` | Clerk JWT / OAuth | Get stored Yahoo leagues |
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
| `GET /credentials/espn` | Clerk JWT / OAuth | Get ESPN credential metadata (or raw with `?raw=true`) |
| `DELETE /credentials/espn` | Clerk JWT | Delete ESPN credentials |
| `GET /leagues` | Clerk JWT / OAuth | Get ESPN leagues |
| `POST /leagues` | Clerk JWT | Store ESPN leagues |
| `POST /leagues/add` | Clerk JWT | Add a single ESPN league (season-aware) |
| `DELETE /leagues` | Clerk JWT | Remove all seasons for a league |
| `PATCH /leagues/:leagueId/team` | Clerk JWT | Update team selection |
| `POST /leagues/default` | Clerk JWT | Set default league |
| `DELETE /leagues/default/:sport` | Clerk JWT | Remove default league |

### User Preferences

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /user/preferences` | Clerk JWT / OAuth | Get user preferences |
| `POST /user/preferences/default-sport` | Clerk JWT | Set default sport |

## Authentication

Two auth mechanisms, depending on caller:

- **Clerk JWT** — used by the web app, extension, and frontend OAuth consent flow.
- **OAuth access token** — used by AI clients (Claude, ChatGPT, Gemini) after completing the OAuth 2.1 flow.

Both are validated in middleware; the resolved `userId` is the same regardless of method.

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
```

### 3. Local Development

Create `.dev.vars` in `workers/auth-worker/`:
```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
YAHOO_CLIENT_ID=your-yahoo-client-id
YAHOO_CLIENT_SECRET=your-yahoo-client-secret
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
- Rate limit: 200 MCP calls/day per user (via `rate_limits` table).
