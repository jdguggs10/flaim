# Getting Started & Deployment (Short)

Single reference for setup across `dev`, `preview`, and `prod`. Uses the OpenAI **Responses API** (not legacy chat completions).

## Quick Start
```bash
git clone https://github.com/yourusername/flaim
cd flaim
npm install
cp openai/.env.example openai/.env.local   # add keys
npm run dev
```
Prereqs: Node 22, npm, `npm i -g wrangler`.

## Onboarding Flow (frontend)
1) Clerk sign-in → JWT session  
2) Enter ESPN SWID + espn_s2 → `/api/auth/espn/credentials` → auth-worker stores in Supabase  
3) Provide league IDs → `/api/auth/espn/leagues` → stored per user  
4) Auto-pull → sport worker fetches creds + leagues from auth-worker, calls ESPN, returns details

## Critical Routing Rule
- Worker-to-worker must use direct `.workers.dev` URLs. Custom domains (`api.flaim.app/*`) are only for the frontend.

## Environments
| Env | ENVIRONMENT | NODE_ENV | Notes |
| --- | ----------- | -------- | ----- |
| dev | dev | development | Local `npm run dev` |
| preview | preview | production | PR deploys |
| prod | prod | production | main branch |

## Secrets & Env Vars
- Local: `openai/.env.local` (frontend + worker vars).  
- Preview/Prod: Vercel for frontend; Cloudflare Dashboard → Worker → Settings → Variables & Secrets for workers (prod with custom routes cannot rely on `wrangler secret put`).

Frontend essentials (no wildcards, no trailing slash):
```
OPENAI_API_KEY=...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
NEXT_PUBLIC_AUTH_WORKER_URL=https://api.flaim.app/auth
NEXT_PUBLIC_BASEBALL_ESPN_MCP_URL=https://api.flaim.app/baseball
NEXT_PUBLIC_FOOTBALL_ESPN_MCP_URL=https://api.flaim.app/football
```

Auth worker:
```
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=sb_secret_...
CLERK_SECRET_KEY=...
ENVIRONMENT=prod|preview|dev
NODE_ENV=production|development
```

MCP workers (baseball/football):
```
AUTH_WORKER_URL=https://auth-worker.YOUR-ACCOUNT.workers.dev   # direct URL
CLERK_SECRET_KEY=... (optional)
ENVIRONMENT=prod|preview|dev
NODE_ENV=production|development
```
Ensure auth-worker `wrangler.jsonc` enables `"workers_dev": true` in prod so the `.workers.dev` URL exists.
- MCP transport is JSON-RPC 2.0 via `POST /mcp` (methods: `initialize`, `tools/list`, `tools/call`, `ping`). `GET /mcp` only returns metadata; legacy `/mcp/tools/*` exists solely for manual curl testing.

## DNS for custom routes
Cloudflare DNS: `A`, name `api`, IPv4 `192.0.2.1`, proxied (orange). Verify: `curl https://api.flaim.app/auth/health`.

## Deploy
- Workers: `npm run deploy:workers:preview` or `npm run deploy:workers:prod`
- Frontend: automatic via Vercel (PR → preview, main → prod)

## CI/CD
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` in GitHub Actions for `.github/workflows/deploy-workers.yml`.

## Verify
- Local: `curl http://localhost:8786/health` (auth-worker), `localhost:3000` (frontend)
- Remote: deployed worker URL + `/health`

## Claude + ChatGPT Direct Access (Optional)
Users can connect Claude.ai/Claude Desktop or ChatGPT directly to FLAIM's MCP servers:
1. Set up ESPN credentials at `flaim.app/settings/espn`
2. Add MCP server: `https://api.flaim.app/football/mcp` (or `/baseball/mcp`)
3. Complete OAuth consent flow
4. Use tools like `get_user_session`, `get_espn_football_league_info`, etc.

See `docs/MCP_CONNECTOR_RESEARCH.md` for full testing guide.

## Troubleshooting (fast answers)
- 500s in prod: missing Cloudflare secrets or wrong `NEXT_PUBLIC_*` URLs.
- 404s on custom routes: strip `/auth`, `/baseball`, `/football` prefixes in workers.
- 522 timeouts (worker-to-worker): MCP workers calling auth-worker via custom domain. Fix: use `.workers.dev` URL for `AUTH_WORKER_URL`.
- 504 onboarding: MCP using custom domain → switch to `.workers.dev`, redeploy; ensure `"workers_dev": true`.
- 424 from Responses API: ensure `server_url` ends with `/mcp` and the worker responds to JSON-RPC 2.0 methods (`initialize`, `tools/list`, `tools/call`, `ping`) instead of legacy REST paths.
- Double slashes: remove trailing slash in env URLs.
- ESPN host: use `https://lm-api-reads.fantasy.espn.com` with headers `Cookie: SWID=...; espn_s2=...`, `Accept: application/json`, `X-Fantasy-Source: kona`, `X-Fantasy-Platform: kona-web-2.0.0`.
