# Extension v1.1.1 - Comprehensive Discovery Messaging

## Problem Statement

The v1.1 discovery messaging is incomplete and confusing:

1. **Wrong count displayed** - Shows `discovered.length` (leagues found this run) instead of proper messaging
2. **No granularity** - User can't tell what was found vs what was new vs what was already saved
3. **Historical seasons incomplete** - We only track `added`, not `found` or `skipped`
4. **Ambiguous terminology** - "historical" could mean "previously saved" or "past seasons"

## Data Model Analysis

### Current API Response
```typescript
{
  discovered: DiscoveredLeague[];      // Current-season leagues found THIS run
  currentSeasonLeagues: CurrentSeasonLeague[];  // All saved current-season (from DB)
  added: number;       // Current-season leagues newly added
  skipped: number;     // Current-season leagues already saved
  historical: number;  // Past seasons added (NOT found or skipped)
}
```

### What We Need
```typescript
{
  // Current season leagues
  currentSeason: {
    found: number;      // Leagues discovered from ESPN API
    added: number;      // Newly saved to DB
    alreadySaved: number;  // Already existed in DB
  };
  // Past seasons (renamed from "historical" for clarity)
  pastSeasons: {
    found: number;      // Past seasons discovered WHERE USER WAS A MEMBER
    added: number;      // Newly saved to DB
    alreadySaved: number;  // Already existed in DB
  };
  // For UI display
  discovered: DiscoveredLeague[];           // All leagues found this run (for list)
  currentSeasonLeagues: CurrentSeasonLeague[];  // All saved current-season (for dropdown)
}
```

## Complete Permutation Matrix

