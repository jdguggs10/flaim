# FLAIM On-Boarding Flow (v6.1) — Auth-Worker + Sport-Worker Split

> Draft – work-in-progress plan (last updated 2025-06-30)

---

## 1. Problem Statement

* We refactored credential storage into **auth-worker** (single KV + encryption).
* The league/roster set-up (“auto-pull”) now requires:
  * ESPN cookies (`swid`, `s2`) – stored in KV.
  * The user-supplied `leagueId` and `sport`.
* The current Next.js API route tries to hit sport MCP workers directly **from the browser**, but those workers don't have the user's credentials unless they query the auth-worker first.
* Result: 400/503 errors such as "MCP server not configured for baseball" or missing-field validation failures.

## 2. Target Architecture

```
Browser ──► Next.js API route (/auto-pull) ──►  🏈  / ⚾  Sport MCP Worker
              (selects worker URL)               │
                                                (1)   GET /credentials/espn   ───► Auth-worker
                                                (2)   Reads KV & returns swid/s2
                                                (3)   Calls ESPN APIs (sport-specific)
                                                (4)   Responds with league info/teams
```

* **Auth-worker**
  * Stores and returns credentials **plus per-user league metadata** (array of `{ leagueId, sport, teamId? }`).
  * Exposes REST endpoints:
    * `POST /credentials/:platform` – store/update cookies
    * `GET  /credentials/:platform` – fetch cookies
    * `POST /leagues` – upsert `{ leagueId, sport }`
    * `GET  /leagues` – list leagues for current user
    * `PATCH /leagues/:leagueId/team` – save or update `{ teamId }`
    * `DELETE /leagues/:leagueId` – remove league entry
* **Sport worker** (baseball-espn-mcp, football-espn-mcp, …)
  * New onboarding endpoint: `POST /onboarding/initialize`
    * Body: `{ leagueId, sport }`
    * Header: `X-Clerk-User-ID`
    * Performs:
      1. Fetch credentials from auth-worker.
      2. Hit ESPN v3 endpoints; build leagueInfo object.
    * Returns `{ success, leagueInfo }` or error.
* **Next.js**
  * `/api/onboarding/espn/auto-pull` becomes a thin proxy:
    * Figures out correct worker URL via `sport → env var map`.
    * Forwards `{ leagueId, sport }` only (no cookies).
    * Adds `X-Clerk-User-ID` header
  * Frontend logic stays the same.

## 3. Work Items

### 3.1 Sport Worker
| Task | File | Notes |
|------|------|-------|
|Add `initialize` route| `src/onboarding/initialize.ts` | share code between sports via lib? |
|Fetch creds from auth-worker| new util `getCredentials(clerkId)` | URL read from ENV `AUTH_WORKER_URL` |
|Build leagueInfo (settings, standings, teams)| existing ESPN client or new wrapper | already implemented in basic-league-info.ts for baseball/football – reuse |
|Return JSON `{ success: true, leagueInfo }`| | |

### 3.2 Auth-Worker
| Task | Status |
|------|--------|
|Implement `/leagues` CRUD endpoints (POST, GET, PATCH, DELETE)| **NEW** |
|Update unit tests & typings for new endpoints| TODO |
|CORS allow sport-worker **and** Next.js origins (if different zone)| TODO |

### 3.3 Next.js routes
| Task | File |
|------|------|
|Remove ESPN credential validation inside `/auto-pull` (handled earlier)| `openai/app/api/onboarding/espn/auto-pull/route.ts` |
|Proxy POST to worker URL| same file |
|Map `sport → WORKER_URL` using env vars `NEXT_PUBLIC_BASEBALL_ESPN_MCP_URL` etc.| same file |

### 3.4 Frontend Components
| Task | File |
|------|------|
|Remove `swid/s2` from auto-pull body| `AutoPullSummary.tsx` |
|Handle errors from worker (401 invalid creds etc.)| already displays `error` field |

### 3.5 Env & Config
| Variable | Where | Example |
|----------|-------|---------|
|`NEXT_PUBLIC_BASEBALL_ESPN_MCP_URL`| `.env.local` | `http://localhost:8787` |
|`NEXT_PUBLIC_FOOTBALL_ESPN_MCP_URL`| `.env.local` | `http://localhost:8788` |
|`NEXT_PUBLIC_AUTH_WORKER_URL` (browser & server calls) | `.env.local` | `http://localhost:8786` |
|`AUTH_WORKER_URL` (inside sport worker) | `wrangler.toml` var or `env` | `https://auth-worker.dev` |

## 4. Testing Checklist

1. **Local dev**  
   a. `wrangler dev` auth-worker (port 8786).  
   b. `wrangler dev` baseball-espn-mcp (8787).  
   c. `npm run dev` Next.js.  
2. Frontend flow:  
   • Enter SWID/S2 – verify `POST /credentials/espn` 200.  
   • Enter leagueId=30201, sport=baseball – verify `POST /leagues` 200.  
   • Click "Set Up Team" – should hit `baseball-worker /onboarding/initialize`, which:  
     – Calls `auth-worker /credentials/espn`.  
     – Calls ESPN, returns roster list.  
   • User selects team → **PATCH** `auth-worker /leagues/{leagueId}/team` 200.  
3. Refresh page – leagues persist & team selection retained.
4. Try invalid creds – worker returns 401 → UI shows error banner.

## 5. Open Questions

* Rate-limiting ESPN calls – caching layer per league inside sport worker?
* How to surface ESPN API errors clearly to UX (e.g. "league out of season").

## 6. Roll-out Steps

1. Update env files & wrangler secrets.  
2. Deploy auth-worker with latest endpoints.  
3. Deploy sport workers with `initialize` route + credential lookup.  
4. Merge Next.js route simplification.  
5. Smoke-test onboarding in staging.  
6. Deploy to production.

---

**Owners**:  
• Auth/KV – `@auth-team`  
• Sport MCP – `@mcp-team`  
• Frontend – `@web-team`

Please edit this doc as work progresses (PR links, endpoint examples, etc.). 