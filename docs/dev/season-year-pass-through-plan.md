# Season Year Pass-Through & Multi-Season Leagues Plan

Date: 2026-01-04
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

### M5 Audit Findings (2026-01-05)
Auto-discover seasons is implemented, but the following fixes are required:

1) **/leagues/add error semantics broken**
   - Problem: `addLeague()` swallows errors and returns `false`, so `/leagues/add` cannot reliably return `DUPLICATE` or `LIMIT_EXCEEDED`.
   - Fix: Change `addLeague()` to throw on duplicate/limit (or return `{ success, code }`), and have `/leagues/add` map those errors correctly.
   - Files: `workers/auth-worker/src/supabase-storage.ts`, `workers/auth-worker/src/index.ts`.

2) **Discovery accepts empty-team seasons**
   - Problem: discovery treats any `info.success` as valid, even when `teams.length === 0`, which later fails auto-pull.
   - Fix: treat `teams.length === 0` as a miss (increment `consecutiveMisses`) and do not auto-save that year.
   - Files: `workers/baseball-espn-mcp/src/index.ts`, `workers/football-espn-mcp/src/index.ts`.

3) **League limit not enforced during discovery**
   - Problem: if `/leagues/add` fails due to limit, discovery continues and still reports success.
   - Fix: on `LIMIT_EXCEEDED`, stop discovery and return partial results + clear error.
   - Files: `workers/baseball-espn-mcp/src/index.ts`, `workers/football-espn-mcp/src/index.ts`.

4) **Consecutive-miss counter resets on skip**
   - Problem: skipping an already-stored season resets `consecutiveMisses`, which can break the “two consecutive misses” stop rule.
   - Fix: do not reset the counter on skips (or explicitly document why skipping resets the count).
   - Files: `workers/baseball-espn-mcp/src/index.ts`, `workers/football-espn-mcp/src/index.ts`.

5) **minYearReached flag can be incorrect**
   - Problem: it only checks the last discovered season, not whether the loop actually hit year 2000.
   - Fix: track a boolean when `year === MIN_YEAR` is evaluated, independent of discoveries.
   - Files: `workers/baseball-espn-mcp/src/index.ts`, `workers/football-espn-mcp/src/index.ts`.

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

## Milestone 5: Auto-Discover Seasons (Implemented, Fixes Pending)

### UX Concept
- After a league is successfully verified/added, show a **"Discover seasons"** button next to it.
- When clicked, the system probes historical seasons and **auto-adds any seasons that exist**.
- Users can still remove seasons they don't want afterward.

### Proposed Endpoint
`POST /onboarding/discover-seasons`

Request (JSON):
```json
{
  "sport": "baseball" | "football",
  "leagueId": "30201",
  "startYear": 2026,
  "minYear": 2000,
  "maxConsecutiveMisses": 2
}
```

Response (JSON):
```json
{
  "success": true,
  "leagueId": "30201",
  "sport": "baseball",
  "startYear": 2026,
  "tried": [2026, 2025, 2024, 2023],
  "found": [2025, 2024, 2023],
  "results": [
    { "seasonYear": 2026, "success": false, "error": "League not found" },
    { "seasonYear": 2025, "success": true, "leagueName": "...", "teams": [...] }
  ]
}
```

### Discovery Algorithm
1) Always try **current year** and **current-1**.
2) Continue backwards year-by-year.
3) Stop when **two consecutive years** return "league not found" or **minYear** cap reached.
4) Do not treat 401/403 as "not found" - abort with auth error.
5) For 429 or 5xx, retry once; if still failing, abort with clear error.
6) Hard floor: **year 2000** (will not probe earlier than this).

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
- ESPN season rollover dates can shift slightly; defaults should be clear and user-overridable. **Implemented** - helper text shown in UI
- Discover-seasons could hit rate limits if the lookback window is too large. **Mitigated** - year 2000 floor with 2-consecutive-miss early termination

---

## Next Steps

1. **Test M0-M4 changes** - Manual E2E test of season year flow
2. **Deploy** - Deploy workers and web app with M0-M4 changes
3. **M5** - Implement discover-seasons feature

---

## M5 Pre-Implementation Risks / Open Issues (from review)

These should be addressed in the discover-seasons implementation before release:

1) **League limit (10) vs auto-discover**
   - `addLeague()` enforces a max of 10 leagues per user.
   - Auto-discover could exceed this and fail midway.
   - Decide behavior: stop with “limit reached,” or raise the limit for multi-season.

2) **Discovery success criteria**
   - ESPN can return `success: true` but with zero teams.
   - Treat `teams.length === 0` as a miss (or return `success: false` in basic-league-info).

3) **`httpStatus` support**
   - Plan depends on `httpStatus` in `basic-league-info` responses.
   - Must add `httpStatus?: number` to both baseball + football helpers and error returns.

4) **Miss counter should not reset on “skipped” years**
   - Skipping already-stored seasons should not reset the consecutive miss counter.
   - Only reset on a successful probe.

5) **/leagues/add error handling**
   - 409 duplicate should be non-fatal.
   - Limit-exceeded (400) should stop discovery and return partial results with a flag.

6) **UI discover button duplication**
   - The list renders a row per season; button may appear multiple times for same leagueId.
   - Optional: show only once per leagueId (e.g., most recent season row).

7) **Toast import / feedback**
   - Plan mentions `toast.success` but current UI may not import toast.
   - Decide whether to add toast or use existing error state.

8) **Refresh helper**
   - Plan references `fetchLeagues()` but no shared helper exists yet.
   - Add a reusable `loadLeagues()` function for refresh after discovery.
