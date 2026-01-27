# Add Yahoo Fantasy Platform Support

This document describes the implementation plan for adding **Yahoo Fantasy Sports** support to Flaim using a **unified gateway architecture**.

**Goal:** Add **Yahoo Fantasy Sports** support (start with **Football + Baseball**, later **Basketball + Hockey**) with a **unified MCP gateway** that supports multiple platforms.

**Last updated:** 2026-01-27

---

## Important: Two Different OAuth Flows

Flaim uses OAuth in **two distinct ways**. Understanding this distinction is critical:

| Aspect | MCP OAuth | Platform OAuth |
|--------|-----------|----------------|
| **Flaim's role** | PROVIDER | CLIENT |
| **Who authenticates** | Claude/ChatGPT → Flaim | Flaim → Yahoo/Sleeper |
| **Purpose** | AI clients access Flaim MCP tools | Flaim accesses fantasy platform APIs |
| **Route prefix** | `/oauth/*` | `/connect/*` |
| **Existing code** | `oauth-handlers.ts` | NEW for Yahoo |
| **Token storage** | `oauth_tokens` table | `yahoo_credentials` table |

**Never mix these up.** The `/oauth/*` routes are for AI clients connecting to Flaim. The `/connect/*` routes are for Flaim connecting to external platforms.

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
| `fantasy-mcp` | Gateway. Exposes unified MCP tools. Routes by platform. | ESPN, YAHOO, AUTH_WORKER |
| `espn-client` | Internal. ESPN API calls for all sports. | AUTH_WORKER |
| `yahoo-client` | Internal. Yahoo API calls for all sports. | AUTH_WORKER |
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
    current_date: "2026-01-24"
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
    { "binding": "AUTH_WORKER",  "service": "auth-worker"  }
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

