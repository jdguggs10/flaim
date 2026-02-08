# Season Year Normalization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Normalize `season_year` to always store the start year of the season, with ESPN-specific translation at the API boundary, so all sports (including future basketball/hockey) work consistently across platforms.

**Architecture:** Auth-worker is the single source of truth for season logic. ESPN discovery normalizes ESPN's end-year convention to start-year before writing to Supabase. ESPN-client denormalizes back to ESPN-native before calling ESPN APIs. The MCP gateway and web app never think about platform-specific year conventions. `web/lib/season-utils.ts` is deleted — the web app consumes season data from the auth-worker.

**Tech Stack:** TypeScript, Vitest, Cloudflare Workers (Hono), Next.js

**Reference doc:** `docs/dev/season-year-problem.md`

---

### Task 1: Update auth-worker season-utils — rollover months + translation functions

The auth-worker's `season-utils.ts` is the canonical source of all season logic. Update rollover months and add the translation/label functions.

**Files:**
- Modify: `workers/auth-worker/src/season-utils.ts`
- Modify: `workers/auth-worker/src/__tests__/season-utils.test.ts`

**Step 1: Write failing tests for new rollover months and translation functions**

Add to `workers/auth-worker/src/__tests__/season-utils.test.ts`:

```ts
// Update existing basketball tests (rollover changes from Oct 1 → Aug 1)
describe('basketball', () => {
  it('returns previous year before Aug 1', () => {
    const jul15 = new Date('2026-07-15T12:00:00-04:00');
    expect(getDefaultSeasonYear('basketball', jul15)).toBe(2025);
  });

  it('returns current year on Aug 1', () => {
    const aug1 = new Date('2026-08-01T00:00:00-04:00');
    expect(getDefaultSeasonYear('basketball', aug1)).toBe(2026);
  });

  it('returns previous year in January (mid-season)', () => {
    const jan15 = new Date('2026-01-15T12:00:00-05:00');
    expect(getDefaultSeasonYear('basketball', jan15)).toBe(2025);
  });
});

// Update existing hockey tests (rollover changes from Oct 1 → Aug 1)
describe('hockey', () => {
  it('returns previous year before Aug 1', () => {
    const jul15 = new Date('2026-07-15T12:00:00-04:00');
    expect(getDefaultSeasonYear('hockey', jul15)).toBe(2025);
  });

  it('returns current year on Aug 1', () => {
    const aug1 = new Date('2026-08-01T00:00:00-04:00');
    expect(getDefaultSeasonYear('hockey', aug1)).toBe(2026);
  });
});

// Update existing football test (rollover changes from Jun 1 → Jul 1)
describe('football', () => {
  it('returns previous year before Jul 1', () => {
    const jun15 = new Date('2026-06-15T12:00:00-04:00');
    expect(getDefaultSeasonYear('football', jun15)).toBe(2025);
  });

  it('returns current year on Jul 1', () => {
    const jul1 = new Date('2026-07-01T00:00:00-04:00');
    expect(getDefaultSeasonYear('football', jul1)).toBe(2026);
  });

  it('returns current year in January (post-playoffs)', () => {
    const jan15 = new Date('2026-01-15T12:00:00-05:00');
    expect(getDefaultSeasonYear('football', jan15)).toBe(2025);
  });
});
```

Add new test blocks for translation and label functions:

