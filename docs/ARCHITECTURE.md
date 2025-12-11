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

## MCP Tools (live data)
- Baseball: `get_espn_league_info`, `get_espn_team_roster`, `get_espn_matchups`.
- Football: `get_espn_football_league_info`, `get_espn_football_team`, `get_espn_football_matchups`, `get_espn_football_standings`.

## Deployment Notes
- Frontend on Vercel; workers on Cloudflare. GitOps: PR → preview, main → prod.  
- Keep `"workers_dev": true` on auth-worker prod to expose the direct URL.  
- Environment setup and troubleshooting live in `docs/GETTING_STARTED.md`.
