# Flaim Workers

Cloudflare Workers handling authentication and MCP data fetching.

## Workers

| Worker | Port | Purpose |
|--------|------|---------|
| `auth-worker` | 8786 | Supabase storage, JWT verification, OAuth, extension APIs, rate limiting |
| `fantasy-mcp` | 8790 | **Unified MCP gateway** - routes to platform workers via service bindings |
| `espn-client` | 8789 | **ESPN API client** - handles all ESPN sports (called by fantasy-mcp) |
| `yahoo-client` | 8791 | **Yahoo API client** - handles all Yahoo sports (called by fantasy-mcp) |
| `sleeper-client` | 8792 | **Sleeper API client** - handles Sleeper NFL/NBA (called by fantasy-mcp) |

### New Architecture (Unified Gateway)

```
Claude/ChatGPT → fantasy-mcp → espn-client  → ESPN API
                            → yahoo-client → Yahoo API
                            → sleeper-client → Sleeper API
                            → auth-worker  → Supabase
```

The unified gateway (`fantasy-mcp`) uses explicit tool parameters (`platform`, `sport`, `league_id`, `season_year`) and routes to platform-specific workers (`espn-client`, `yahoo-client`, `sleeper-client`) via Cloudflare service bindings.

## Development

```bash
# Run all workers (auth + unified gateway + platform clients)
npm run dev:workers

# Run unified gateway workers
npm run dev:fantasy-mcp    # Port 8790
npm run dev:espn-client    # Port 8789
npm run dev:yahoo-client   # Port 8791
npm run dev --workspace workers/sleeper-client  # Port 8792

**Local service bindings note:** `fantasy-mcp` relies on Wrangler's local registry to resolve
`ESPN`, `YAHOO`, and `SLEEPER` service bindings. Use `WRANGLER_LOG_PATH` + `WRANGLER_REGISTRY_PATH`
(already wired into `npm run dev:workers`) to avoid binding resolution issues.

# Run individually
cd workers/auth-worker && npm run dev
cd workers/fantasy-mcp && npm run dev
cd workers/espn-client && npm run dev
cd workers/yahoo-client && npm run dev
cd workers/sleeper-client && npm run dev

# Or with wrangler directly
cd workers/auth-worker && wrangler dev --env dev --port 8786
```

## Testing

```bash
cd workers/<worker-name>
npm test           # Run Vitest tests (auth-worker, espn-client, yahoo-client, sleeper-client, fantasy-mcp)
npm run type-check # TypeScript check (auth-worker, espn-client, yahoo-client, sleeper-client, fantasy-mcp)
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

### MCP + Platform Workers (`fantasy-mcp`, `espn-client`, `yahoo-client`, `sleeper-client`)

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

### Unified Gateway (`fantasy-mcp`)

All tools take explicit parameters: `platform`, `sport`, `league_id`, `season_year`

- `get_user_session` — All leagues across platforms with IDs (call first to get params)
- `get_ancient_history` — Historical leagues and seasons (2+ years old)
- `get_league_info` — League settings and members
- `get_standings` — League standings
- `get_matchups` — Current/specified week matchups
- `get_roster` — Team roster with player details
- `get_free_agents` — Available free agents
- `get_transactions` — Recent transactions (adds, drops, waivers, trades)

`get_transactions` v1 semantics are platform-specific:
- ESPN/Sleeper: explicit `week` supported; default window is current+previous week.
- Yahoo: explicit `week` ignored; uses a recent 14-day timestamp window.
- Yahoo: `type=waiver` filter is intentionally unsupported in v1.

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
# Usually handled by GitHub Actions (.github/workflows/deploy-workers.yml)
# Manual fallback (deploy each worker explicitly):
cd workers/auth-worker && wrangler deploy --env preview   # or --env prod
cd workers/fantasy-mcp && npm run deploy:preview          # or npm run deploy:prod
cd workers/espn-client && npm run deploy:preview          # or npm run deploy:prod
cd workers/yahoo-client && npm run deploy:preview         # or npm run deploy:prod
```

Workers use custom routes via `api.flaim.app`:
- `/auth/*` → auth-worker
- `/fantasy/*` → fantasy-mcp (unified gateway)
- `/mcp*` → fantasy-mcp (primary MCP endpoint, POST required; non-POST returns `405`)

Note: `espn-client` is called internally via service binding for MCP traffic, but the web app uses its `/onboarding/*` endpoints via the public workers.dev URL.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| 522 timeouts (worker-to-worker) | Using custom domain for internal calls | Use `.workers.dev` URL for `AUTH_WORKER_URL` |
| 500s in prod | Missing Cloudflare secrets | Add secrets in dashboard |
| 404s on custom routes | Worker expects stripped path | Cloudflare routes strip `/auth` and `/fantasy` prefixes |
| 424 from Responses API | MCP transport/protocol mismatch | Ensure `server_url` is `https://api.flaim.app/mcp`, calls are POST-based, and deployed `fantasy-mcp` includes stream-mode MCP responses plus non-POST `405` handling |
| `EMFILE: too many open files, watch` | File descriptor limit too low for dev watchers | Run `ulimit -n 8192` (or higher) and restart `wrangler dev` |
| `EPERM` writing Wrangler logs/registry | Global Wrangler directory not writable | Use `WRANGLER_LOG_PATH` + `WRANGLER_REGISTRY_PATH` env vars |

## Architecture

### Unified Gateway (New)
```
Claude/ChatGPT
     ↓ (OAuth token)
fantasy-mcp (gateway)
     ↓ (service binding)
espn-client → ESPN API
     ↓
auth-worker ← Supabase
```

See `docs/ARCHITECTURE.md` for full system design.
