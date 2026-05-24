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

These endpoints let Claude, ChatGPT, Perplexity, Gemini, and other MCP clients authenticate to Flaim.

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

MCP OAuth token lifetime:
- Access tokens remain short-lived: 1 hour.
- Refresh tokens rotate on every successful refresh.
- Refresh-token inactivity window defaults to 1 year (`31536000` seconds) and can be overridden with `OAUTH_REFRESH_TOKEN_TTL_SECONDS` (clamped to 1 hour minimum, 1 year maximum).
- This provider-side MCP OAuth flow is separate from the downstream Yahoo OAuth token chain.

Dynamic client registration supports both public PKCE clients (`token_endpoint_auth_method: none`) and confidential clients that request or require `client_secret_post`. Confidential registrations receive a generated `client_secret`; token and refresh exchanges validate that secret and bind confidential authorization codes and refresh tokens to the registered client without storing plaintext client secrets. Confidential client IDs are stateless and HMAC-signed with `OAUTH_CLIENT_REGISTRATION_SIGNING_KEY` when set.

Set a dedicated, stable `OAUTH_CLIENT_REGISTRATION_SIGNING_KEY` in preview and production before relying on confidential MCP clients such as Perplexity. If it is absent, the worker falls back to `SUPABASE_SERVICE_KEY` for compatibility. That fallback keeps deployments running, but rotating the Supabase service key will invalidate existing confidential client registrations and surface as `invalid_client` until those clients reconnect.

### Yahoo Connect (Flaim → Yahoo)