```ts
import { toCanonicalYear, toPlatformYear, getSeasonLabel } from '../season-utils';

describe('toCanonicalYear', () => {
  it('subtracts 1 for ESPN basketball', () => {
    expect(toCanonicalYear(2025, 'basketball', 'espn')).toBe(2024);
  });

  it('subtracts 1 for ESPN hockey', () => {
    expect(toCanonicalYear(2025, 'hockey', 'espn')).toBe(2024);
  });

  it('passes through ESPN baseball', () => {
    expect(toCanonicalYear(2025, 'baseball', 'espn')).toBe(2025);
  });

  it('passes through ESPN football', () => {
    expect(toCanonicalYear(2025, 'football', 'espn')).toBe(2025);
  });

  it('passes through Yahoo basketball', () => {
    expect(toCanonicalYear(2024, 'basketball', 'yahoo')).toBe(2024);
  });

  it('passes through Yahoo hockey', () => {
    expect(toCanonicalYear(2024, 'hockey', 'yahoo')).toBe(2024);
  });
});

describe('toPlatformYear', () => {
  it('adds 1 for ESPN basketball', () => {
    expect(toPlatformYear(2024, 'basketball', 'espn')).toBe(2025);
  });

  it('adds 1 for ESPN hockey', () => {
    expect(toPlatformYear(2024, 'hockey', 'espn')).toBe(2025);
  });

  it('passes through ESPN baseball', () => {
    expect(toPlatformYear(2025, 'baseball', 'espn')).toBe(2025);
  });

  it('passes through ESPN football', () => {
    expect(toPlatformYear(2025, 'football', 'espn')).toBe(2025);
  });

  it('passes through Yahoo basketball', () => {
    expect(toPlatformYear(2024, 'basketball', 'yahoo')).toBe(2024);
  });

  it('round-trips correctly for ESPN basketball', () => {
    const espnYear = 2025;
    const canonical = toCanonicalYear(espnYear, 'basketball', 'espn');
    const backToEspn = toPlatformYear(canonical, 'basketball', 'espn');
    expect(backToEspn).toBe(espnYear);
  });
});

describe('getSeasonLabel', () => {
  it('returns hyphenated label for basketball', () => {
    expect(getSeasonLabel(2024, 'basketball')).toBe('2024-25');
  });

  it('returns hyphenated label for hockey', () => {
    expect(getSeasonLabel(2025, 'hockey')).toBe('2025-26');
  });

  it('returns plain year for baseball', () => {
    expect(getSeasonLabel(2025, 'baseball')).toBe('2025');
  });

  it('returns plain year for football', () => {
    expect(getSeasonLabel(2025, 'football')).toBe('2025');
  });

  it('handles century boundary', () => {
    expect(getSeasonLabel(2099, 'basketball')).toBe('2099-00');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd workers/auth-worker && npx vitest run src/__tests__/season-utils.test.ts`