### Terminology
- **Found** = discovered from ESPN API this sync (for past seasons: only where user was a member)
- **New/Added** = added to database (didn't exist before)
- **Already Saved** = existed in database, skipped

### All Scenarios

| # | Current Found | Current New | Current Saved | Past Found | Past New | Past Saved | Message |
|---|---------------|-------------|---------------|------------|----------|------------|---------|
| 1 | 0 | 0 | 0 | 0 | 0 | 0 | "No active leagues found for this season" |
| 2 | 3 | 3 | 0 | 0 | 0 | 0 | "Found 3 leagues" |
| 3 | 3 | 3 | 0 | 12 | 12 | 0 | "Found 3 leagues + 12 past seasons" |
| 4 | 3 | 0 | 3 | 0 | 0 | 0 | "3 leagues already saved" |
| 5 | 3 | 0 | 3 | 12 | 0 | 12 | "3 leagues + 12 past seasons already saved" |
| 6 | 3 | 1 | 2 | 12 | 4 | 8 | "Found 3 leagues (1 new, 2 saved) + 12 past seasons (4 new)" |
| 7 | 3 | 0 | 3 | 15 | 3 | 12 | "3 leagues already saved + 15 past seasons (3 new)" |
| 8 | 4 | 1 | 3 | 18 | 6 | 12 | "Found 4 leagues (1 new, 3 saved) + 18 past seasons (6 new)" |
| 9 | 0 | 0 | 0 | - | - | - | "No active leagues found" (+ link to manual add) |

### Edge Cases
- ESPN API fails mid-discovery: Show partial results + error
- User has DB leagues but ESPN returns 0: "0 leagues found" → goes to success state with manual add link
- Only past seasons are new: "3 leagues already saved + 3 new past seasons"
- User left a league: ESPN returns fewer than DB has → list shows ESPN results, dropdown shows DB

## Implementation

### Phase 1: Backend Changes

#### 1.1 Update `discoverHistoricalSeasons` return type and logic

**File:** `workers/auth-worker/src/v3/league-discovery.ts`

**IMPORTANT:** The `found` count should only include seasons where the user was actually a member.
The current code validates membership via `getLeagueTeams` - we must count AFTER that validation.

```typescript
interface HistoricalResult {
  found: number;        // Seasons where user was a member
  added: number;        // Successfully added to DB
  alreadySaved: number; // Already existed in DB
}

async function discoverHistoricalSeasons(
  userId: string,
  league: GambitLeague,
  swid: string,
  s2: string,
  storage: EspnSupabaseStorage
): Promise<HistoricalResult> {
  let found = 0;
  let added = 0;
  let alreadySaved = 0;

  const sport = gameIdToSport(league.gameId);
  if (!sport) return { found: 0, added: 0, alreadySaved: 0 };

  try {
    const leagueInfo = await getLeagueInfo(swid, s2, league.leagueId, league.seasonId, league.gameId);

    if (!leagueInfo?.status?.previousSeasons) {
      return { found: 0, added: 0, alreadySaved: 0 };
    }

    const previousSeasons = leagueInfo.status.previousSeasons;
    console.log(`Found ${previousSeasons.length} historical seasons for league ${league.leagueId}`);

    for (const year of previousSeasons) {
      try {
        // FIRST: Validate membership - only count if user was a member
        const teams = await getLeagueTeams(swid, s2, league.leagueId, year, league.gameId);
        const hasTeam = teams.some(t => t.teamId === String(league.teamId));

        if (!hasTeam) {
          // User wasn't in this season - don't count it
          continue;
        }

        // User was a member - now count it
        found++;

        // Check if already saved
        const exists = await storage.leagueExists(userId, sport, league.leagueId, year);
        if (exists) {
          alreadySaved++;
          continue;
        }

        // Get league info for historical season
        const historicalInfo = await getLeagueInfo(swid, s2, league.leagueId, year, league.gameId);
        if (!historicalInfo) {
          console.warn(`Could not get info for league ${league.leagueId} season ${year}`);
          continue;
        }

        // Add to DB
        const result = await storage.addLeague(userId, {
          leagueId: league.leagueId,
          sport: sport as 'football' | 'baseball' | 'basketball' | 'hockey',
          leagueName: historicalInfo.leagueName || league.leagueName,
          teamId: String(league.teamId),
          teamName: league.teamName,
          seasonYear: year,
        });

        if (result.success) {
          added++;
        } else if (result.code !== 'DUPLICATE') {
          console.error(`Failed to add historical season ${year} for league ${league.leagueId}:`, result.error);
        }

      } catch (seasonError) {
        console.error(`Error fetching season ${year} for league ${league.leagueId}:`, seasonError);
        continue;
      }
    }

  } catch (error) {
    console.error(`Failed to discover history for league ${league.leagueId}:`, error);
  }

  return { found, added, alreadySaved };
}
```

#### 1.2 Update `discoverAndSaveLeagues` return type

```typescript
export interface DiscoverAndSaveResult {
  discovered: DiscoveredLeague[];
  currentSeason: {
    found: number;
    added: number;
    alreadySaved: number;
  };
  pastSeasons: {
    found: number;
    added: number;
    alreadySaved: number;
  };
}

export async function discoverAndSaveLeagues(
  userId: string,
  swid: string,
  s2: string,
  storage: EspnSupabaseStorage
): Promise<DiscoverAndSaveResult> {
  const leagues = await discoverLeaguesV3(swid, s2);

  const discovered: DiscoveredLeague[] = [];
  const currentSeason = { found: 0, added: 0, alreadySaved: 0 };
  const pastSeasons = { found: 0, added: 0, alreadySaved: 0 };

  for (const league of leagues) {
    try {
      const sport = gameIdToSport(league.gameId);
      if (!sport) {
        console.warn(`Unknown gameId: ${league.gameId}`);
        continue;
      }

      currentSeason.found++;

      const exists = await storage.leagueExists(
        userId,
        sport,
        league.leagueId,
        league.seasonId
      );

      if (exists) {
        currentSeason.alreadySaved++;
      } else {
        const result = await storage.addLeague(userId, {
          leagueId: league.leagueId,
          sport: sport as 'football' | 'baseball' | 'basketball' | 'hockey',
          leagueName: league.leagueName,
          teamId: String(league.teamId),
          teamName: league.teamName,
          seasonYear: league.seasonId,
        });

        if (result.success) {
          currentSeason.added++;
        } else {
          console.error(`Failed to add league ${league.leagueId}:`, result.error);
        }
      }

      // Add to discovered list for UI
      discovered.push({
        sport: sport as 'football' | 'baseball' | 'basketball' | 'hockey',
        leagueId: league.leagueId,
        leagueName: league.leagueName,
        teamId: String(league.teamId),
        teamName: league.teamName,
        seasonYear: league.seasonId,
      });

      // Discover historical seasons
      const histResult = await discoverHistoricalSeasons(
        userId,
        league,
        swid,
        s2,
        storage
      );
      pastSeasons.found += histResult.found;
      pastSeasons.added += histResult.added;
      pastSeasons.alreadySaved += histResult.alreadySaved;

    } catch (error) {
      console.error(`Error processing league ${league.leagueId}:`, error);
      continue;
    }
  }

  return { discovered, currentSeason, pastSeasons };
}
```

#### 1.3 Update API response in `index.ts`

```typescript
// In the /extension/discover handler:
return new Response(JSON.stringify({
  discovered: result.discovered,
  currentSeasonLeagues: currentSeasonWithDefault,
  currentSeason: result.currentSeason,
  pastSeasons: result.pastSeasons,
  // Keep legacy fields for backwards compatibility
  added: result.currentSeason.added,
  skipped: result.currentSeason.alreadySaved,
  historical: result.pastSeasons.added,
}), {
  headers: { 'Content-Type': 'application/json', ...corsHeaders },
});
```

### Phase 2: Frontend Changes

#### 2.1 Update API types

**File:** `extension/src/lib/api.ts`

```typescript
export interface SeasonCounts {
  found: number;
  added: number;
  alreadySaved: number;
}

export interface DiscoverResponse {
  discovered: DiscoveredLeague[];
  currentSeasonLeagues: CurrentSeasonLeague[];
  currentSeason: SeasonCounts;
  pastSeasons: SeasonCounts;
  // Legacy fields (deprecated, kept for compatibility)
  added: number;
  skipped: number;
  historical: number;
}
```

#### 2.2 Update storage.ts interface

**File:** `extension/src/lib/storage.ts`

```typescript
export interface SeasonCounts {
  found: number;
  added: number;
  alreadySaved: number;
}

export interface SetupState {
  step: SetupStep;
  error?: string;
  discovered?: Array<{
    sport: string;
    leagueName: string;
    teamName: string;
  }>;
  currentSeasonLeagues?: LeagueOption[];
  // NEW: Replace old added/skipped/historical with structured counts
  currentSeason?: SeasonCounts;
  pastSeasons?: SeasonCounts;
  // Legacy (for migration, can remove in future)
  added?: number;
  skipped?: number;
  historical?: number;
}
```

#### 2.3 Update Popup.tsx state and messaging

**File:** `extension/src/popup/Popup.tsx`

**State changes:**
```typescript
// OLD:
const [setupCounts, setSetupCounts] = useState({ added: 0, skipped: 0, historical: 0 });

// NEW:
interface SeasonCounts {
  found: number;
  added: number;
  alreadySaved: number;
}

interface DiscoveryCounts {
  currentSeason: SeasonCounts;
  pastSeasons: SeasonCounts;
}

const [discoveryCounts, setDiscoveryCounts] = useState<DiscoveryCounts>({
  currentSeason: { found: 0, added: 0, alreadySaved: 0 },
  pastSeasons: { found: 0, added: 0, alreadySaved: 0 },
});
```

**Messaging functions:**
```typescript
function getDiscoveryMessage(counts: DiscoveryCounts): string {
  const { currentSeason: cs, pastSeasons: ps } = counts;

  // No leagues found at all
  if (cs.found === 0) {
    return 'No active leagues found for this season.';
  }

  const parts: string[] = [];

  // Current season leagues
  if (cs.added > 0 && cs.alreadySaved === 0) {
    // All new
    parts.push(`Found ${cs.found} league${cs.found !== 1 ? 's' : ''}`);
  } else if (cs.added === 0 && cs.alreadySaved > 0) {
    // All already saved
    parts.push(`${cs.found} league${cs.found !== 1 ? 's' : ''} already saved`);
  } else if (cs.added > 0 && cs.alreadySaved > 0) {
    // Mixed
    parts.push(`Found ${cs.found} league${cs.found !== 1 ? 's' : ''} (${cs.added} new, ${cs.alreadySaved} saved)`);
  }

  // Past seasons (only show if any found)
  if (ps.found > 0) {
    if (ps.added > 0 && ps.alreadySaved === 0) {
      // All new
      parts.push(`${ps.found} past season${ps.found !== 1 ? 's' : ''}`);
    } else if (ps.added === 0 && ps.alreadySaved > 0) {
      // All already saved
      parts.push(`${ps.found} past season${ps.found !== 1 ? 's' : ''} already saved`);
    } else if (ps.added > 0) {
      // Some new
      parts.push(`${ps.found} past season${ps.found !== 1 ? 's' : ''} (${ps.added} new)`);
    }
  }

  return parts.join(' + ');
}

function getCompletionSummary(counts: DiscoveryCounts): string {
  const { currentSeason: cs, pastSeasons: ps } = counts;
  const newItems = cs.added + ps.added;

  if (newItems === 0) {
    return 'Everything already saved!';
  }

  const parts: string[] = [];
  if (cs.added > 0) parts.push(`${cs.added} new league${cs.added !== 1 ? 's' : ''}`);
  if (ps.added > 0) parts.push(`${ps.added} new past season${ps.added !== 1 ? 's' : ''}`);

  return parts.join(' + ') + ' added';
}
```

**In handleFullSetup, after discovery:**
```typescript
// Store results
setDiscoveredLeagues(result.discovered);
setCurrentSeasonLeagues(result.currentSeasonLeagues);
setDiscoveryCounts({
  currentSeason: result.currentSeason,
  pastSeasons: result.pastSeasons,
});

// Save to storage for popup recovery
await setSetupState({
  step: 'selecting_default',
  discovered: result.discovered.map(d => ({
    sport: d.sport,
    leagueName: d.leagueName,
    teamName: d.teamName
  })),
  currentSeasonLeagues: result.currentSeasonLeagues,
  currentSeason: result.currentSeason,
  pastSeasons: result.pastSeasons,
});
```

**In setup_selecting_default render:**
```jsx
<div className="message success">
  {getDiscoveryMessage(discoveryCounts)}
</div>

{/* IMPORTANT: Use discoveredLeagues for the list (what ESPN returned this run) */}
{/* NOT currentSeasonLeagues (which is what's in DB) */}
<div className="league-list">
  {discoveredLeagues.map((league, i) => (
    <div key={i} className="league-item">
      <span className="sport-emoji">{sportEmoji[league.sport] || '🏆'}</span>
      <div className="league-info">
        <span className="league-name">{league.leagueName}</span>
        <span className="team-name">Team: {league.teamName}</span>
      </div>
    </div>
  ))}
</div>

{/* Use currentSeasonLeagues for the dropdown (all saved, for default selection) */}
<select ...>
  {currentSeasonLeagues.map((league) => (
    <option ...>{league.leagueName}</option>
  ))}
</select>
```

**In setup_complete render:**
```jsx
<div className="setup-summary">
  {getCompletionSummary(discoveryCounts)}
</div>
```

**In popup recovery (init useEffect):**
```typescript
} else if (savedSetup?.step === 'selecting_default') {
  const token = await getToken();
  if (token && savedSetup.currentSeasonLeagues && savedSetup.currentSeasonLeagues.length > 0) {
    setDiscoveredLeagues(savedSetup.discovered?.map(d => ({
      ...d,
      leagueId: '',
      teamId: '',
      seasonYear: 0
    })) || []);
    setCurrentSeasonLeagues(savedSetup.currentSeasonLeagues);

    // Restore counts - handle both new and legacy formats
    if (savedSetup.currentSeason && savedSetup.pastSeasons) {
      setDiscoveryCounts({
        currentSeason: savedSetup.currentSeason,
        pastSeasons: savedSetup.pastSeasons,
      });
    } else {
      // Legacy migration
      setDiscoveryCounts({
        currentSeason: {
          found: (savedSetup.added || 0) + (savedSetup.skipped || 0),
          added: savedSetup.added || 0,
          alreadySaved: savedSetup.skipped || 0,
        },
        pastSeasons: {
          found: savedSetup.historical || 0,
          added: savedSetup.historical || 0,
          alreadySaved: 0,
        },
      });
    }

    // Preselect default
    const leagues = savedSetup.currentSeasonLeagues;
    const defaultLeague = leagues.find(l => l.isDefault);
    const preselected = defaultLeague || leagues[0];
    setSelectedDefault(`${preselected.sport}|${preselected.leagueId}|${preselected.seasonYear}`);

    setState('setup_selecting_default');
    return;
  }
}
```

### Phase 3: Version & Docs

1. Bump `extension/manifest.json` version to `1.1.1`
2. Update `docs/CHANGELOG.md`

## Files to Modify

### Backend
- `workers/auth-worker/src/v3/league-discovery.ts` - Return structure, membership validation counting
- `workers/auth-worker/src/index.ts` - API response format

### Frontend
- `extension/src/lib/api.ts` - Types
- `extension/src/lib/storage.ts` - SetupState interface
- `extension/src/popup/Popup.tsx` - State, messaging functions, rendering
- `extension/manifest.json` - Version bump

### Docs
- `docs/CHANGELOG.md`

## Key Design Decisions

1. **`found` only counts member seasons** - For past seasons, we only count seasons where the user was actually a member (validated via getLeagueTeams). Seasons they weren't in are silently skipped.

2. **List shows `discovered`, dropdown shows `currentSeasonLeagues`** - The league list displays what ESPN returned this run. The default dropdown shows all saved leagues from DB. These can differ if user left a league.

3. **No "(all new)" suffix** - When everything is new, we just say "Found 3 leagues" without the redundant qualifier.

4. **Legacy field compatibility** - Keep `added`, `skipped`, `historical` in API response for any existing consumers.

## Example Messages

| Scenario | Message |
|----------|---------|
| First sync, 3 leagues, 12 past | "Found 3 leagues + 12 past seasons" |
| Re-sync, nothing new | "3 leagues already saved + 12 past seasons already saved" |
| Re-sync, 1 new league | "Found 3 leagues (1 new, 2 saved) + 12 past seasons" |
| Re-sync, only new past seasons | "3 leagues already saved + 15 past seasons (3 new)" |
| First sync, no past seasons | "Found 3 leagues" |
| No leagues at all | "No active leagues found for this season" |

## Completion Summary Examples

| Scenario | Summary |
|----------|---------|
| All new | "3 new leagues + 12 new past seasons added" |
| Nothing new | "Everything already saved!" |
| Mixed | "1 new league + 5 new past seasons added" |
| Only leagues new | "2 new leagues added" |
| Only past seasons new | "4 new past seasons added" |

## Testing Checklist

- [ ] Fresh user: correct "Found N leagues" messaging
- [ ] Re-sync immediately: correct "N leagues already saved" messaging
- [ ] New league added elsewhere, re-sync: shows "(X new, Y saved)"
- [ ] New season becomes available, re-sync: shows "N past seasons (X new)"
- [ ] Popup close/reopen: state restored with correct counts
- [ ] No leagues: friendly message with manual add link
- [ ] API backwards compatibility: legacy fields still present
- [ ] List shows discovered leagues (ESPN results), dropdown shows saved leagues (DB)
- [ ] Past seasons only count where user was a member
