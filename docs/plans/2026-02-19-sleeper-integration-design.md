# Sleeper Platform Integration — Design

**Date:** 2026-02-19
**Status:** Approved
**Scope:** Add Sleeper as a third fantasy platform alongside ESPN and Yahoo

## Context

Sleeper is a popular fantasy sports platform with a public, read-only API requiring no authentication. It supports NFL (primary) and NBA. Adding Sleeper follows the existing multi-platform architecture: a dedicated Cloudflare Worker behind the unified MCP gateway.

## Key API Characteristics

- **Base URL:** `https://api.sleeper.app/v1/`
- **Auth:** None (public read-only)
- **Rate limit:** ~1,000 calls/minute (soft, IP-blocked if exceeded)
- **Sports:** NFL (`nfl`), NBA (`nba`)
- **No standings endpoint** — compute from roster `settings.wins/losses/fpts`
- **No free agent endpoint** — requires diffing all players (~5MB blob) against rostered players
- **No official stats endpoint** — deprecated; undocumented endpoints exist but are unstable
- **Matchups pair by `matchup_id`** — two roster entries with the same ID are opponents
- **Player IDs are strings** — team defenses use NFL abbreviations (`"DET"`, `"PHI"`)
- **`previous_league_id`** chain links seasons together for historical discovery

## Approach

Full standalone worker (`workers/sleeper-client/`), same architecture as ESPN and Yahoo clients. Service binding to the fantasy-mcp gateway.

## Phase 1 — Core Integration

### Sleeper Client Worker

```
workers/sleeper-client/
├── src/
│   ├── index.ts              # Hono app: /health, /execute, /onboarding/discover
│   ├── types.ts              # Sleeper API response types + Env
│   ├── logging.ts            # Eval event logging
│   ├── shared/
│   │   └── sleeper-api.ts    # Thin fetch wrapper (no auth)
│   └── sports/
│       ├── football/
│       │   ├── handlers.ts   # 4 tool handlers
│       │   └── mappings.ts   # NFL position mappings
│       └── basketball/
│           ├── handlers.ts   # 4 tool handlers
│           └── mappings.ts   # NBA position mappings
├── wrangler.jsonc
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

No `shared/auth.ts` (no credentials), no normalizers (clean JSON), no season year translation.

### Tools (Phase 1)

| Tool | Sleeper API Calls | Notes |
|------|-------------------|-------|
| `get_league_info` | `GET /league/{id}` | Direct mapping |
| `get_standings` | `GET /league/{id}/rosters` + `/users` | Compute W/L/T/PF/PA, sort by wins then points |
| `get_roster` | `GET /league/{id}/rosters` + `/users` | Find by roster_id or owner_id, return starters/bench/reserve |
| `get_matchups` | `GET /league/{id}/matchups/{week}` + `/users` + `/rosters` | Pair by matchup_id, include points |

Error codes: `SLEEPER_NOT_FOUND`, `SLEEPER_RATE_LIMIT`, `SLEEPER_API_ERROR`, `SLEEPER_TIMEOUT`.

### Database

**`sleeper_connections`** — user's Sleeper identity (no credentials)

```sql
CREATE TABLE sleeper_connections (
  clerk_user_id TEXT PRIMARY KEY,
  sleeper_user_id TEXT NOT NULL,
  sleeper_username TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

**`sleeper_leagues`** — same pattern as `espn_leagues` / `yahoo_leagues`

```sql
CREATE TABLE sleeper_leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  league_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  season_year INTEGER NOT NULL,
  league_name TEXT NOT NULL,
  roster_id INTEGER,
  sleeper_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT sleeper_leagues_unique
    UNIQUE (clerk_user_id, league_id, season_year)
);
```

Both tables get RLS enabled.

### Auth-Worker Endpoints

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /connect/sleeper/discover` | Clerk JWT | Resolve username → user_id, discover leagues + traverse `previous_league_id` chain, save |
| `GET /connect/sleeper/status` | Clerk JWT | Return connected username/user_id or null |
| `DELETE /connect/sleeper/disconnect` | Clerk JWT | Remove connections + leagues |
| `GET /leagues/sleeper` | Clerk JWT | Return user's Sleeper leagues |
| `DELETE /leagues/sleeper/:id` | Clerk JWT | Delete a specific league |

### Discovery Flow

```
POST /connect/sleeper/discover { username: "jdoe" }
  → GET https://api.sleeper.app/v1/user/jdoe
  → Store sleeper_user_id in sleeper_connections
  → GET /v1/user/{user_id}/leagues/nfl/2025
  → GET /v1/user/{user_id}/leagues/nba/2025
  → For each league: save to sleeper_leagues
  → For each league with previous_league_id:
      → GET /v1/league/{previous_league_id}
      → Save with that season's year
      → Repeat until chain ends or 5-year cap
  → Return { leagues_found, seasons_discovered }
```

### Gateway Changes (fantasy-mcp)

- Add `'sleeper'` to `Platform` type and `SLEEPER: Fetcher` to `Env`
- Add `case 'sleeper': return env.SLEEPER` in `selectClient()`
- Update Zod platform enum to `z.enum(['espn', 'yahoo', 'sleeper'])` on routed tools
- Add `SLEEPER` service binding in `wrangler.jsonc` (all 3 envs)
- Add Sleeper to health check binding status
- Update `get_user_session` to fetch and merge Sleeper leagues

### Frontend

- Add "Connect Sleeper" section (username input) matching ESPN/Yahoo pattern and style guide
- Sleeper leagues appear in `/leagues` with platform badge
- Default league selection works cross-platform via `user_preferences`
- No Chrome extension changes

### CI/CD

- Add `sleeper-client` to `deploy-workers.yml` (test + deploy matrix)

## Phase 2 — Free Agents (KV Cache)

- Add KV namespace binding to `sleeper-client`
- Implement `get_free_agents` tool
- Fetch `GET /v1/players/{sport}` (~5MB) once daily, store in KV with 24h TTL
- Diff all players minus rostered players per request
- Position filtering support

## Phase 3 — Stats Enrichment

- Experiment with undocumented `GET /stats/{sport}/{year}/{week}` endpoints
- Per-week player scoring breakdowns
- Flag as experimental — these endpoints are not officially supported and could break