These endpoints manage the OAuth 2.0 client flow with Yahoo Fantasy.

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /connect/yahoo/authorize` | Clerk JWT | Start Yahoo OAuth flow |
| `GET /connect/yahoo/callback` | None (state param) | Handle Yahoo redirect |
| `GET /internal/connect/yahoo/credentials` | Internal + Clerk JWT / OAuth / Eval key | Get Yahoo tokens (auto-refreshes) for internal workers |
| `GET /internal/connect/yahoo/credential-health` | Internal + Clerk JWT / OAuth | Non-secret Yahoo credential/refresh health for diagnostics |
| `GET /connect/yahoo/status` | Clerk JWT | Check Yahoo connection status |
| `DELETE /connect/yahoo/disconnect` | Clerk JWT | Remove Yahoo connection |
| `POST /connect/yahoo/discover` | Clerk JWT | Discover Yahoo leagues |
| `GET /leagues/yahoo` | Clerk JWT | Get stored Yahoo leagues |
| `GET /internal/leagues/yahoo` | Internal + Clerk JWT / OAuth / Eval key | Get stored Yahoo leagues for internal workers |
| `DELETE /leagues/yahoo/:id` | Clerk JWT | Delete a Yahoo league |

Yahoo callback stores the authorization-code token response directly and does not spend the returned refresh token during reconnect. Lazy refresh is the only backend path that uses Yahoo refresh tokens, which keeps reconnect aligned with the standard OAuth authorization-code flow and avoids consuming a brand-new refresh token before the first real post-expiry refresh.

Yahoo access tokens use a 5-minute proactive refresh buffer. This matches the original Yahoo OAuth behavior and avoids sending user-facing tool calls into Yahoo exactly at the 1-hour access-token expiry boundary.

Yahoo refresh requests are one-shot per lease owner. If Yahoo returns a transient token-endpoint failure, Flaim leaves the short per-user lease in place and surfaces retry metadata instead of allowing waiters to immediately become the next owner.

During a transient Yahoo token-endpoint failure, users can see a short retry delay while the per-user lease expires. That delay is intentional: it prevents concurrent requests for the same user from immediately retrying Yahoo after a `429`/`999`/`5xx`.

Yahoo authorization-code exchange sends `redirect_uri` using the registered Flaim callback URL. Yahoo refresh-token exchange intentionally omits `redirect_uri`; this matches the simpler March-era refresh path and avoids coupling lazy refresh to callback URL handling.

Keep `request_has_redirect_uri` diagnostics in place. If this behavior is revisited, require live evidence from successful post-expiry refreshes before changing the refresh-token request shape again.

Lazy refresh uses a single per-user lease. The lease owner makes the Yahoo token request while other callers wait for the winner or receive retry metadata instead of stampeding Yahoo.

Yahoo can rotate refresh tokens on a successful refresh and revoke the previous refresh token. Do not discard a successful Yahoo refresh response just because the lease-owner write guard missed. The recovery path may persist that response only when the database row still contains the exact refresh token used for the request; if another refresh already stored a newer token, the recovery guard misses and the normal reread path wins.

Do not add a persisted token-refresh cooldown without proving Yahoo is asking Flaim to back off and preserving the original upstream error. The earlier cooldown path masked malformed/permanent refresh failures as a generic temporary outage. Current behavior releases the lease after refresh failure, clears legacy `cooldown:` lease markers when encountered, and surfaces the upstream status in the response/logs so reconnect/config/debugging can happen immediately. Confirmed transient failures still return `refresh_temporarily_unavailable`, `retryable: true`, and `Retry-After` metadata so clients can back off without prompting reconnect.

Removing persisted cooldowns intentionally reopens a narrow sequential retry window: after a Yahoo `429`/`999`/`5xx` refresh response, a later request can acquire the lease and try Yahoo again instead of being blocked by a shared cooldown row. Prefer that visibility while diagnosing Yahoo auth; reintroduce a persisted circuit breaker only with tests proving it cannot hide malformed or permanent OAuth failures.

Refresh diagnostics are emitted as structured, non-secret `yahoo-connect` log events with correlation IDs. The refresh path classifies failures with `diagnostic_class` values such as `yahoo_rate_limit`, `yahoo_transient_http`, `yahoo_transient_text`, `yahoo_permanent`, `fetch_error`, `timeout`, `lease_wait_timeout`, and `lease_budget_exhausted`, plus `outcome`, request-timeout, and lease-budget fields where relevant. Token-endpoint diagnostics also include the grant type, callback URL/host/path, whether `redirect_uri` was sent, whether Yahoo client credentials were configured, the caller auth type, response body class, sanitized upstream body text, `retry_after_source` (`upstream_header` or `fallback_default`), and non-secret refresh-token rotation booleans (`refresh_token_returned`, `refresh_token_changed`, recovery fields) so incidents can distinguish Yahoo-provided backoff from Flaim defaults and storage races. These fields are intended for production incident triage without exposing access tokens, refresh tokens, rosters, or raw Yahoo API payloads.

`/internal/connect/yahoo/credential-health` returns no access or refresh tokens. Its `refresh.state` can be `idle`, `in_progress`, `cooldown`, or `expired`; `cooldown` is now a legacy residual state that Flaim clears on encounter rather than an actively written state. `leaseExpiresAt` is included when a lease owner and timestamp exist, including past timestamps for `expired` leases, while `retryAfterSeconds` is only included for active `in_progress` or legacy `cooldown` waits. `lastUpdated` is `null` when the credential row has no update timestamp.

### Sleeper Connect

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /connect/sleeper/discover` | Clerk JWT | Discover Sleeper leagues and prior seasons |
| `GET /connect/sleeper/status` | Clerk JWT | Check Sleeper connection status |
| `DELETE /connect/sleeper/disconnect` | Clerk JWT | Remove Sleeper connection |
| `GET /leagues/sleeper` | Clerk JWT | Get stored Sleeper leagues |
| `GET /internal/leagues/sleeper` | Internal + Clerk JWT / OAuth / Eval key | Get stored Sleeper leagues for internal workers |
| `DELETE /leagues/sleeper/:id` | Clerk JWT | Delete a Sleeper league |

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
| `GET /internal/credentials/espn/raw` | Internal + Clerk JWT / OAuth / Eval key | Get raw ESPN credentials for internal workers |
| `DELETE /credentials/espn` | Clerk JWT | Delete ESPN credentials |
| `GET /leagues` | Clerk JWT | Get ESPN leagues |
| `GET /internal/leagues` | Internal + Clerk JWT / OAuth / Eval key | Get ESPN leagues for internal workers |
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
| `GET /internal/user/preferences` | Internal + Clerk JWT / OAuth / Eval key | Get user preferences for internal workers |
| `POST /user/preferences/default-sport` | Clerk JWT | Set default sport |

## Authentication

Three user auth mechanisms, depending on caller:

- **Clerk JWT** — used by the web app, extension, and frontend OAuth consent flow.
- **OAuth access token** — used by AI clients (Claude, ChatGPT, Gemini) after completing the OAuth 2.1 flow.
- **Eval API key** — static key for eval/CI/agent use. Bypasses OAuth browser flow entirely.

