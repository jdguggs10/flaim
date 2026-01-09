# Flaim Workers

Three Cloudflare Workers handling authentication and MCP data fetching.

## Workers

| Worker | Port | Purpose |
|--------|------|---------|
| `auth-worker` | 8786 | Supabase storage, JWT verification, OAuth, extension pairing, rate limiting |
| `baseball-espn-mcp` | 8787 | Baseball MCP server with ESPN API tools |
| `football-espn-mcp` | 8788 | Football MCP server with ESPN API tools |

## Development

```bash
# Run all workers
npm run dev:workers

# Run individually
cd workers/auth-worker && npm run dev
cd workers/baseball-espn-mcp && npm run dev
cd workers/football-espn-mcp && npm run dev

# Or with wrangler directly
cd workers/auth-worker && wrangler dev --env dev --port 8786
```

## Testing

```bash
cd workers/<worker-name>
npm test           # Run Jest tests
npm run type-check # TypeScript check
```

Add focused tests for handler changes in `__tests__/` or `*.test.ts`.

## Environment Variables

### Auth Worker

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=sb_secret_...
ENVIRONMENT=prod|preview|dev
NODE_ENV=production|development
```

### MCP Workers (baseball/football)

```
AUTH_WORKER_URL=https://auth-worker.YOUR-ACCOUNT.workers.dev
ENVIRONMENT=prod|preview|dev
NODE_ENV=production|development
```

**Local dev**: Set via `wrangler dev` or `.dev.vars` file.

**Preview/Prod**: Cloudflare Dashboard → Worker → Settings → Variables & Secrets.

## Critical: Worker-to-Worker Calls

MCP workers call auth-worker to fetch credentials. **Always use `.workers.dev` URLs**, not the custom domain.

```
# Correct
AUTH_WORKER_URL=https://auth-worker.your-account.workers.dev

# Wrong - causes 522 timeouts
AUTH_WORKER_URL=https://api.flaim.app/auth
```

Why: Custom domain (`api.flaim.app`) causes HTTP 522 timeouts for intra-zone Cloudflare requests.

Ensure `wrangler.jsonc` has `"workers_dev": true` so the `.workers.dev` URL exists in prod.

## MCP Tools

Tools exposed by the MCP workers:

### Both Workers
- `get_user_session` — User's configured leagues, team IDs, season years, default league, current date/season

### Baseball (`baseball-espn-mcp`)
- `get_espn_baseball_league_info` — League settings and members
- `get_espn_baseball_team_roster` — Team roster with player stats
- `get_espn_baseball_matchups` — Current and upcoming matchups
- `get_espn_baseball_standings` — League standings

### Football (`football-espn-mcp`)
- `get_espn_football_league_info` — League settings and members
- `get_espn_football_team` — Team roster with player stats
- `get_espn_football_matchups` — Current and upcoming matchups
- `get_espn_football_standings` — League standings

## ESPN API Reference

Host: `https://lm-api-reads.fantasy.espn.com`

Required headers:
```
Cookie: SWID=...; espn_s2=...
Accept: application/json
X-Fantasy-Source: kona
X-Fantasy-Platform: kona-web-2.0.0
```

Note: The Chrome extension's league discovery uses ESPN's Fan API; MCP workers
still call `lm-api-reads.fantasy.espn.com` for league data.

Credentials are fetched from auth-worker per request; MCP workers don't store them locally.

## League Seasons

- Leagues are stored per season year in auth-worker; multiple seasons of the same league can coexist.
- MCP workers use the league's season year when calling ESPN and surface it in `get_user_session`.
- Season discovery is handled by worker endpoints (proxied by the web app) to auto-add historical seasons.

## Deployment

```bash
npm run deploy:workers:preview  # Deploy to preview env
npm run deploy:workers:prod     # Deploy to production
```

Workers use custom routes via `api.flaim.app`:
- `/auth/*` → auth-worker
- `/baseball/*` → baseball-espn-mcp
- `/football/*` → football-espn-mcp

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| 522 timeouts (worker-to-worker) | Using custom domain for internal calls | Use `.workers.dev` URL for `AUTH_WORKER_URL` |
| 500s in prod | Missing Cloudflare secrets | Add secrets in dashboard |
| 404s on custom routes | Worker expects stripped path | Cloudflare routes strip `/auth`, `/baseball`, `/football` prefixes |
| 424 from Responses API | Wrong MCP endpoint | Ensure `server_url` ends with `/mcp` |

## Architecture

```
Claude/ChatGPT
     ↓ (OAuth token)
MCP Worker (baseball/football)
     ↓ (internal fetch)
Auth Worker ← Supabase (credentials, leagues)
     ↓
ESPN API
```

See `docs/ARCHITECTURE.md` for full system design.