Expected: Multiple failures (rollover months wrong, functions don't exist yet)

**Step 3: Update season-utils.ts**

In `workers/auth-worker/src/season-utils.ts`:

Update rollover months:
```ts
const ROLLOVER_MONTHS: Record<SeasonSport, number> = {
  baseball: 2,    // Feb 1 (~10 weeks before Opening Day late March)
  football: 7,    // Jul 1 (~10 weeks before NFL kickoff early September)
  basketball: 8,  // Aug 1 (~10 weeks before NBA opening night late October)
  hockey: 8,      // Aug 1 (~10 weeks before NHL opening night early October)
};
```

Add translation functions after `isCurrentSeason()`:

```ts
/**
 * Normalize a platform-specific season year to Flaim's canonical form (start year).
 *
 * ESPN uses the END year for NBA/NHL (e.g., 2025 for the 2024-25 season).
 * All other platform/sport combinations already use the start year.
 *
 * @param platformYear - The season year as returned by the platform API
 * @param sport - The sport
 * @param platform - The platform ('espn', 'yahoo', etc.)
 * @returns The canonical start year
 */
export function toCanonicalYear(platformYear: number, sport: string, platform: string): number {
  if ((sport === 'basketball' || sport === 'hockey') && platform === 'espn') {
    return platformYear - 1;
  }
  return platformYear;
}

/**
 * Convert Flaim's canonical season year (start year) to a platform-native value.
 *
 * ESPN expects the END year for NBA/NHL (e.g., 2025 for the 2024-25 season).
 * All other platform/sport combinations expect the start year as-is.
 *
 * @param canonicalYear - The canonical start year from Supabase
 * @param sport - The sport
 * @param platform - The platform ('espn', 'yahoo', etc.)
 * @returns The platform-native season year
 */
export function toPlatformYear(canonicalYear: number, sport: string, platform: string): number {
  if ((sport === 'basketball' || sport === 'hockey') && platform === 'espn') {
    return canonicalYear + 1;
  }
  return canonicalYear;
}

/**
 * Get a human-readable season label from a canonical start year.
 *
 * Cross-year sports (basketball, hockey) return "2024-25" format.
 * Single-year sports (baseball) and football return "2025" format.
 * Football technically spans years but is universally referred to by start year.
 *
 * @param canonicalYear - The canonical start year
 * @param sport - The sport
 * @returns Display label (e.g., "2024-25" or "2025")
 */
export function getSeasonLabel(canonicalYear: number, sport: string): string {
  if (sport === 'basketball' || sport === 'hockey') {
    return `${canonicalYear}-${String(canonicalYear + 1).slice(2)}`;
  }
  return String(canonicalYear);
}
```

**Step 4: Run tests to verify they pass**

Run: `cd workers/auth-worker && npx vitest run src/__tests__/season-utils.test.ts`
Expected: All pass

**Step 5: Commit**

```bash
git add workers/auth-worker/src/season-utils.ts workers/auth-worker/src/__tests__/season-utils.test.ts
git commit -m "feat: update season rollover months and add year translation functions"
```

---

### Task 2: Normalize ESPN discovery to store canonical season year

The ESPN league discovery flow writes `league.seasonId` (ESPN-native) directly to Supabase. For basketball/hockey, this needs normalization.

**Important:** The `getLeagueInfo()` and `getLeagueTeams()` calls within discovery use the year to call ESPN's API directly — these must keep the ESPN-native value. Only the Supabase writes and duplicate checks need canonical values.

**Files:**
- Modify: `workers/auth-worker/src/v3/league-discovery.ts:272-306,392-400`

**Step 1: Update current-season discovery (lines ~272-306)**

At the top of `league-discovery.ts`, add the import:
```ts
import { toCanonicalYear } from '../season-utils';
```

In the loop that processes discovered leagues, normalize before DB operations. The key changes:

```ts
// Around line 271-289: Compute canonical year once, use for DB operations
const sport = gameIdToSport(league.gameId);
const canonicalSeasonYear = toCanonicalYear(league.seasonId, sport || 'football', 'espn');

// leagueExists check — use canonical year (that's what's in the DB)
const exists = await storage.leagueExists(
  userId,
  sport,
  league.leagueId,
  canonicalSeasonYear  // was: league.seasonId
);

// addLeague — store canonical year
const result = await storage.addLeague(userId, {
  leagueId: league.leagueId,
  sport: sport as 'football' | 'baseball' | 'basketball' | 'hockey',
  leagueName: league.leagueName,
  teamId: String(league.teamId),
  teamName: league.teamName,
  seasonYear: canonicalSeasonYear,  // was: league.seasonId
});

// discovered list for UI — also canonical
discovered.push({
  sport: sport as 'football' | 'baseball' | 'basketball' | 'hockey',
  leagueId: league.leagueId,
  leagueName: league.leagueName,
  teamId: String(league.teamId),
  teamName: league.teamName,
  seasonYear: canonicalSeasonYear,  // was: league.seasonId
});
```

**Step 2: Update historical season discovery (lines ~369-400)**

In `discoverHistoricalSeasons()`, the `year` values come from ESPN's `previousSeasons` array — these are ESPN-native. The `getLeagueInfo()` and `getLeagueTeams()` calls MUST keep ESPN-native values (they call ESPN's API). Only the `addLeague()` call needs canonical.

