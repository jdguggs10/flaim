# Season Year Pass-Through & Multi-Season Leagues Plan

Date: 2026-01-05
Status: **Complete (M0-M5 Done)**
Owner: TBD

---

## Implementation Status

| Milestone | Status | Notes |
|-----------|--------|-------|
| M0: Schema Audit | **Complete** | `season_year` column confirmed in storage code |
| M1: Season Default Helper | **Complete** | `web/lib/season-utils.ts` created |
| M2: UI + API Wiring | **Complete** | Season input added, auto-pull updated |
| M3: Worker Pass-Through | **Complete** | Both workers accept/use seasonYear |
| M4: Multi-Season Storage + MCP | **Complete** | Delete-all enforcement in auth-worker done |
| M5: Auto-Discover Seasons | **Complete** | Implementation + audit fixes done |

**Database migration required:** apply `docs/migrations/007_espn_leagues_unique_season_year.sql` to update the
`espn_leagues` unique constraint so multi-season inserts do not fail.

### Decisions Made
- **Delete behavior:** Delete removes ALL seasons of a league (no per-season deletion)
- **Backfill existing leagues:** No - leave null as-is
- **Max lookback for discover-seasons:** Back to year 2000

### Post-Audit Fixes (2026-01-04)
After Codex audit, the following issues were fixed:

**Round 1:**
1. **POST validation dedupe** - Now includes seasonYear in duplicate check
2. **updateLeague scoping** - Now requires sport + seasonYear to target specific row
3. **setDefaultLeague scoping** - Now requires seasonYear to set default on specific row
4. **MCP currentSeason** - Uses timezone-aware default (Feb 1 for baseball, Jun 1 for football)
5. **Auto-pull error messages** - Better error messages for season-specific failures
6. **Delete button behavior** - Confirmed to delete ALL seasons (simplified UX)

**Round 2 (regression fixes):**
7. **setDefaultLeague flow** - UI and API now pass seasonYear to worker
8. **Default button UI state** - Key now includes seasonYear for proper loading state
9. **Auto-pull error propagation** - Now checks `targetLeague.success/error` before teams check
10. **MCP tool definitions** - All tool definitions use timezone-aware season helper
11. **Stored seasonYear in /onboarding/initialize** - Workers now use stored league seasonYear

**Round 3 (MCP alignment):**
12. **MCP defaultLeague selection** - Prefers current-season league to avoid team/season mismatch
13. **get_user_session instructions** - Multi-season aware: lists seasons, instructs LLM to ask which
14. **get_user_session response** - Now includes `defaultLeague` object with seasonYear

**Round 4 (final fixes):**
15. **MCP leagueId-only season alignment** - When user provides leagueId without seasonId, uses that league's stored seasonYear
16. **uniqueSeasons filter** - Filters out undefined values before listing seasons in instructions

**Round 5 (delete-all enforcement):**
17. **Delete-all enforcement** - Auth-worker DELETE now ignores seasonYear and always removes all seasons

### M5 Audit Findings (2026-01-05) - All Fixed
Auto-discover seasons audit findings, all resolved:

1) ✅ **/leagues/add error semantics** - `addLeague()` now returns `{ success, code }` with proper HTTP status mapping.

2) ✅ **Empty-team seasons** - Discovery treats `teams.length === 0` as a miss.

3) ✅ **League limit enforcement** - Discovery stops on `LIMIT_EXCEEDED` and returns partial results.

4) ✅ **Consecutive-miss counter** - Skip no longer resets the counter.

5) ✅ **minYearReached flag** - Tracked independently when `year === MIN_YEAR` is evaluated.

### Known Issues / Bugs (2026-01-05)
1) **Discover-seasons aborts on ESPN 401 for older years (football)**
   - Observed in production logs for `POST /onboarding/discover-seasons`:
     - 2026: 404 (expected, league not rolled)
     - 2025: already stored (skip)
     - 2024/2023: 200 OK
     - 2022: **401 Unauthorized** → worker aborts and returns 401
   - Impact: discovery stops early and no older seasons are saved.
   - Hypotheses: ESPN credentials not valid for older seasons, ESPN rate/anti‑bot behavior, or cookie scope issue.
   - Next steps: capture ESPN response body/headers for 401, verify cookie freshness, and decide whether to treat 401 as terminal vs. skip.

