# Flaim Workers

Cloudflare Workers handling authentication and MCP data fetching.

## Workers

| Worker | Port | Purpose |
|--------|------|---------|
| `auth-worker` | 8786 | Supabase storage, JWT verification, OAuth, extension APIs, rate limiting |
| `fantasy-mcp` | 8790 | **Unified MCP gateway** - routes to platform workers via service bindings |
| `espn-client` | 8789 | **ESPN API client** - handles all ESPN sports (called by fantasy-mcp) |
| `baseball-espn-mcp` | 8787 | Legacy: Direct baseball MCP server |
| `football-espn-mcp` | 8788 | Legacy: Direct football MCP server |

### New Architecture (Unified Gateway)

```
Claude/ChatGPT → fantasy-mcp → espn-client → ESPN API
                            → auth-worker → Supabase
```

The unified gateway (`fantasy-mcp`) uses explicit tool parameters (`platform`, `sport`, `league_id`, `season_year`) and routes to platform-specific workers (`espn-client`) via Cloudflare service bindings.

## Development

```bash
# Run legacy workers (auth + baseball + football)
npm run dev:workers

# Run unified gateway workers
npm run dev:fantasy-mcp    # Port 8790
npm run dev:espn-client    # Port 8789

# Run individually
cd workers/auth-worker && npm run dev
cd workers/fantasy-mcp && npm run dev
cd workers/espn-client && npm run dev
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

### Unified Gateway (`fantasy-mcp`)

All tools take explicit parameters: `platform`, `sport`, `league_id`, `season_year`

- `get_user_session` — All leagues across platforms with IDs (call first to get params)
- `get_league_info` — League settings and members
- `get_standings` — League standings
- `get_matchups` — Current/specified week matchups
- `get_roster` — Team roster with player details
- `get_free_agents` — Available free agents (baseball only)

### Legacy Workers

#### Both Workers
- `get_user_session` — User's configured leagues, team IDs, season years, default league, current date/season

#### Baseball (`baseball-espn-mcp`)
- `get_espn_baseball_league_info` — League settings and members
- `get_espn_baseball_team_roster` — Team roster with player stats
- `get_espn_baseball_matchups` — Current and upcoming matchups
- `get_espn_baseball_standings` — League standings
- `get_espn_baseball_free_agents` — Available free agents
- `get_espn_baseball_box_scores` — Box scores for games
- `get_espn_baseball_recent_activity` — Recent league activity (trades, adds, drops)

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
- `/fantasy/*` → fantasy-mcp (unified gateway)
- `/baseball/*` → baseball-espn-mcp (legacy)
- `/football/*` → football-espn-mcp (legacy)

Note: `espn-client` has no custom route; it's called internally via service binding.

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| 522 timeouts (worker-to-worker) | Using custom domain for internal calls | Use `.workers.dev` URL for `AUTH_WORKER_URL` |
| 500s in prod | Missing Cloudflare secrets | Add secrets in dashboard |
| 404s on custom routes | Worker expects stripped path | Cloudflare routes strip `/auth`, `/baseball`, `/football` prefixes |
| 424 from Responses API | Wrong MCP endpoint | Ensure `server_url` ends with `/mcp` |

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

### Legacy Workers
```
Claude/ChatGPT
     ↓ (OAuth token)
MCP Worker (baseball/football)
     ↓ (internal fetch)
auth-worker ← Supabase
     ↓
ESPN API
```

See `docs/ARCHITECTURE.md` for full system design.