```ts
// Around line 392-400:
// year is ESPN-native — keep it for ESPN API calls above
// Normalize only for the Supabase write
const canonicalYear = toCanonicalYear(year, sport || 'football', 'espn');

const addResult = await storage.addLeague(userId, {
  leagueId: league.leagueId,
  sport: sport as 'football' | 'baseball' | 'basketball' | 'hockey',
  leagueName: historicalInfo?.leagueName || league.leagueName,
  teamId: String(league.teamId),
  teamName: league.teamName,
  seasonYear: canonicalYear,  // was: year
});
```

**Step 3: Verify no other ESPN-native writes exist**

Grep for `seasonYear: league.seasonId` and `seasonYear: year` in the auth-worker to make sure no writes were missed. The `getLeagueInfo(swid, s2, leagueId, league.seasonId, gameId)` call at line 360 must NOT be changed — it calls ESPN directly.

**Step 4: Run existing discovery tests**

Run: `cd workers/auth-worker && npx vitest run src/__tests__/league-discovery.test.ts`
Expected: Pass (existing tests use baseball/football where no translation occurs)

**Step 5: Commit**

```bash
git add workers/auth-worker/src/v3/league-discovery.ts
git commit -m "feat: normalize ESPN season year to canonical start year at discovery"
```

---

### Task 3: Denormalize in ESPN-client before calling ESPN APIs

The espn-client receives canonical `season_year` from the MCP gateway. For basketball/hockey, it must translate to ESPN-native before constructing API URLs and filtering response data.

**Files:**
- Create: `workers/espn-client/src/shared/season.ts`
- Modify: `workers/espn-client/src/sports/football/handlers.ts:41`
- Modify: `workers/espn-client/src/sports/baseball/handlers.ts:41` (same pattern)
- Future: `workers/espn-client/src/sports/basketball/handlers.ts` (when created)
- Future: `workers/espn-client/src/sports/hockey/handlers.ts` (when created)

**Step 1: Create the translation helper in espn-client**

The espn-client doesn't import from auth-worker. Create a minimal, self-contained helper:

Write `workers/espn-client/src/shared/season.ts`:

```ts
/**
 * Season Year Translation for ESPN
 *
 * Flaim stores canonical start-year (e.g., 2024 for the 2024-25 NBA season).
 * ESPN's API expects end-year for basketball/hockey (e.g., 2025).
 * This function converts canonical → ESPN-native.
 */
export function toEspnSeasonYear(canonicalYear: number, sport: string): number {
  if (sport === 'basketball' || sport === 'hockey') {
    return canonicalYear + 1;
  }
  return canonicalYear;
}
```

**Step 2: Wire into existing handlers**

In both `football/handlers.ts` and `baseball/handlers.ts`, every handler destructures `season_year` from params and uses it directly in ESPN URLs and stat filtering. For football and baseball, `toEspnSeasonYear` is a no-op — but calling it consistently establishes the pattern for when basketball/hockey handlers are added.

At the top of each handler function, add the translation:

```ts
import { toEspnSeasonYear } from '../../shared/season';

// Inside each handler, after destructuring params:
const { league_id, season_year: canonical_year } = params;
const season_year = toEspnSeasonYear(canonical_year, params.sport);
```

This renames the incoming param and creates a local `season_year` that's ESPN-native. The rest of the handler code (URL construction, `s.seasonId === season_year` filters) works unchanged.

For football and baseball this is a no-op today. But it ensures that when basketball/hockey handlers are created, copying the pattern from existing handlers will automatically include the translation.

**Alternative (minimal approach):** If you prefer not to touch football/baseball handlers since they're no-ops, only add this to the espn-client `index.ts` `/execute` route with a comment, and apply the translation in future basketball/hockey handlers only. This is acceptable — the risk of forgetting is low since the handlers don't exist yet and will be written with this pattern in mind.

**Step 3: Add unit tests for `toEspnSeasonYear`**