### Design Decision: Default League Scope
- **Current behavior:** One default per user across all sports/seasons (unchanged from pre-multi-season)
- **Rationale:** Simpler UX; chat app uses single default regardless of sport
- **Note:** setDefaultLeague clears all other defaults for that user before setting new one

---

## Goals
1) Allow **multiple seasons of the same league** to coexist in storage (same leagueId + sport, different seasonYear).
2) Auto-populate seasonYear using **deterministic rules** based on sport + current date, while still allowing explicit overrides.
3) Pass seasonYear cleanly through the auto-pull flow and into storage, without breaking existing behavior.
4) Provide **auto-discover seasons** so users can pull historical seasons with one click.
5) Make the default season rules **explicit to users** in the UI.
6) Ensure MCP tools expose all available seasons so LLMs can answer historical questions (e.g., "last season").

Non-goals (for this iteration)
- Full UI for browsing prior seasons beyond auto-discover + standard league list.
- Backfilling old leagues without user action.

---

## Files Modified (M0-M4)

### New Files
- `web/lib/season-utils.ts` - `getDefaultSeasonYear()` helper with rollover rules

### Web App
- `web/app/(site)/leagues/page.tsx` - Season Year input, delete-all behavior, display seasonYear in list
- `web/app/api/espn/auto-pull/route.ts` - Accept/forward seasonYear to workers
- `web/app/api/espn/leagues/route.ts` - DELETE ignores seasonYear (delete all)

### Workers
- `workers/auth-worker/src/supabase-storage.ts` - `addLeague` dedupe includes seasonYear, `removeLeague` always deletes all seasons
- `workers/auth-worker/src/index.ts` - DELETE endpoint ignores seasonYear (delete all)
- `workers/baseball-espn-mcp/src/index.ts` - `/onboarding/initialize` accepts seasonYear
- `workers/baseball-espn-mcp/src/mcp/basic-league-info.ts` - Uses seasonYear in ESPN API URL
- `workers/baseball-espn-mcp/src/mcp/agent.ts` - `UserLeague` interface includes seasonYear
- `workers/football-espn-mcp/src/index.ts` - `/onboarding/initialize` accepts seasonYear
- `workers/football-espn-mcp/src/mcp/basic-league-info.ts` - Uses seasonYear in ESPN API URL
- `workers/football-espn-mcp/src/mcp/football-agent.ts` - `UserLeague` interface includes seasonYear

---

## Files Modified (M5)

- `docs/migrations/007_espn_leagues_unique_season_year.sql` - Update unique constraint to include season_year
- `workers/auth-worker/src/supabase-storage.ts` - `addLeague` now returns structured result with codes
- `workers/auth-worker/src/index.ts` - Added `POST /leagues/add` (single-league add)
- `workers/baseball-espn-mcp/src/mcp/basic-league-info.ts` - Adds `httpStatus` in error responses
- `workers/football-espn-mcp/src/mcp/basic-league-info.ts` - Adds `httpStatus` in error responses
- `workers/baseball-espn-mcp/src/index.ts` - Added `/onboarding/discover-seasons` endpoint
- `workers/football-espn-mcp/src/index.ts` - Added `/onboarding/discover-seasons` endpoint
- `web/app/api/espn/discover-seasons/route.ts` - Web API proxy to worker endpoint
- `web/app/(site)/leagues/page.tsx` - Discover seasons button + handler

---

## Default Season Rules (Implemented)

Rules (using America/New_York timezone):
- **Baseball (flb)**
  - Default to previous year **until Feb 1**, then switch to current year.
  - Example today (Jan 4, 2026): default = **2025**.
  - On Feb 1, 2026: default becomes **2026**.

- **Football (ffl)**
  - Default to previous year **until Jun 1**, then switch to current year.
  - Example today (Jan 4, 2026): default = **2025**.
  - On Jun 1, 2026: default becomes **2026**.