Public app routes are Clerk-only. Internal helper routes additionally require `X-Flaim-Internal-Token` and can resolve Clerk, OAuth, or eval auth to a user ID.

### Eval API Key

A static Bearer token that resolves to a specific Clerk user ID with `mcp:read` scope. Designed for headless eval/CI where browser-based OAuth is impractical.

**Security model:**
- **Default-deny:** Only routes that explicitly opt in via `{ allowEvalApiKey: true }` accept the key. New routes reject it by default.
- **Fixed scope:** Always `mcp:read` — no write/admin access.
- **Constant-time comparison:** Uses SHA-256 digest comparison to prevent timing attacks.
- **Both secrets required:** `EVAL_API_KEY` + `EVAL_USER_ID` must both be set. If only `EVAL_API_KEY` is set, API key auth is skipped (logged) and falls through to OAuth.

**Allowlisted internal routes (MCP-read path only):**
- `GET /auth/internal/introspect`
- `GET /auth/internal/credentials/espn/raw`
- `GET /auth/internal/connect/yahoo/credentials`
- `GET /auth/internal/leagues`
- `GET /auth/internal/leagues/yahoo`
- `GET /auth/internal/leagues/sleeper`
- `GET /auth/internal/user/preferences`

**Current mapping:** `EVAL_USER_ID` → `user_36UBCM4x2hK1aJYY1F7iV1svNw6` (test email on Clerk prod).

**Setup:**
```bash
openssl rand -hex 32   # generate key
cd workers/auth-worker
wrangler secret put EVAL_API_KEY --env prod    # paste key with flaim_eval_ prefix
wrangler secret put EVAL_USER_ID --env prod    # paste Clerk user ID
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

Run SQL migrations from the private `flaim-docs` repository (`migrations/` directory, numbered files) in order.

### 2. Cloudflare Secrets

```bash
wrangler secret put SUPABASE_URL --env preview
wrangler secret put SUPABASE_SERVICE_KEY --env preview
wrangler secret put YAHOO_CLIENT_ID --env preview
wrangler secret put YAHOO_CLIENT_SECRET --env preview
# Optional: if set, keep stable because it signs confidential MCP client IDs
wrangler secret put OAUTH_CLIENT_REGISTRATION_SIGNING_KEY --env preview
# Eval API key (optional — for headless eval/CI)
wrangler secret put EVAL_API_KEY --env preview
wrangler secret put EVAL_USER_ID --env preview
```

### 3. Local Development

Create `.dev.vars` in `workers/auth-worker/`:
```bash
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
YAHOO_CLIENT_ID=your-yahoo-client-id
YAHOO_CLIENT_SECRET=your-yahoo-client-secret
# Optional; defaults to SUPABASE_SERVICE_KEY, but use a dedicated stable value
# in shared environments so Supabase key rotation does not invalidate clients.
OAUTH_CLIENT_REGISTRATION_SIGNING_KEY=your-stable-signing-key
```

## Development

```bash
corepack pnpm --dir workers/auth-worker run dev          # Start dev server
corepack pnpm --dir workers/auth-worker run type-check   # Type check
corepack pnpm --dir workers/auth-worker run deploy       # Deploy
```

## League Storage Notes

- Leagues are stored per season year; `(user, sport, leagueId, seasonYear)` is unique.
- Deleting a league removes all seasons for that league.
- Shared season helper logic now lives in `@flaim/worker-shared` (`src/season.ts`); `src/season-utils.ts` stays as a backward-compatible wrapper for local imports.
- `src/v3/get-league-info.ts` returns canonical start years in `seasonYear`, `settings.season`, and `status.previousSeasons`; ESPN-native end years are only used for upstream ESPN requests.
- Sleeper league responses keep the season-specific `leagueId` for direct tool calls, and also persist a `recurringLeagueId` during discovery when auth-worker can successfully follow Sleeper's `previous_league_id` chain. Read paths prefer the stored recurring ID and only fall back to live chain resolution for legacy rows or unresolved discovery rows that do not have it yet.
- During the `sleeper_leagues.recurring_league_id` rollout, discovery writes retry without that column if the live database schema has not been migrated yet, which preserves the legacy read fallback until the migration lands.