Create `workers/espn-client/src/shared/__tests__/season.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toEspnSeasonYear } from '../season';

describe('toEspnSeasonYear', () => {
  it('adds 1 for basketball', () => {
    expect(toEspnSeasonYear(2024, 'basketball')).toBe(2025);
  });

  it('adds 1 for hockey', () => {
    expect(toEspnSeasonYear(2024, 'hockey')).toBe(2025);
  });

  it('passes through football', () => {
    expect(toEspnSeasonYear(2025, 'football')).toBe(2025);
  });

  it('passes through baseball', () => {
    expect(toEspnSeasonYear(2025, 'baseball')).toBe(2025);
  });
});
```

**Step 4: Verify existing tests pass**

Run: `cd workers/espn-client && npx vitest run`
Expected: Pass (football/baseball translation is a no-op, new tests pass)

**Step 5: Commit**

```bash
git add workers/espn-client/src/shared/season.ts workers/espn-client/src/shared/__tests__/season.test.ts workers/espn-client/src/sports/football/handlers.ts workers/espn-client/src/sports/baseball/handlers.ts
git commit -m "feat: add ESPN season year denormalization at API boundary"
```

---

### Task 4: Update fantasy-mcp gateway — consolidate season logic + add labels

The fantasy-mcp gateway has its own inline `getCurrentSeason()` function (lines 151-179 of `tools.ts`) with hardcoded rollover months. Update it to match the new months and add season labels to the `get_user_session` response.

**Files:**
- Modify: `workers/fantasy-mcp/src/mcp/tools.ts:151-179,364-404,550`

**Step 1: Update `getCurrentSeason()` rollover months**

In `workers/fantasy-mcp/src/mcp/tools.ts`, update the inline function:

```ts
function getCurrentSeason(sport: Sport): number {
  const now = new Date();
  const ny = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);

  const year = Number(ny.find((p) => p.type === 'year')?.value);
  const month = Number(ny.find((p) => p.type === 'month')?.value);

  switch (sport) {
    case 'baseball':
      return month < 2 ? year - 1 : year;   // Feb 1 (unchanged)
    case 'football':
      return month < 7 ? year - 1 : year;   // Jul 1 (was Jun 1)
    case 'basketball':
      return month < 8 ? year - 1 : year;   // Aug 1 (was Oct 1)
    case 'hockey':
      return month < 8 ? year - 1 : year;   // Aug 1 (was Oct 1)
    default:
      return year;
  }
}
```

**Step 2: Add `getSeasonLabel()` helper**

Add below `getCurrentSeason()`:

```ts
function getSeasonLabel(canonicalYear: number, sport: string): string {
  if (sport === 'basketball' || sport === 'hockey') {
    return `${canonicalYear}-${String(canonicalYear + 1).slice(2)}`;
  }
  return String(canonicalYear);
}
```

**Step 3: Enrich `get_user_session` response with season labels**

In the `currentSeasons` block of the handler (around line 367):

```ts
currentSeasons: {
  football: { year: getCurrentSeason('football'), label: getSeasonLabel(getCurrentSeason('football'), 'football') },
  baseball: { year: getCurrentSeason('baseball'), label: getSeasonLabel(getCurrentSeason('baseball'), 'baseball') },
  basketball: { year: getCurrentSeason('basketball'), label: getSeasonLabel(getCurrentSeason('basketball'), 'basketball') },
  hockey: { year: getCurrentSeason('hockey'), label: getSeasonLabel(getCurrentSeason('hockey'), 'hockey') },
},
```

Also add `season` label to league entries in the response. In the `defaultLeague` block (around line 378) and `allLeagues` mapping, add:

```ts
season: getSeasonLabel(defaultLeague.seasonYear || getCurrentSeason(defaultLeague.sport as Sport), defaultLeague.sport || ''),
```

**Step 4: Update `season_year` tool parameter descriptions**

For all tools that have `season_year` in their schema (get_league_info, get_standings, get_matchups, get_roster, get_free_agents), update the description:

```ts
season_year: z.number().describe('Season start year (e.g., 2025 for MLB 2025, 2024 for NBA 2024-25)'),
```

