# FLAIM Architecture (Short)

AI-powered fantasy sports assistant using Clerk auth, Supabase storage, and sport-specific MCP workers for ESPN data. OpenAI calls use the **Responses API** (not chat completions).

## Core Pieces
- **Next.js frontend (`/openai`)**: chat UI, onboarding, usage tracking.
- **Auth worker (`/auth`)**: Supabase credential + league storage, JWT verification, usage checks. Stateless; only verified JWTs in prod.
- **Sport MCP workers (`/workers/baseball-espn-mcp`, `/workers/football-espn-mcp`)**: ESPN calls + MCP tools; fetch creds/leagues from auth-worker; no local storage.
- **Supabase Postgres**: `espn_credentials`, `espn_leagues`.

## Security Highlights
- JWKS-based Clerk JWT verification in auth-worker (5m cache). Prod rejects spoofed headers; dev allows limited fallback.
- MCP workers forward `Authorization`; auth-worker alone validates tokens.
- Per-user isolation via verified `sub`; credentials never sent back to client after setup.
- Use `.workers.dev` URLs for worker-to-worker calls; custom domains are frontend-only.
- MCP transport: `POST /mcp` JSON-RPC 2.0 (Responses API). Methods: `initialize`, `tools/list`, `tools/call`, `ping`. `GET /mcp` returns metadata. Legacy REST under `/mcp/tools/*` kept only for manual curl testing.

## Data Flow (credentialed requests)
1) Frontend gets JWT via Clerk → sends to auth-worker.
2) Auth-worker verifies JWT, fetches creds/leagues from Supabase.
3) Sport worker calls auth-worker (direct `.workers.dev`) to get creds → calls ESPN → returns to frontend/assistant.

## LLM Context Injection
- **System prompt** (`lib/prompts/system-prompt.ts`): Static instructions defining assistant behavior and available tools.
- **League context** (`lib/prompts/league-context.ts`): Dynamic context built from `useOnboardingStore.getActiveLeague()` — injects active league ID, sport, team name so LLM knows which league to query.
- Both injected as `developer` role messages in `processMessages()` before conversation history.
- Edit templates in `lib/prompts/` to tweak LLM behavior without touching core logic.

## MCP Tools (live data)
- **Session**: `get_user_session` (both workers) — returns user's configured leagues, team IDs, current date/season. Call first.
- **Baseball**: `get_espn_league_info`, `get_espn_team_roster`, `get_espn_matchups`.
- **Football**: `get_espn_football_league_info`, `get_espn_football_team`, `get_espn_football_matchups`, `get_espn_football_standings`.

## Deployment Notes
- Frontend on Vercel; workers on Cloudflare. GitOps: PR → preview, main → prod.  
- Keep `"workers_dev": true` on auth-worker prod to expose the direct URL.  
- Environment setup and troubleshooting live in `docs/GETTING_STARTED.md`.

## Claude + ChatGPT Direct Access (OAuth 2.1) ✅ Working

End users can connect Claude Desktop/Claude.ai or ChatGPT directly to FLAIM's MCP servers, enabling "bring your own subscription" usage:
- **MCP URL**: `https://api.flaim.app/football/mcp` or `https://api.flaim.app/baseball/mcp`
- **OAuth Flow**: Full OAuth 2.1 with PKCE, Dynamic Client Registration (RFC 7591), and Protected Resource Metadata (RFC 9728).
- **Endpoints**: `/auth/register` (DCR), `/auth/authorize`, `/auth/token`, `/auth/revoke`.
- **Metadata**: `/.well-known/oauth-authorization-server` (auth server), `/{sport}/.well-known/oauth-protected-resource` (MCP workers).
- **User flow**: Claude/ChatGPT adds MCP URL → 401 triggers OAuth → user consents at `flaim.app/oauth/consent` → token exchange → client accesses tools.
- **Rate limiting**: 200 calls/day per user via `rate_limits` table.
- **Token storage**: `oauth_codes` and `oauth_tokens` tables in Supabase.
- **ChatGPT requirements**: `securitySchemes` on each tool plus `_meta["mcp/www_authenticate"]` on 401 errors.

**Critical**: MCP workers must call auth-worker via `.workers.dev` URLs (not custom domain) to avoid intra-zone 522 timeouts.

See `docs/MCP_CONNECTOR_RESEARCH.md` for full implementation details and testing guide.