Implementation in `web/lib/season-utils.ts`:
```typescript
export function getDefaultSeasonYear(sport: SeasonSport, now = new Date()): number {
  const ny = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);

  const year = Number(ny.find((p) => p.type === 'year')?.value);
  const month = Number(ny.find((p) => p.type === 'month')?.value);

  const rolloverMonth = ROLLOVER_MONTHS[sport] || 1;
  return month < rolloverMonth ? year - 1 : year;
}
```

---

## Multi-Season Storage Behavior (Implemented)

- Multiple rows per `(clerk_user_id, sport, league_id)` allowed when `season_year` differs
- `addLeague()` duplicate check includes seasonYear
- `removeLeague()` deletes ALL seasons for a league (no per-season deletion)
- **UI delete button always deletes ALL seasons** (simplified UX, no per-season management)
- **Web API delete route ignores seasonYear** (even if passed, deletes all)
- UI displays seasonYear in league list for informational purposes

---

## MCP Tool Implications (Implemented)

- `UserLeague` interface in both agents now includes:
  - `seasonYear?: number`
  - `leagueName?: string`
  - `teamName?: string`
  - `isDefault?: boolean`
- `get_user_session` returns all leagues with seasonYear included
- LLMs can distinguish between seasons when users have multiple years of the same league

---

## Milestone 5: Auto-Discover Seasons (Complete)

### UX Concept
- After a league is successfully verified/added, show a **"Discover seasons"** button next to it.
- When clicked, the system probes historical seasons and **auto-adds any seasons that exist**.
- Users can still remove seasons they don't want afterward.

### Implemented Endpoints
Worker:
`POST /onboarding/discover-seasons`

Web API:
`POST /api/espn/discover-seasons`

Worker request (JSON):
```json
{
  "leagueId": "30201"
}
```

Web API request (JSON):
```json
{
  "sport": "baseball" | "football",
  "leagueId": "30201"
}
```

Response (JSON):
```json
{
  "success": true,
  "leagueId": "30201",
  "sport": "baseball",
  "startYear": 2026,
  "minYearReached": false,
  "rateLimited": false,
  "limitExceeded": false,
  "skipped": 1,
  "discovered": [
    { "seasonYear": 2025, "leagueName": "...", "teamCount": 12 }
  ],
  "error": null
}
```

### Discovery Algorithm
1) Always probe **current year** and **current-1**, regardless of prior misses.
2) Continue backwards year-by-year to **year 2000**.
3) Skip already-stored seasons (do not reset miss counter).
4) Stop when **two consecutive years** return 404 (miss).
5) Treat empty-team responses as misses (do not auto-save).
6) On 401/403: abort with auth error.
7) On 429: stop immediately and return partial results.
8) On 5xx: retry once; if still failing, abort with clear error.

### Follow-up Fixes (Complete)
- [x] Fix `/leagues/add` error semantics so duplicates/limit are surfaced correctly
- [x] Treat empty-team responses as misses (do not auto-save)
- [x] Stop discovery on `LIMIT_EXCEEDED` (return partial results + error)
- [x] Do not reset consecutive misses on skipped seasons
- [x] Track `minYearReached` independently of discoveries
- [x] Add "Discover seasons" UI button in leagues page
- [x] Auto-add discovered seasons to storage

---

## Risks (Updated)

- ~~Changing uniqueness to include seasonYear could break existing delete/update flows.~~ **Mitigated** - application-level checks, no DB constraint change needed
- ~~Different environments might not have the `season_year` column consistently.~~ **Verified** - column exists in storage code
- ~~Default league assumptions may cause unexpected UI behavior if not updated.~~ **Addressed** - one default per user overall, unchanged
- ~~ESPN season rollover dates can shift slightly; defaults should be clear and user-overridable.~~ **Implemented** - helper text shown in UI
- ~~Discover-seasons could hit rate limits if the lookback window is too large.~~ **Mitigated** - year 2000 floor with 2-consecutive-miss early termination

---

## Next Steps

1. **E2E Testing** - Manual testing of full season year flow including discover-seasons
2. **Deploy** - Deploy workers and web app with all changes
