# Getting Started & Deployment

Setup guide for `dev`, `preview`, and `prod` environments.

## Quick Start

```bash
git clone https://github.com/yourusername/flaim
cd flaim
npm install
cp web/.env.example web/.env.local   # add keys
npm run dev
```

Prereqs: Node 22+, npm, `npm i -g wrangler`.

## User Setup Flow

1. **Sign in** via Clerk
2. **Add ESPN credentials** at `/leagues` — SWID and espn_s2 cookies
3. **Add leagues** — enter league ID, verify, select your team
4. **Connect AI** at `/connectors` — copy MCP URL into Claude or ChatGPT

No wizard or multi-step onboarding. Users manage everything from the `/leagues` page.

## Critical Routing Rule

Worker-to-worker calls must use direct `.workers.dev` URLs. Custom domains (`api.flaim.app/*`) are only for external clients.

## Environments

| Env | ENVIRONMENT | NODE_ENV | Notes |
|-----|-------------|----------|-------|
| dev | dev | development | Local `npm run dev` |
| preview | preview | production | PR deploys |
| prod | prod | production | main branch |

## Secrets & Env Vars

**Local**: `web/.env.local` for frontend, worker vars via `wrangler dev`.

**Preview/Prod**: Vercel for frontend; Cloudflare Dashboard → Worker → Settings → Variables & Secrets for workers.

### Frontend (`web/.env.local`)

```
OPENAI_API_KEY=...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
NEXT_PUBLIC_AUTH_WORKER_URL=https://api.flaim.app/auth
NEXT_PUBLIC_BASEBALL_ESPN_MCP_URL=https://api.flaim.app/baseball
NEXT_PUBLIC_FOOTBALL_ESPN_MCP_URL=https://api.flaim.app/football
```

### Auth Worker

```
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=sb_secret_...
CLERK_SECRET_KEY=...
ENVIRONMENT=prod|preview|dev
NODE_ENV=production|development
```

### MCP Workers (baseball/football)

```
AUTH_WORKER_URL=https://auth-worker.YOUR-ACCOUNT.workers.dev   # direct URL!
CLERK_SECRET_KEY=... (optional)
ENVIRONMENT=prod|preview|dev
NODE_ENV=production|development
```

Ensure auth-worker `wrangler.jsonc` has `"workers_dev": true` in prod so the `.workers.dev` URL exists.

## DNS for Custom Routes

Cloudflare DNS: `A` record, name `api`, IPv4 `192.0.2.1`, proxied (orange).

Verify: `curl https://api.flaim.app/auth/health`

## Deploy

- **Workers**: `npm run deploy:workers:preview` or `npm run deploy:workers:prod`
- **Frontend**: Automatic via Vercel (PR → preview, main → prod)

## CI/CD

Add to GitHub Actions secrets:
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Used by `.github/workflows/deploy-workers.yml`.

## Verify

- **Local**: `curl http://localhost:8786/health` (auth-worker), `localhost:3000` (frontend)
- **Remote**: Deployed worker URL + `/health`

## Connecting Claude or ChatGPT

After setting up leagues:

1. Go to `/connectors`
2. Copy the MCP URL (e.g., `https://api.flaim.app/football/mcp`)
3. Add as MCP server in Claude.ai, Claude Desktop, or ChatGPT
4. Complete OAuth consent flow when prompted
5. Use tools like `get_user_session`, `get_espn_football_league_info`, etc.

See `docs/MCP_CONNECTOR_RESEARCH.md` for detailed OAuth implementation.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| 500s in prod | Missing Cloudflare secrets | Add secrets in dashboard |
| 404s on custom routes | Worker expects stripped path | Remove `/auth`, `/baseball`, `/football` prefixes |
| 522 timeouts (worker-to-worker) | Using custom domain for internal calls | Use `.workers.dev` URL for `AUTH_WORKER_URL` |
| 424 from Responses API | Wrong MCP endpoint | Ensure `server_url` ends with `/mcp` |
| Double slashes in URLs | Trailing slash in env vars | Remove trailing slashes |

### ESPN API Notes

Host: `https://lm-api-reads.fantasy.espn.com`

Required headers:
```
Cookie: SWID=...; espn_s2=...
Accept: application/json
X-Fantasy-Source: kona
X-Fantasy-Platform: kona-web-2.0.0
```