**Step 5: Update `get_user_session` description**

Replace the "call this first" instruction (line 195-196):

```ts
description:
  "Returns the user's configured fantasy leagues with current season info. Use the returned platform, sport, leagueId, teamId, and seasonYear values for all subsequent tool calls. season_year always represents the start year of the season.",
```

**Step 6: Run tests**

Run: `cd workers/fantasy-mcp && npx vitest run`
Expected: Pass

**Step 7: Commit**

```bash
git add workers/fantasy-mcp/src/mcp/tools.ts
git commit -m "feat: update MCP gateway season logic and add season labels"
```

> **Follow-up (not blocking):** `getCurrentSeason()` and `getSeasonLabel()` are now duplicated between auth-worker and fantasy-mcp. Consider extracting both into `@flaim/worker-shared` in a future PR to maintain a single copy of rollover months. The duplication is acceptable for now — these values change extremely rarely.

---

### Task 5: Remove web/lib/season-utils.ts and refactor callers

The web app should not compute season years locally. The auth-worker is the source of truth. Remove the file and update its four callers.

**Files:**
- Delete: `web/lib/season-utils.ts`
- Modify: `web/lib/chat/prompts/league-context.ts:11,79-84,106-110`
- Modify: `web/stores/chat/useLeaguesStore.ts:9,296-303`
- Modify: `web/app/(site)/leagues/page.tsx:45,244,1384-1429`
- Modify: `web/app/api/espn/auto-pull/route.ts:15,39-42`

**Step 1: Refactor league-context.ts**

Remove the `import { getDefaultSeasonYear, type SeasonSport }` line. The `isRecentLeague` function and the active league season computation currently use `getDefaultSeasonYear`. Replace with simpler logic:

For `isRecentLeague`: use `new Date().getFullYear()` as a rough threshold. The function filters leagues to "current or previous year" — this doesn't need sport-specific rollover precision, just a reasonable window.

```ts
function isRecentLeague(league: ChatLeague): boolean {
  if (!league.seasonYear) return true;
  const currentYear = new Date().getFullYear();
  return league.seasonYear >= currentYear - 1;
}
```

For the active league season: the stored `seasonYear` is now canonical (the auth-worker normalizes it). Just use it directly. Remove the `hasSeason` / `getDefaultSeasonYear` conditional:

```ts
const seasonYear = activeLeague.seasonYear || new Date().getFullYear();
```

**Step 2: Refactor useLeaguesStore.ts**

The `getLeaguesForSport` function uses `getDefaultSeasonYear` to filter to current-season leagues. Replace with `new Date().getFullYear()`. Since the store's `seasonYear` values come from the auth-worker (canonical), and the rollover window is generous (~10 weeks early), using the calendar year is close enough for UI filtering:

```ts
getLeaguesForSport: (sport) => {
  const { leagues } = get();
  const currentYear = new Date().getFullYear();
  return leagues.filter(l => l.sport === sport && l.seasonYear === currentYear);
},
```

Remove the `import { getDefaultSeasonYear, type SeasonSport }` line.

**Step 3: Refactor leagues/page.tsx**

Replace `getDefaultSeasonYear` calls with `new Date().getFullYear()`. This is a form default for the "add league manually" dialog — if the default is slightly wrong for a specific sport, the user can adjust. The auth-worker will normalize at discovery time regardless.

Replace all instances of `getDefaultSeasonYear(sport)` and `getDefaultSeasonYear(sport as SeasonSport)` with `new Date().getFullYear()`.

Remove the "This season" / "Last season" toggle buttons that depend on sport-specific rollover, or simplify them to use current year / current year - 1.

Remove the `import { getDefaultSeasonYear, type SeasonSport }` line.

**Step 4: Refactor auto-pull/route.ts**

