# The Season Year Problem

**Date:** 2026-02-04
**Status:** Open — needs design decision before adding basketball/hockey support

## Problem Statement

Flaim stores `season_year` as a single integer in Supabase (e.g., `2025`). This integer serves three purposes:

1. **API round-trip value** — passed back to ESPN/Yahoo APIs to fetch data for the correct season
2. **Display value** — shown to users in the UI and injected into the LLM prompt
3. **Identity key** — part of the unique constraint that distinguishes league-seasons in the database

Today this works because Flaim only supports baseball (MLB) and football (NFL), and both ESPN and Yahoo happen to agree on what integer represents a given season for those sports. But basketball (NBA) and hockey (NHL) seasons span two calendar years, and **ESPN and Yahoo use opposite conventions** for which year represents the same real-world season. A single integer cannot satisfy all three purposes across both platforms for these sports.

## The Core Conflict

### All four sports span two calendar years

This is easy to miss: the NFL season runs Sep–Feb, so the "2025 NFL season" technically spans 2025 and 2026. The difference is that both ESPN and Yahoo call it `2025` — they agree. For NBA and NHL, they don't.

| Sport | Real-world season | ESPN `seasonId` | Yahoo `season` | Agreement? |
|-------|-------------------|-----------------|----------------|------------|
| Baseball (MLB) | Apr–Oct 2025 | `2025` | `2025` | Yes |
| Football (NFL) | Sep 2025–Feb 2026 | `2025` | `2025` | Yes |
| Basketball (NBA) | Oct 2024–Jun 2025 | `2025` | `2024` | **No** |
| Hockey (NHL) | Oct 2024–Jun 2025 | `2025` | `2024` | **No** |

ESPN is internally inconsistent — it uses the **start year** for NFL but the **end year** for NBA/NHL. Yahoo consistently uses the **start year** for all sports. Neither is "wrong"; these are just the conventions each platform chose.

### Other platforms for reference

