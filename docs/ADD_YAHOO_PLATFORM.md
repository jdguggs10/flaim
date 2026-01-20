# Add Yahoo Fantasy Platform Support

This document describes the implementation plan for adding **Yahoo Fantasy Sports** support to Flaim using a **unified gateway architecture**.

**Goal:** Add **Yahoo Fantasy Sports** support (start with **Football + Baseball**, later **Basketball + Hockey**) with a **unified MCP gateway** that supports multiple platforms.

---

## Executive summary

Yahoo Fantasy Sports has an official, supported API (unlike ESPN's cookie-based approach) but **requires OAuth 2.0** and uses a **resource-key model** (game → league → team → roster → players).

Rather than creating separate Yahoo MCP workers per sport, we will implement a **unified gateway architecture**:

- **Single MCP endpoint** (`fantasy-mcp`) that users connect to once
- **Platform-agnostic tools** (e.g., `get_standings` instead of `get_espn_football_standings`)
- **Platform workers** (`espn-client`, `yahoo-client`) handle sport routing internally
- **Service bindings** for reliable worker-to-worker communication
- **Explicit parameters** (platform, sport, league_id, season_year) for clear routing

This approach scales well: adding a new platform = 1 new worker, not 4.

---

## Architecture overview

### Current state (ESPN only)

```
Claude/ChatGPT → baseball-espn-mcp → auth-worker → ESPN API
              → football-espn-mcp → auth-worker → ESPN API
```

Users connect 2 MCP servers (one per sport).

### Target state (unified gateway)

```
                              ┌─────────────────────────────────────────┐
                              │         fantasy-mcp (gateway)           │
                              │                                         │
                              │   UNIFIED TOOLS:                        │
                              │   • get_user_session                    │
                              │   • get_league_info                     │
Claude/ChatGPT ──────────────►│   • get_standings                       │
   (1 MCP connection)         │   • get_matchups                        │
                              │   • get_roster                          │
                              │   • get_free_agents                     │
                              └───────────────┬─────────────────────────┘
                                              │
                        ┌─────────────────────┼─────────────────────┐
                        │ service bindings    │                     │
                        ▼                     ▼                     ▼
               ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
               │   espn-client   │   │  yahoo-client   │   │   auth-worker   │
               │                 │   │                 │   │                 │
               │ • football/     │   │ • football/     │   │ • credentials   │
               │ • baseball/     │   │ • baseball/     │   │ • leagues       │
               │ • basketball/   │   │ • basketball/   │   │ • oauth tokens  │
               │ • hockey/       │   │ • hockey/       │   │                 │
               └────────┬────────┘   └────────┬────────┘   └─────────────────┘
                        │                     │
                        ▼                     ▼
               ┌─────────────────┐   ┌─────────────────┐
               │    ESPN APIs    │   │   Yahoo APIs    │
               └─────────────────┘   └─────────────────┘
```

Users connect **1 MCP server** and get access to all platforms and sports.

### Worker inventory

| Worker | Purpose | Service bindings |
|--------|---------|------------------|
| `fantasy-mcp` | Gateway. Exposes unified MCP tools. Routes by platform. | ESPN, YAHOO, AUTH |
| `espn-client` | Internal. ESPN API calls for all sports. | AUTH |
| `yahoo-client` | Internal. Yahoo API calls for all sports. | AUTH |
| `auth-worker` | Credentials, leagues, OAuth tokens. | None |

**Total: 4 workers** (scales to 5, 6, etc. as platforms are added)

---

## Unified tool signatures

All tools take explicit parameters for clear routing. The AI gets these values from `get_user_session`.

### get_user_session

Returns all leagues across all platforms:

```typescript
get_user_session()
→ {
    leagues: [
      {
        platform: "espn",
        sport: "football",
        league_id: "12345",
        team_id: "3",
        season_year: 2024,
        league_name: "My League",
        is_default: true
      },
      {
        platform: "yahoo",
        sport: "baseball",
        league_key: "mlb.l.54321",
        team_id: "7",
        season_year: 2024,
        league_name: "Work League",
        is_default: false
      }
    ],
    current_date: "2025-01-19"
  }
```

### Data tools

Every tool takes the same core 4 params: `platform, sport, league_id, season_year`

```typescript
get_league_info(platform, sport, league_id, season_year)
→ League settings, members, scoring type

get_standings(platform, sport, league_id, season_year)
→ Ranked teams with records

get_matchups(platform, sport, league_id, season_year, week?)
→ Current/specified week matchups

get_roster(platform, sport, league_id, season_year, team_id)
→ Team roster with players

get_free_agents(platform, sport, league_id, season_year, position?, count?)
→ Available players
```

### Why explicit parameters?

| Implicit `get_standings(league_id)` | Explicit `get_standings(platform, sport, league_id, season_year)` |
|-------------------------------------|-------------------------------------------------------------------|
| Requires DB lookup first | Routes directly |
| League ID collision risk (ESPN 12345 vs Yahoo 12345) | No ambiguity |
| "Magic" that can fail | Predictable |
| AI has to remember context | AI passes what it got from `get_user_session` |

---

## Gateway routing

### Service binding configuration

```jsonc
// fantasy-mcp/wrangler.jsonc
{
  "services": [
    { "binding": "ESPN",  "service": "espn-client"  },
    { "binding": "YAHOO", "service": "yahoo-client" },
    { "binding": "AUTH",  "service": "auth-worker"  }
  ]
}
```

### Routing logic

```typescript
// fantasy-mcp/src/router.ts

type Platform = "espn" | "yahoo"

interface ToolParams {
  platform: Platform
  sport: string
  league_id: string
  season_year: number
  team_id?: string
}

export async function routeToClient(
  env: Env,
  tool: string,
  params: ToolParams
): Promise<Response> {

  // Pick the right service binding based on platform
  const client = params.platform === "espn" ? env.ESPN : env.YAHOO

  // Forward the request (service bindings use fetch internally)
  return client.fetch(
    new Request("https://internal/execute", {
      method: "POST",
      body: JSON.stringify({ tool, params })
    })
  )
}
```

---

## Platform worker structure

Each platform worker handles all sports internally via a sport router.

### File structure

```
workers/espn-client/
├── src/
│   ├── index.ts              # Entry, receives service binding calls
│   ├── router.ts             # Sport switch
│   │
│   ├── sports/
│   │   ├── football/
│   │   │   ├── handlers.ts   # getStandings, getRoster, etc.
│   │   │   └── mappings.ts   # POSITION_MAP, LINEUP_SLOT_MAP
│   │   ├── baseball/
│   │   │   ├── handlers.ts
│   │   │   └── mappings.ts
│   │   ├── basketball/       # Added later
│   │   └── hockey/           # Added later
│   │
│   └── shared/
│       ├── espn-api.ts       # Fetch with ESPN headers
│       ├── auth.ts           # Get creds from auth-worker
│       └── types.ts          # Normalized DTOs
│
└── wrangler.jsonc
```

### Sport routing inside platform worker

```typescript
// espn-client/src/index.ts

app.post("/execute", async (c) => {
  const { tool, params } = await c.req.json()
  const { sport, league_id, season_year, team_id } = params

  switch (sport) {
    case "football":
      return footballHandlers[tool](league_id, season_year, team_id)
    case "baseball":
      return baseballHandlers[tool](league_id, season_year, team_id)
    case "basketball":
      return basketballHandlers[tool](league_id, season_year, team_id)
    case "hockey":
      return hockeyHandlers[tool](league_id, season_year, team_id)
    default:
      return c.json({ error: `Unknown sport: ${sport}` }, 400)
  }
})
```

---

## Yahoo Fantasy Sports API reference

### Base URL

`https://fantasysports.yahooapis.com/fantasy/v2/`

### Core concepts: keys and resources

Yahoo uses a hierarchical resource model with identifiers called **keys**:

- **Game key**: identifies a sport + season (e.g., NFL 2024)
- **League key**: `{game_key}.l.{league_id}`
- **Team key**: `{league_key}.t.{team_id}`
- **Player key**: `{game_key}.p.{player_id}`

### Response format

- Add `?format=json` to return JSON
- Yahoo's JSON is a direct XML-to-JSON transformation with numeric object keys (`"0"`, `"1"`, ...)
- Build normalizers to convert to standard DTOs

### Key endpoints

**League discovery:**
- `GET /users;use_login=1/games/leagues?format=json`

**League data:**
- `GET /league/{league_key}?format=json`
- `GET /league/{league_key}/standings?format=json`
- `GET /league/{league_key}/scoreboard;week={WEEK}?format=json`

**Team data:**
- `GET /team/{team_key}?format=json`
- `GET /team/{team_key}/roster?format=json`
- `GET /team/{team_key}/roster;week={WEEK}?format=json`

**Players:**
- `GET /league/{league_key}/players;status=FA?format=json`
- `GET /league/{league_key}/players;search={QUERY}?format=json`

---

## Authentication: Yahoo OAuth 2.0

### Setup requirements

1. Create a Yahoo Developer application
2. Request Fantasy Sports scope: `fspt-r` (read-only) or `fspt-w` (read/write)
3. Configure redirect URL: `https://flaim.app/api/oauth/yahoo/callback`

### Flow

1. User clicks **Connect Yahoo** in Flaim
2. Redirect to Yahoo auth endpoint
3. Yahoo redirects back with `code`
4. auth-worker exchanges code for tokens
5. Store `access_token`, `refresh_token`, `expires_at` in Supabase
6. Platform workers request tokens via service binding to auth-worker

### Token refresh

Centralized in auth-worker:

```typescript
// auth-worker: GET /credentials/yahoo?raw=true
// - Check expiry
// - Refresh if necessary
// - Return valid access_token
```

---

## Supabase data model

### yahoo_credentials

| Column | Type | Notes |
|--------|------|-------|
| clerk_user_id | text | PK |
| access_token | text | Encrypted at rest |
| refresh_token | text | Encrypted at rest |
| expires_at | timestamp | |
| yahoo_guid | text | Optional, stable Yahoo user ID |
| created_at | timestamp | |
| updated_at | timestamp | |

### yahoo_leagues

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| clerk_user_id | text | Indexed |
| sport | text | football/baseball/basketball/hockey |
| season_year | int | |
| league_key | text | Full Yahoo key (e.g., `nfl.l.12345`) |
| league_name | text | |
| team_id | text | User's team in this league |
| team_key | text | Full Yahoo key |
| is_default | boolean | |
| created_at | timestamp | |
| updated_at | timestamp | |

---

## auth-worker changes

### New Yahoo endpoints

**Credentials:**
- `POST /oauth/yahoo/exchange` — Exchange code for tokens
- `GET /credentials/yahoo` — Status check
- `GET /credentials/yahoo?raw=true` — Internal use by platform workers
- `DELETE /credentials/yahoo` — Disconnect

**Leagues:**
- `POST /leagues/yahoo/discover` — Fetch and upsert user leagues
- `GET /leagues/yahoo` — List leagues
- `PATCH /leagues/yahoo/{league_key}/default` — Set default
- `DELETE /leagues/yahoo/{league_key}` — Remove

### Updated get_user_session

Returns leagues from both `espn_leagues` and `yahoo_leagues` with `platform` field.

---

## UX and frontend changes

### Connect Yahoo flow

1. Add **Connect Yahoo** button on landing page / settings
2. Implement callback route: `GET /api/oauth/yahoo/callback`
3. After exchange: trigger league discovery, route to leagues page

### Leagues page updates

- Show ESPN and Yahoo leagues together (grouped by platform or sport)
- Platform badge on each league
- Default selection works across platforms

### Disconnect

- Add **Disconnect Yahoo** button
- Calls `DELETE /credentials/yahoo`
- Optionally removes Yahoo leagues

---

## Phased implementation plan

### Phase 0: Gateway scaffolding

**Create the unified gateway architecture (no Yahoo yet):**

1. Create `fantasy-mcp` gateway worker with unified tool schemas
2. Create `espn-client` worker (migrate existing ESPN code)
3. Set up service bindings between gateway and espn-client
4. Update `get_user_session` to include `platform: "espn"` field
5. Test that existing ESPN functionality works through new gateway
6. Deprecate old `baseball-espn-mcp` and `football-espn-mcp` workers

### Phase 1: Yahoo OAuth + league discovery

1. Add Yahoo Developer app credentials
2. Add Supabase migration: `yahoo_credentials`, `yahoo_leagues`
3. Implement Yahoo OAuth flow in auth-worker
4. Implement `POST /leagues/yahoo/discover`
5. Update `get_user_session` to return Yahoo leagues
6. Add Connect Yahoo UI

### Phase 2: yahoo-client worker (Football)

1. Create `yahoo-client` worker with service binding
2. Add football handlers with Yahoo API calls
3. Build Yahoo JSON normalizers
4. Test football tools end-to-end

### Phase 3: yahoo-client worker (Baseball)

1. Add baseball handlers to yahoo-client
2. Add free agent / player search if needed

### Phase 4: Additional sports

1. Add basketball handlers to both platform workers
2. Add hockey handlers to both platform workers

### Phase 5: Additional platforms (future)

1. CBS Sports → create `cbs-client` worker
2. Sleeper → create `sleeper-client` worker
3. Each new platform = 1 new worker + service binding

---

## Yahoo JSON parsing notes

Yahoo JSON is structurally awkward. Build robust helpers:

```typescript
// Convert Yahoo numeric-keyed objects to arrays
function asArray<T>(value: Record<string, T> | T[]): T[]

// Safe deep path traversal
function getPath(obj: unknown, path: string[]): unknown

// Unwrap Yahoo resource envelope
function unwrapYahooResource(res: unknown, type: 'league' | 'team' | ...): unknown
```

Normalize outputs to match DTOs:

- League info: `name`, `season`, `numTeams`, `scoringSummary`
- Team roster: `teamName`, `week`, `players[]`
- Scoreboard: `week`, `matchups[]` (home/away, scores)
- Standings: ordered `teams[]` with rank + record

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| OAuth token expiry | Centralize refresh in auth-worker |
| Yahoo JSON parsing complexity | Build normalizers early, test thoroughly |
| Week/period semantics differ by sport | Default to "current scoring period" |
| League discovery edge cases | Validate with multiple real leagues |
| Service binding configuration errors | Test bindings in preview env first |

---

## Testing checklist

### Gateway routing
- [ ] Tool calls route to correct platform worker
- [ ] Unknown platform returns error
- [ ] Service bindings work in dev/preview/prod

### Yahoo OAuth
- [ ] Connect flow end-to-end
- [ ] Token refresh works (simulate expiry)
- [ ] Disconnect clears credentials

### Yahoo league discovery
- [ ] Discovers football + baseball leagues
- [ ] Stores correct: league_key, league_name, sport, season, team_id
- [ ] Handles users with no Yahoo leagues

### Yahoo tools (per sport)
- [ ] get_league_info returns correct data
- [ ] get_standings matches Yahoo web UI
- [ ] get_matchups returns correct week
- [ ] get_roster returns players

---

## Reference links

- Yahoo Fantasy Sports API: https://developer.yahoo.com/fantasysports/
- Yahoo OAuth 2.0: https://developer.yahoo.com/oauth2/
- Cloudflare Service Bindings: https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/

---

## Appendix: Naming conventions

| Term | Values | Notes |
|------|--------|-------|
| `platform` | `espn`, `yahoo`, `cbs`, `sleeper` | Lowercase |
| `sport` | `football`, `baseball`, `basketball`, `hockey` | Lowercase |
| `league_id` | ESPN: numeric string, Yahoo: full league_key | Platform-specific format |
| `team_id` | ESPN: numeric string, Yahoo: numeric or key | Platform-specific format |