> **Important distinction:** This is **Platform OAuth** (Flaim as CLIENT requesting access to Yahoo).
> This is separate from **MCP OAuth** (Flaim as PROVIDER for Claude/ChatGPT).
> See [auth-worker organization](#auth-worker-route-organization) for how these are separated.

### Setup requirements

1. Create a Yahoo Developer application at https://developer.yahoo.com/apps/
2. Request Fantasy Sports scope: `fspt-r` (read-only)
3. Configure redirect URL: `https://api.flaim.app/auth/connect/yahoo/callback`

### OAuth flow diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           YAHOO OAUTH FLOW                                   │
│                     (Flaim as CLIENT → Yahoo as PROVIDER)                    │
└─────────────────────────────────────────────────────────────────────────────┘

1. AUTHORIZE
   User clicks "Connect Yahoo"
   └─→ Frontend redirects to:
       https://api.login.yahoo.com/oauth2/request_auth
         ?client_id={YAHOO_CLIENT_ID}
         &redirect_uri=https://api.flaim.app/auth/connect/yahoo/callback
         &response_type=code
         &scope=fspt-r
         &state={clerk_user_id}:{nonce}

2. CALLBACK
   Yahoo redirects to auth-worker:
   └─→ GET /connect/yahoo/callback?code={code}&state={state}
       │
       ├─→ Verify state (extract clerk_user_id, validate nonce)
       ├─→ Exchange code for tokens (POST to Yahoo token endpoint)
       ├─→ Store in Supabase: yahoo_credentials
       └─→ Redirect to: https://flaim.app/leagues?yahoo=connected

3. LEAGUE DISCOVERY (triggered after redirect)
   Frontend calls:
   └─→ POST /api/connect/yahoo/discover
       │
       └─→ auth-worker:
           ├─→ Fetch access_token (refresh if needed)
           ├─→ Call Yahoo: GET /users;use_login=1/games/leagues
           ├─→ Normalize response → standard league DTOs
           ├─→ Upsert to Supabase: yahoo_leagues
           └─→ Return discovered leagues

4. MCP TOOL USAGE (later)
   Claude/ChatGPT calls get_roster:
   └─→ fantasy-mcp → yahoo-client → auth-worker (get token) → Yahoo API
```

### State parameter structure

The `state` parameter prevents CSRF and carries the user identity:

```
{clerk_user_id}:{nonce}

Example: user_2abc123def:a1b2c3d4e5f6
```

- `clerk_user_id`: Identifies which user initiated the flow
- `nonce`: Random string stored in short-lived cache, validated on callback

### Token refresh (on-demand)

Yahoo access tokens expire after ~1 hour. We use **on-demand refresh**:

```typescript
// auth-worker: GET /connect/yahoo/credentials
async function getYahooCredentials(clerkUserId: string): Promise<YahooCredentials> {
  const creds = await supabase.from('yahoo_credentials').select('*').eq('clerk_user_id', clerkUserId).single();

  if (!creds) throw new Error('Yahoo not connected');

  // Check if token expires within 5 minutes
  const expiresAt = new Date(creds.expires_at);
  const now = new Date();
  const bufferMs = 5 * 60 * 1000; // 5 minute buffer

  if (expiresAt.getTime() - now.getTime() < bufferMs) {
    // Refresh the token
    const newTokens = await refreshYahooToken(creds.refresh_token);
    await supabase.from('yahoo_credentials').update({
      access_token: newTokens.access_token,
      refresh_token: newTokens.refresh_token, // Yahoo may rotate
      expires_at: new Date(Date.now() + newTokens.expires_in * 1000),
      updated_at: new Date()
    }).eq('clerk_user_id', clerkUserId);

    return { access_token: newTokens.access_token };
  }

  return { access_token: creds.access_token };
}
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

### auth-worker route organization

The auth-worker handles **two distinct OAuth flows** plus credential/league management. Clear route prefixes prevent confusion:

```
auth-worker routes:

/oauth/*          → MCP OAuth (Flaim as PROVIDER for Claude/ChatGPT)
                    - /oauth/authorize
                    - /oauth/token
                    - /oauth/revoke
                    - /oauth/userinfo

/connect/*        → Platform OAuth (Flaim as CLIENT to Yahoo/Sleeper/etc)
                    - /connect/yahoo/authorize    (redirect to Yahoo)
                    - /connect/yahoo/callback     (receive code, exchange tokens)
                    - /connect/yahoo/credentials  (get token, refresh if needed)
                    - /connect/yahoo/disconnect   (revoke and delete)
                    - /connect/yahoo/discover     (fetch leagues after connect)
                    - (future: /connect/sleeper/*, /connect/cbs/*)

/credentials/*    → Non-OAuth credentials (ESPN cookies via extension)
                    - /credentials/espn
                    - /credentials/espn/status

/leagues/*        → League management (all platforms)
                    - /leagues                    (list all)
                    - /leagues/espn/*
                    - /leagues/yahoo/*

/extension/*      → Chrome extension sync (v1.4.0: sync → discover → complete)
                    - /extension/sync
                    - /extension/discover
                    - /extension/status
```

### New Yahoo endpoints

**Platform Connect (OAuth as client):**
- `GET /connect/yahoo/authorize` — Redirect to Yahoo OAuth
- `GET /connect/yahoo/callback` — Handle Yahoo redirect, exchange code for tokens
- `GET /connect/yahoo/credentials` — Get access token (refresh if needed) - internal use
- `DELETE /connect/yahoo/disconnect` — Revoke tokens, delete credentials
- `POST /connect/yahoo/discover` — Fetch and upsert user leagues

**League Management:**
- `GET /leagues/yahoo` — List user's Yahoo leagues
- `PATCH /leagues/yahoo/{league_key}/default` — Set default
- `DELETE /leagues/yahoo/{league_key}` — Remove league

### Updated get_user_session

Returns leagues from both `espn_leagues` and `yahoo_leagues` with `platform` field:

```typescript
{
  leagues: [
    { platform: "espn", sport: "football", league_id: "12345", ... },
    { platform: "yahoo", sport: "baseball", league_key: "mlb.l.54321", ... }
  ],
  current_date: "2026-01-24"
}
```

---

## UX and frontend changes

### Connect Yahoo button placement

Add **Connect Yahoo** button alongside ESPN in Homepage Box 2:

```
┌─────────────────────────────────────────┐
│  Box 2: Connect Your Leagues            │
│                                         │
│  [ESPN logo] Connect ESPN               │
│              (Install Extension)        │
│                                         │
│  [Yahoo logo] Connect Yahoo             │
│               (Sign in with Yahoo)      │
└─────────────────────────────────────────┘
```

### Connect Yahoo flow

1. User clicks **Connect Yahoo** button
2. Frontend redirects to: `https://api.flaim.app/auth/connect/yahoo/authorize`
3. auth-worker builds Yahoo OAuth URL and redirects user
4. User authorizes on Yahoo
5. Yahoo redirects to: `https://api.flaim.app/auth/connect/yahoo/callback`
6. auth-worker exchanges code, stores tokens, redirects to: `https://flaim.app/leagues?yahoo=connected`
7. Leagues page detects `?yahoo=connected`, triggers league discovery
8. POST `/api/connect/yahoo/discover` → fetches and displays leagues

### Leagues page updates

- Show ESPN and Yahoo leagues together (grouped by platform or sport)
- Platform badge on each league (ESPN blue, Yahoo purple)
- Default selection works across platforms
- Refresh button to re-run discovery

### Disconnect

- Add **Disconnect Yahoo** in settings or leagues page
- Calls `DELETE /connect/yahoo/disconnect`
- Removes `yahoo_credentials` row
- Optionally removes `yahoo_leagues` rows (or keeps for history)

---

## Phased implementation plan

### Phase 0: Gateway scaffolding ✅ COMPLETE

**Create the unified gateway architecture (no Yahoo yet):**

1. ✅ Create `fantasy-mcp` gateway worker with unified tool schemas
2. ✅ Create `espn-client` worker (migrate existing ESPN code)
3. ✅ Set up service bindings between gateway and espn-client
4. ✅ Update `get_user_session` to include `platform: "espn"` field
5. ✅ Test that existing ESPN functionality works through new gateway
6. ✅ Full feature parity: both football and baseball have all tools (get_league_info, get_standings, get_matchups, get_roster, get_free_agents)
7. Legacy workers (`baseball-espn-mcp`, `football-espn-mcp`) still available as fallback

### Phase 1: Yahoo OAuth + league discovery ✅ COMPLETE

**Backend: ✅ COMPLETE** | **Frontend: ✅ COMPLETE** | **E2E Tested: ✅ 2026-01-27**

1. ✅ **Yahoo Developer setup**
   - ✅ Created Yahoo Developer app "Flaim"
   - ✅ Configured redirect URIs:
     - Production: `https://api.flaim.app/auth/connect/yahoo/callback`
     - Preview: `https://api.flaim.app/auth-preview/connect/yahoo/callback`
   - ✅ Requested `fspt-r` scope (Confidential Client)
   - ✅ Stored `YAHOO_CLIENT_ID` and `YAHOO_CLIENT_SECRET` in Cloudflare secrets (default + preview)

2. ✅ **Supabase migration** (`docs/migrations/009_yahoo_platform.sql`)
   - ✅ Created `yahoo_credentials` table
   - ✅ Created `yahoo_leagues` table
   - ✅ Created `platform_oauth_states` table for CSRF protection

3. ✅ **auth-worker: Platform OAuth routes** (`src/yahoo-connect-handlers.ts`)
   - ✅ `GET /connect/yahoo/authorize` - Build OAuth URL, redirect to Yahoo
   - ✅ `GET /connect/yahoo/callback` - Exchange code, store tokens, redirect to app
   - ✅ `GET /connect/yahoo/credentials` - Get token (refresh if needed)
   - ✅ `DELETE /connect/yahoo/disconnect` - Revoke and delete
   - ✅ `GET /connect/yahoo/status` - Check connection status (bonus endpoint)

4. ✅ **auth-worker: League discovery**
   - ✅ `POST /connect/yahoo/discover` - Call Yahoo API, normalize, upsert leagues
   - ✅ `GET /leagues/yahoo` - List user's Yahoo leagues

5. ✅ **Update `get_user_session`**
   - ✅ Query both `espn_leagues` and `yahoo_leagues`
   - ✅ Return unified list with `platform` field

6. ✅ **Frontend: Connect Yahoo UI**
   - ✅ "Connect Yahoo" button on `/leagues` page redirects to `/api/connect/yahoo/authorize`
   - ✅ Handle `?yahoo=connected` query param on leagues page
   - ✅ Trigger discovery on connect (`discoverYahooLeagues()`)
   - ✅ Show Yahoo leagues on leagues page alongside ESPN leagues
   - ✅ Disconnect flow (`disconnectYahoo()`)

**Status as of 2026-01-27:**
- Full OAuth flow tested end-to-end: user can auth into Yahoo and add leagues successfully
- Yahoo leagues display alongside ESPN leagues on `/leagues` page
- UI cleanup remaining (minor polish work)

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

**Pattern for adding a new platform:**
1. Add `/connect/{platform}/*` routes to auth-worker
2. Create `{platform}_credentials` and `{platform}_leagues` tables
3. Create `{platform}-client` worker with sport handlers
4. Add service binding to `fantasy-mcp`
5. Update `get_user_session` to include new platform's leagues

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
| **Confusing MCP OAuth with Platform OAuth** | Clear route prefixes (`/oauth/*` vs `/connect/*`), prominent documentation |
| OAuth token expiry | On-demand refresh with 5-minute buffer in auth-worker |
| Yahoo JSON parsing complexity | Build normalizers early, test thoroughly with real responses |
| Week/period semantics differ by sport | Default to "current scoring period" |
| League discovery edge cases | Validate with multiple real leagues, handle empty gracefully |
| Service binding configuration errors | Test bindings in preview env first |
| State parameter CSRF attacks | Validate nonce from short-lived cache, reject mismatches |
| Yahoo rate limiting | Add retry with backoff, consider caching league data |

---

## Testing checklist

### Gateway routing
- [ ] Tool calls route to correct platform worker
- [ ] Unknown platform returns error
- [ ] Service bindings work in dev/preview/prod

### Yahoo OAuth (Phase 1) — Unit Tests: ✅ PASSING

- [x] `/connect/yahoo/authorize` redirects to Yahoo with correct params (unit tested)
- [x] `/connect/yahoo/callback` exchanges code and stores tokens (unit tested)
- [x] State parameter validated (rejects invalid/missing state) (unit tested)
- [x] Token refresh works (simulate expiry with `needsRefresh`) (unit tested)
- [x] `/connect/yahoo/disconnect` clears credentials and returns success (unit tested)
- [x] Error handling: invalid code, network failure (unit tested)
- [ ] **E2E test**: Full OAuth flow with real Yahoo account (blocked on frontend UI)

### Yahoo league discovery (Phase 1) — Unit Tests: ✅ PASSING

- [x] `/connect/yahoo/discover` calls Yahoo API with valid token (unit tested)
- [x] Discovers leagues and upserts to storage (unit tested)
- [x] Handles users with no Yahoo leagues (empty array, not error) (unit tested)
- [x] `get_user_session` returns both ESPN and Yahoo leagues with platform field (unit tested)
- [ ] **E2E test**: Real league discovery with real Yahoo account (blocked on frontend UI)

### Yahoo tools (Phase 2+)
- [ ] get_league_info returns correct data
- [ ] get_standings matches Yahoo web UI
- [ ] get_matchups returns correct week
- [ ] get_roster returns players
- [ ] get_free_agents returns available players

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

## Appendix: auth-worker route prefixes

| Prefix | Purpose | Example Routes |
|--------|---------|----------------|
| `/oauth/*` | MCP OAuth (Flaim as provider) | `/oauth/authorize`, `/oauth/token` |
| `/connect/*` | Platform OAuth (Flaim as client) | `/connect/yahoo/callback`, `/connect/sleeper/authorize` |
| `/credentials/*` | Non-OAuth credentials | `/credentials/espn` (cookies via extension) |
| `/leagues/*` | League management | `/leagues/yahoo`, `/leagues/espn/{id}/default` |
| `/extension/*` | Chrome extension | `/extension/sync`, `/extension/discover`, `/extension/status` |

This separation ensures MCP OAuth and Platform OAuth never get confused.