| Platform | NBA/NHL 2024-25 | Convention | Source |
|----------|-----------------|------------|--------|
| Sleeper | `2025` | End year | [docs](https://docs.sleeper.com/) |
| NHL official API | `20242025` | Both years concatenated | [ref](https://github.com/Zmalski/NHL-API-Reference) |
| NBA official API | `2024-25` | Hyphenated string | |
| SportsDataIO | `2024REG` | Start year + type suffix | [docs](https://support.sportsdata.io/hc/en-us/articles/15196612633623-Process-Guide-Season-Types-and-Parameters) |

There is no industry standard.

## Concrete Example of the Problem

Imagine a user has an ESPN NBA league and a Yahoo NBA league, both for the 2024-25 season:

**At discovery time:**
- ESPN returns `seasonId: 2025` → stored as `season_year: 2025`
- Yahoo returns `season: 2024` → stored as `season_year: 2024`

**In the UI (leagues page):**
- ESPN league shows "Season: 2025"
- Yahoo league shows "Season: 2024"
- User sees two different "seasons" for what is actually the same real-world NBA season

**In the LLM prompt:**
```
ACTIVE LEAGUE:
- League: My ESPN NBA League
- Season: 2025

OTHER LEAGUES:
- My Yahoo NBA League (yahoo basketball, ID: 418.l.12345, 2024)
```
The model has no way to know these refer to the same season. If the user says "compare my two basketball leagues," the model might think they're from different years.

**In `getDefaultSeasonYear()`:**
On Jan 15, 2025 (mid-NBA-season), what should this function return for basketball?
- ESPN needs `2025` (end year)
- Yahoo needs `2024` (start year)
- The function currently has no `platform` parameter, so it can only return one value

**In the database unique constraint:**
The current key is `(user, league_id, sport, season_year)`. If someone had the same NBA league on both platforms (hypothetically), they'd be stored with different season_year values, making it impossible to correlate them.

## Current State of the Code

### How `seasonYear` flows through the system

**ESPN:**
```
ESPN Fan API → entry.seasonId
  → discoverLeaguesV3() renames to seasonYear
  → storage.addLeague() → espn_leagues.season_year
  → getLeagues() → /api/espn/leagues → useLeaguesStore → ChatLeague.seasonYear
```

**Yahoo:**
```
Yahoo API → game[0].season
  → parseYahooLeaguesResponse() parses to seasonYear
  → storage.upsertYahooLeague() → yahoo_leagues.season_year
  → getYahooLeagues() → /api/connect/yahoo/leagues → useLeaguesStore → ChatLeague.seasonYear
```

Neither flow transforms the value — both store exactly what the platform returns. This is correct for round-tripping back to the same platform's API.

### Recent fix (2026-02-04): `getDefaultSeasonYear()` in league context

The league context builder (`league-context.ts`) was using the stored `seasonYear` from the client store, which could be stale if a season rolled over after discovery. The fix uses `getDefaultSeasonYear(sport)` to compute the current season dynamically for the LLM prompt:

```ts
const hasSeason = sport === 'baseball' || sport === 'football';
const seasonYear = hasSeason
  ? getDefaultSeasonYear(sport)
  : (activeLeague.seasonYear || new Date().getFullYear());
```

**This fix is safe but incomplete.** It only handles baseball and football (where the platforms agree). For basketball and hockey, it falls through to the stored value, which means:
- It would work correctly for whichever platform the league belongs to (round-trip is preserved)
- But it wouldn't address the display/comparison inconsistency across platforms

### Database schema

```sql
-- ESPN: season_year is nullable (legacy rows may be NULL)
CREATE UNIQUE INDEX idx_espn_leagues_user_league_sport_season_unique
ON espn_leagues (clerk_user_id, league_id, sport, COALESCE(season_year, -1));

-- Yahoo: season_year is NOT NULL
CONSTRAINT yahoo_leagues_unique_user_league_season
  UNIQUE (clerk_user_id, league_key, season_year)
```

Both platforms use `season_year` as part of the unique constraint, allowing the same league to exist in multiple rows for different seasons (e.g., historical season discovery).

## Three Concerns to Untangle

The `season_year` integer is overloaded — it serves three different purposes that have different requirements:

### 1. API value (what to send back to the platform)

This must match what the platform expects. ESPN NBA needs `2025`, Yahoo NBA needs `2024`. **There is no choice here** — you must store or derive the platform-native value.

### 2. Display value (what to show users and the LLM)

This should be human-understandable. For cross-year sports, `"2024-25"` is clearer than either `2024` or `2025` alone. But the current schema only stores one integer.

### 3. Identity value (what makes a season "the same season")

For grouping, comparison, and deduplication, you need a platform-independent identifier. The start year is a natural choice (it's when the season begins), but it requires knowing the sport's convention to normalize.

## Design Options

### Option A: Platform-opaque — make rollover logic platform-aware

Keep storing whatever the platform returns. Extend `getDefaultSeasonYear()` to accept `platform`:

```ts
function getDefaultSeasonYear(sport: SeasonSport, platform: Platform): number {
  if (sport === 'basketball' || sport === 'hockey') {
    const startYear = getStartYearForCrossYearSport(sport);
    return platform === 'ESPN' ? startYear + 1 : startYear;
  }
  return getSingleYearSeason(sport); // baseball, football
}
```

**Pros:** Minimal change. No migration. API round-trip always correct.
**Cons:** Can't compare across platforms. Display shows different years for same season. Every consumer of `seasonYear` must know the platform to interpret it. Complexity spreads through the codebase.

### Option B: Normalize to start year — translate at the API boundary

Store the **start year** for all sports. Translate to/from the platform-native value at the edges:

```
Discovery:  ESPN NBA returns 2025 → subtract 1 → store 2024
            Yahoo NBA returns 2024 → store as-is → store 2024
API calls:  ESPN NBA reads 2024 → add 1 → send 2025
            Yahoo NBA reads 2024 → send as-is → send 2024
```

For baseball and football, no translation needed (platforms already use start year, which matches the natural single year).

```ts
// At discovery (write)
function toCanonicalYear(platformYear: number, sport: Sport, platform: Platform): number {
  if ((sport === 'basketball' || sport === 'hockey') && platform === 'ESPN') {
    return platformYear - 1; // ESPN end-year → start-year
  }
  return platformYear;
}

// At API call (read)
function toPlatformYear(canonicalYear: number, sport: Sport, platform: Platform): number {
  if ((sport === 'basketball' || sport === 'hockey') && platform === 'ESPN') {
    return canonicalYear + 1; // start-year → ESPN end-year
  }
  return canonicalYear;
}
```

**Pros:** Single source of truth. Cross-platform comparison works. Display is consistent. `getDefaultSeasonYear()` only needs sport, not platform. Translation logic is simple (+1 / -1) and isolated to two functions.
**Cons:** Translation at edges means bugs if you forget. Must know which sports are cross-year. No migration needed (no basketball/hockey data exists yet), but future ESPN basketball/hockey discovery must go through the translation.

### Option C: Store both — platform-native value + display label

Add a `season_label` column for display. Keep `season_year` as the platform-native API value.

```sql
ALTER TABLE espn_leagues ADD COLUMN season_label TEXT;
ALTER TABLE yahoo_leagues ADD COLUMN season_label TEXT;
-- ESPN NBA: season_year=2025, season_label="2024-25"
-- Yahoo NBA: season_year=2024, season_label="2024-25"
-- ESPN MLB: season_year=2025, season_label="2025"
```

**Pros:** API round-trip preserved. Display is always clear and consistent.
**Cons:** Two columns to maintain. Must generate label at discovery. Doesn't solve comparison/grouping (ESPN `season_year: 2025` and Yahoo `season_year: 2024` still look different). Partial solution.

### Option D: Season entity table

Create a reference table mapping platform-specific IDs to canonical seasons:

```sql
CREATE TABLE seasons (
  id SERIAL PRIMARY KEY,
  sport TEXT NOT NULL,
  canonical_label TEXT NOT NULL,  -- "2024-25" or "2025"
  start_date DATE,
  end_date DATE,
  espn_season_id INTEGER,
  yahoo_season_id INTEGER
);
```

Leagues reference `season_id` FK instead of storing a bare integer.

**Pros:** Most robust. All three concerns cleanly separated.
**Cons:** Heaviest change. Must populate reference data. Over-engineering for current scale.

## Recommendation

TBD — needs further discussion. Key questions to decide:

1. **How soon is basketball/hockey support coming?** This determines urgency.
2. **Do we need cross-platform season comparison?** If a user has ESPN NBA and Yahoo NBA for the same season, does any part of the app need to know they're the same season? (League grouping in UI? LLM context? Historical analysis?)
3. **How much complexity is acceptable?** Option B is the best balance of correctness and simplicity, but the +1/-1 translation is a footgun if someone forgets it.

## References

- [ESPN Fantasy API (espn-api)](https://github.com/cwendt94/espn-api) — uses end year for NBA/NHL
- [Yahoo Fantasy Sports API Guide](https://developer.yahoo.com/fantasysports/guide/) — uses start year for all sports
- [Sleeper API](https://docs.sleeper.com/) — uses end year
- [SportsDataIO Season Parameters](https://support.sportsdata.io/hc/en-us/articles/15196612633623-Process-Guide-Season-Types-and-Parameters) — uses start year + type suffix
- [NHL API Reference](https://github.com/Zmalski/NHL-API-Reference) — concatenates both years
- [YFPY (Yahoo Fantasy Python)](https://github.com/uberfastman/yfpy) — passes through Yahoo's start year