This API route computes a default season year before proxying to the ESPN-client onboarding handler. The ESPN-client already falls back to `new Date().getFullYear()` when `seasonYear` is omitted (see `basic-league-info.ts:50`), so simply pass through the user's requested year without computing a default:

```ts
const seasonYear = requestedSeasonYear; // ESPN-client computes default if omitted
```

Remove the `import { getDefaultSeasonYear, type SeasonSport }` line.

**Step 5: Delete web/lib/season-utils.ts**

```bash
rm web/lib/season-utils.ts
```

**Step 6: Verify build**

Run: `cd web && npm run build`
Expected: Build succeeds with no import errors

**Step 7: Commit**

```bash
git add -u web/lib/season-utils.ts web/lib/chat/prompts/league-context.ts web/stores/chat/useLeaguesStore.ts web/app/\(site\)/leagues/page.tsx web/app/api/espn/auto-pull/route.ts
git commit -m "refactor: remove web/lib/season-utils.ts, use auth-worker as season source of truth"
```

---

### Task 6: Update documentation

**Files:**
- Modify: `docs/dev/season-year-problem.md`

**Step 1: Update status and add implementation notes**

Change status from "Open" to "Resolved" and add a section documenting what was implemented:

- Canonical form: start year for all sports
- Rollover months: Feb (baseball), Jul (football), Aug (basketball, hockey)
- Translation at two ESPN-specific boundaries
- Season labels in MCP responses
- `web/lib/season-utils.ts` deleted

**Step 2: Commit**

```bash
git add docs/dev/season-year-problem.md
git commit -m "docs: mark season-year-problem as resolved"
```

---

## Summary of Changes

| Location | Change | Why |
|----------|--------|-----|
| `workers/auth-worker/src/season-utils.ts` | Updated rollover months; added `toCanonicalYear`, `toPlatformYear`, `getSeasonLabel` | Single source of truth for all season logic |
| `workers/auth-worker/src/v3/league-discovery.ts` | Normalize ESPN `seasonId` before Supabase writes | ESPN NBA/NHL returns end-year; we store start-year |
| `workers/espn-client/src/shared/season.ts` | New `toEspnSeasonYear()` helper | ESPN API expects end-year for NBA/NHL |
| `workers/espn-client/src/sports/*/handlers.ts` | Translate canonical → ESPN-native at handler entry | URL construction and stat filtering need ESPN-native values |
| `workers/fantasy-mcp/src/mcp/tools.ts` | Updated rollover months; added season labels to `get_user_session` response; updated tool descriptions | LLM sees "2024-25" instead of ambiguous "2024" |
| `web/lib/season-utils.ts` | Deleted | Auth-worker is the source of truth |
| `web/` (4 files) | Replaced `getDefaultSeasonYear` with simple year logic or auth-worker data | Web app consumes, doesn't compute |

---

## Review Notes (Codex feedback, 2026-02-04)

| Finding | Severity | Disposition |
|---------|----------|-------------|
| No data migration/backfill for existing rows | P1 | **Non-issue.** No basketball/hockey data exists in Supabase. Baseball/football need no translation. |
| Auth-worker "single source of truth" contradicted by MCP + web logic | P1 | **Accepted (pragmatic).** Workers can't import across boundaries. MCP duplication noted as follow-up in Task 4. Web uses rough `getFullYear()` for UI only — auth-worker normalizes at write time. |
| Auto-pull default season drift at rollovers | P2 | **Fixed in plan.** Task 5 Step 4 now passes through `undefined` instead of computing a default — ESPN-client handles the fallback. |
| Coverage gaps (no tests for ESPN-client translation, discovery normalization, MCP labels) | P2 | **Partially addressed.** Added `toEspnSeasonYear` test file in Task 3. Discovery normalization is tested indirectly via Task 1 unit tests (same function). MCP label tests deferred — MCP tools tests are sparse in general. |
| Execution instruction conflicts with session | P3 | **Non-issue for plan correctness.** Meta-instruction for future execution sessions. |
