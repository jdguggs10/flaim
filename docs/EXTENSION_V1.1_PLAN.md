# Chrome Extension v1.1 - Auto-Discovery Plan

## Implementation Status: COMPLETE

All phases implemented on 2026-01-06.

> **Note:** See `EXTENSION_V1.1.1_PLAN.md` for improved discovery messaging (granular counts for leagues + past seasons).

### Files Modified

**Backend (auth-worker):**
- `workers/auth-worker/src/index.ts` - Added `/extension/discover` and `/extension/set-default` routes
- `workers/auth-worker/src/v3/league-discovery.ts` - Added `discoverAndSaveLeagues()`, `discoverHistoricalSeasons()`
- `workers/auth-worker/src/supabase-storage.ts` - Added `leagueExists()`, `getCurrentSeasonLeagues()`

**Web Proxy:**
- `web/app/api/extension/discover/route.ts` - New proxy route
- `web/app/api/extension/set-default/route.ts` - New proxy route

**Extension:**
- `extension/src/lib/api.ts` - Added `discoverLeagues()`, `setDefaultLeague()`
- `extension/src/lib/storage.ts` - Added setup state persistence with `SetupState`
- `extension/src/popup/Popup.tsx` - New setup flow UI with progress, default selection
- `extension/src/popup/popup.css` - Progress UI styles, dropdown, league list
- `extension/manifest.json` - Bumped version to 1.1.0

**Documentation:**
- `extension/README.md` - Updated with v1.1 flow
- `docs/changelog.md` - Added v1.1 entry

### Implementation Notes

1. **Historical discovery is synchronous** (not fire-and-forget) - awaits completion, returns accurate count
2. **Per-league try/catch** - one ESPN failure doesn't kill the whole request
3. **Anchor history to league's seasonYear** - not `new Date().getFullYear()`
4. **Default dropdown: current season only** - uses `currentSeasonLeagues` from response
5. **Error shape: `{ error, error_description }`** - matches existing patterns
6. **No throttling for now** - every sync triggers discovery

### Testing Checklist

- [ ] Fresh user: discovers all leagues + history, picks default, sees leagues page
- [ ] Existing user: skips duplicates, shows "N existing"
- [ ] Popup close/reopen: state restored correctly
- [ ] No current-season leagues: shows friendly message with manual link
- [ ] Invalid credentials: shows error with `{ error, error_description }`, allows retry
- [ ] One league fails ESPN call: other leagues still saved, historical count accurate

### Post-Implementation Audit Fixes (2026-01-06)

After code review, the following issues were identified and fixed:

| # | Issue | Fix | Files |
|---|-------|-----|-------|
| 1 | Discovery used `new Date().getFullYear()` instead of sport-specific rollover | Created `season-utils.ts` with `getDefaultSeasonYear(sport)` using America/New_York timezone rollover rules | `workers/auth-worker/src/season-utils.ts` (new), `workers/auth-worker/src/v3/league-discovery.ts` |
| 3 | `getCurrentSeasonLeagues` used year heuristic instead of sport-specific logic | Updated to use `isCurrentSeason(sport, seasonYear)` | `workers/auth-worker/src/supabase-storage.ts` |
| 4 | "No leagues found" threw error instead of returning empty success | Added catch for `AutomaticLeagueDiscoveryFailed` in `/extension/discover` - returns 200 with empty arrays | `workers/auth-worker/src/index.ts` |
| 5 | Popup restore didn't preselect default league | Added preselection logic when restoring `selecting_default` state | `extension/src/popup/Popup.tsx` |

**Season Rollover Rules** (from `season-utils.ts`):
- Baseball: defaults to previous year until Feb 1
- Football: defaults to previous year until Jun 1
- Basketball: defaults to previous year until Oct 1
- Hockey: defaults to previous year until Oct 1

### Additional Audit Fixes (2026-01-06)

| # | Issue | Fix | Files |
|---|-------|-----|-------|
| 6 | `getLeagueInfo` hardcoded to `ffl` (football) - non-football leagues silently dropped | Added `gameId` parameter to `getLeagueInfo()` and `getLeagueInfoSafe()`, updated all callers to pass the league's gameId | `workers/auth-worker/src/v3/get-league-info.ts`, `workers/auth-worker/src/v3/league-discovery.ts` |
| 7 | "No leagues found" message unclear in popup | Updated `success` state to show "No active leagues found for this season" with "Add Leagues" CTA when discovery returns empty | `extension/src/popup/Popup.tsx` |

### Additional Audit Fixes (2026-01-07)

| # | Issue | Fix | Files |
|---|-------|-----|-------|
| 8 | "No leagues found" returned empty dropdown even if user already had saved leagues | On `AutomaticLeagueDiscoveryFailed`, return current-season leagues from storage for default selection | `workers/auth-worker/src/index.ts` |
| 9 | `getLeagueInfo` sport mapping could default to football for non-football games | Prefer passed `gameId` when mapping to sport | `workers/auth-worker/src/v3/get-league-info.ts` |
| 10 | Historical seasons saved without membership validation | Added `getLeagueTeams()` helper (with 7s timeout) and only add historical seasons when user's `teamId` exists | `workers/auth-worker/src/v3/get-league-teams.ts`, `workers/auth-worker/src/v3/league-discovery.ts` |
| 11 | Missing tests for historical membership validation | Added test suite for `getLeagueTeams` and teamId validation logic | `workers/auth-worker/src/__tests__/get-league-teams.test.ts` |

### Previously Deferred Issue (Resolved 2026-01-07)

| # | Issue | Status | Reason |
|---|-------|--------|--------|
| 2 | Historical seasons saved without membership validation | Resolved | Added teamId-based membership validation per historical season via ESPN `mStandings` + `mTeam` fetch. |

### Potential To-Do (Testing)

- Add a unit test that exercises `discoverHistoricalSeasons` directly (mocking `getLeagueTeams` and `storage.addLeague`) to assert historical seasons are only added when `teamId` is present.

---

## Overview

Enhance the Chrome extension to automatically discover and save all of a user's ESPN fantasy leagues after syncing credentials. The extension will show a step-by-step progress UI, then redirect to the leagues page.

**Goal**: Zero manual entry. User pairs extension → syncs credentials → all leagues discovered and saved automatically.

## User Flow

### Current Flow (v1.0)
1. Generate pairing code at `/extension`
2. Enter code in extension popup
3. Click "Sync to Flaim"
4. Manually go to `/leagues`
5. Manually enter each league ID
6. Select team from dropdown
7. Repeat for each league

### New Flow (v1.1)
1. Generate pairing code at `/extension`
2. Enter code in extension popup
3. Extension shows progress:
   - Verifying credentials
   - Storing credentials
   - Discovering leagues
   - Saving leagues
4. Extension shows summary with league/team names
5. User selects a default league from dropdown
6. Click "View Leagues" → opens `/leagues` with everything populated

**Key behaviors**:
- Every sync triggers discovery (not just first time) - helps add new leagues/seasons
- All available historical seasons are discovered and saved (not shown in UI)
- User must pick a default league before completing setup

## UI Design

### Setup Progress State
```
┌─────────────────────────────────────┐
│ Flaim                    [Connected]│
├─────────────────────────────────────┤
│ Setting up your account...          │
│                                     │
│ ✓ Verifying ESPN credentials        │
│ ✓ Storing credentials               │
│ ● Discovering leagues...            │
│ ○ Saving leagues                    │
│ ○ Complete                          │
│                                     │
│ [━━━━━━━━━━━━━━━━━━━━━━━━━] 60%     │
└─────────────────────────────────────┘
```

### Completion State (Select Default)
```
┌─────────────────────────────────────┐
│ Flaim                    [Connected]│
├─────────────────────────────────────┤
│ ✓ Found 3 leagues!                  │
│                                     │
│  🏈 Fantasy Champions               │
│     Team: The Underdogs             │
│  ⚾ Baseball Buddies                │
│     Team: Diamond Kings             │
│  🏈 Dynasty League                  │
│     Team: Championship Chasers      │
│                                     │
│ Select your default league:         │
│ ┌─────────────────────────────────┐ │
│ │ 🏈 Fantasy Champions (2025)   ▼│ │
│ └─────────────────────────────────┘ │
│                                     │
│ [Finish Setup]                      │
└─────────────────────────────────────┘
```

### After Default Selected
```
┌─────────────────────────────────────┐
│ Flaim                    [Connected]│
├─────────────────────────────────────┤
│ ✓ You're all set!                   │
│                                     │
│ Default: 🏈 Fantasy Champions       │
│          The Underdogs (2025)       │
│                                     │
│ 3 leagues saved (+ history)         │
│                                     │
│ [View Leagues]           [Done]     │
└─────────────────────────────────────┘
```

### Partial Success State (Existing Leagues)
```
┌─────────────────────────────────────┐
│ Flaim                    [Connected]│
├─────────────────────────────────────┤
│ ✓ Found 2 new leagues!              │
│   (1 already saved)                 │
│                                     │
│  🏈 Fantasy Champions               │
│     Team: The Underdogs             │
│  ⚾ Baseball Buddies                │
│     Team: Diamond Kings             │
│                                     │
│ Select your default league:         │
│ ┌─────────────────────────────────┐ │
│ │ 🏈 Fantasy Champions (2025)   ▼│ │
│ └─────────────────────────────────┘ │
│                                     │
│ [Finish Setup]                      │
└─────────────────────────────────────┘
```

Note: The dropdown includes ALL leagues (new + existing) so user can pick any as default.

### No Leagues Found State
```
┌─────────────────────────────────────┐
│ Flaim                    [Connected]│
├─────────────────────────────────────┤
│ ✓ Credentials saved!                │
│                                     │
│ No active leagues found for this    │
│ season. You can add leagues         │
│ manually on the leagues page.       │
│                                     │
│ [Add Leagues]            [Done]     │
└─────────────────────────────────────┘
```

## Technical Implementation

### Phase 1: Backend - Discovery Endpoint

#### New Endpoint: `POST /extension/discover`

**Location**: `workers/auth-worker/src/index.ts`

**Auth**: Extension bearer token (same as `/extension/sync`)

**Request**: No body needed (uses stored credentials)

**Response**:
```typescript
interface DiscoverResponse {
  success: boolean;
  error?: string;

  // Newly discovered leagues (current season only, for UI display)
  discovered: Array<{
    sport: 'football' | 'baseball' | 'basketball' | 'hockey';
    leagueId: string;
    leagueName: string;
    teamId: string;
    teamName: string;
    seasonYear: number;
  }>;

  // ALL user's leagues (for default selection dropdown)
  // Includes both new and existing leagues
  allLeagues: Array<{
    sport: 'football' | 'baseball' | 'basketball' | 'hockey';
    leagueId: string;
    leagueName: string;
    teamId: string;
    teamName: string;
    seasonYear: number;
    isDefault: boolean;
  }>;

  // Counts
  added: number;      // New leagues saved
  skipped: number;    // Already existed
  historical: number; // Historical seasons added (not shown in UI)
}
```

**Implementation Steps**:

1. Validate extension token → get `userId`
2. Fetch stored credentials from `espn_credentials` table
3. Call `discoverLeaguesV3()` for current season
4. For each discovered league:
   a. Check if already exists in `espn_leagues`
   b. If new, save with team info
   c. Trigger historical season discovery
5. Fetch ALL user's leagues (for default dropdown)
6. Return discovered leagues + all leagues for UI

#### New Endpoint: `POST /extension/set-default`

**Location**: `workers/auth-worker/src/index.ts`

**Auth**: Extension bearer token

**Request**:
```typescript
interface SetDefaultRequest {
  leagueId: string;
  sport: string;
  seasonYear: number;
}
```

**Response**:
```typescript
interface SetDefaultResponse {
  success: boolean;
  error?: string;
}
```

**Implementation**: Reuse existing default-setting logic from `/leagues/default` endpoint.

#### Modify: `discoverLeaguesV3()`

**Location**: `workers/auth-worker/src/v3/league-discovery.ts`

Current function already returns league + team info. No changes needed to core logic.

#### New Function: `discoverAndSaveLeagues()`

**Location**: `workers/auth-worker/src/v3/league-discovery.ts`

```typescript
interface DiscoverAndSaveResult {
  discovered: GambitLeague[];  // Current season leagues for UI
  added: number;
  skipped: number;
  historical: number;
}

export async function discoverAndSaveLeagues(
  userId: string,
  swid: string,
  s2: string,
  storage: EspnSupabaseStorage
): Promise<DiscoverAndSaveResult> {
  // 1. Discover current season leagues
  const leagues = await discoverLeaguesV3(swid, s2);

  // 2. Save each league (skip if exists)
  let added = 0;
  let skipped = 0;

  for (const league of leagues) {
    const exists = await storage.leagueExists(userId, league.gameId, league.leagueId, league.seasonId);
    if (exists) {
      skipped++;
      continue;
    }

    await storage.addLeague(userId, {
      leagueId: league.leagueId,
      sport: gameIdToSport(league.gameId),
      leagueName: league.leagueName,
      teamId: String(league.teamId),
      teamName: league.teamName,
      seasonYear: league.seasonId,
    });
    added++;
  }

  // 3. Discover historical seasons (don't await - fire and forget)
  const historical = await discoverHistoricalSeasons(userId, leagues, swid, s2, storage);

  return { discovered: leagues, added, skipped, historical };
}
```

#### New Function: `discoverHistoricalSeasons()`

**Location**: `workers/auth-worker/src/v3/league-discovery.ts`

```typescript
async function discoverHistoricalSeasons(
  userId: string,
  currentLeagues: GambitLeague[],
  swid: string,
  s2: string,
  storage: EspnSupabaseStorage
): Promise<number> {
  let historicalAdded = 0;
  const currentYear = new Date().getFullYear();

  for (const league of currentLeagues) {
    // Query ESPN for previous seasons (status.previousSeasons)
    try {
      const leagueInfo = await getLeagueInfo(swid, s2, league.leagueId, currentYear);
      const previousSeasons = leagueInfo?.status?.previousSeasons || [];

      for (const year of previousSeasons) {
        // Skip if already exists
        const exists = await storage.leagueExists(userId, league.gameId, league.leagueId, year);
        if (exists) continue;

        // Get team info for historical season
        const historicalInfo = await getLeagueInfo(swid, s2, league.leagueId, year);
        if (!historicalInfo) continue;

        // Find user's team in historical season
        const userTeam = historicalInfo.teams.find(t =>
          t.teamId === String(league.teamId) || t.teamName === league.teamName
        );

        if (userTeam) {
          await storage.addLeague(userId, {
            leagueId: league.leagueId,
            sport: gameIdToSport(league.gameId),
            leagueName: historicalInfo.leagueName,
            teamId: userTeam.teamId,
            teamName: userTeam.teamName,
            seasonYear: year,
          });
          historicalAdded++;
        }
      }
    } catch (err) {
      console.error(`Failed to discover history for league ${league.leagueId}:`, err);
      // Continue with next league
    }
  }

  return historicalAdded;
}
```

### Phase 2: Web API Proxy

#### New Route: `POST /api/extension/discover`

**Location**: `web/app/api/extension/discover/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'unauthorized', error_description: 'Bearer token required' },
      { status: 401 }
    );
  }

  const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL || 'https://api.flaim.app/auth';

  const response = await fetch(`${authWorkerUrl}/extension/discover`, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
  });

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
```

### Phase 3: Extension Changes

#### Update: `src/lib/api.ts`

Add new API function:

```typescript
export interface DiscoverResponse {
  success: boolean;
  error?: string;
  discovered: Array<{
    sport: string;
    leagueId: string;
    leagueName: string;
    teamId: string;
    teamName: string;
    seasonYear: number;
  }>;
  added: number;
  skipped: number;
  historical: number;
}

/**
 * Discover and save all user leagues
 */
export async function discoverLeagues(token: string): Promise<DiscoverResponse> {
  const apiBase = await detectApiBase();
  const response = await fetch(`${apiBase}/discover`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const error = await response.json() as ApiError;
    throw new Error(error.error_description || error.error || 'Discovery failed');
  }

  return response.json() as Promise<DiscoverResponse>;
}

export interface SetDefaultRequest {
  leagueId: string;
  sport: string;
  seasonYear: number;
}

/**
 * Set a league as the user's default
 */
export async function setDefaultLeague(
  token: string,
  league: SetDefaultRequest
): Promise<{ success: boolean }> {
  const apiBase = await detectApiBase();
  const response = await fetch(`${apiBase}/set-default`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(league),
  });

  if (!response.ok) {
    const error = await response.json() as ApiError;
    throw new Error(error.error_description || error.error || 'Failed to set default');
  }

  return response.json() as Promise<{ success: boolean }>;
}
```

#### Update: `src/lib/storage.ts`

Add setup state persistence:

```typescript
const SETUP_STATE_KEY = 'flaim_setup_state';

export interface LeagueOption {
  sport: string;
  leagueId: string;
  leagueName: string;
  teamName: string;
  seasonYear: number;
  isDefault: boolean;
}

export interface SetupState {
  step: 'idle' | 'syncing' | 'discovering' | 'selecting_default' | 'complete' | 'error';
  error?: string;
  discovered?: Array<{
    sport: string;
    leagueName: string;
    teamName: string;
  }>;
  allLeagues?: LeagueOption[];  // For default selection dropdown
  added?: number;
  skipped?: number;
}

export async function getSetupState(): Promise<SetupState | null> {
  const result = await chrome.storage.local.get(SETUP_STATE_KEY);
  return result[SETUP_STATE_KEY] || null;
}

export async function setSetupState(state: SetupState): Promise<void> {
  await chrome.storage.local.set({ [SETUP_STATE_KEY]: state });
}

export async function clearSetupState(): Promise<void> {
  await chrome.storage.local.remove(SETUP_STATE_KEY);
}
```

#### Update: `src/popup/Popup.tsx`

Major refactor to add setup flow state machine:

```typescript
type State =
  | 'loading'
  | 'not_paired'
  | 'entering_code'
  | 'paired_no_espn'
  // New setup flow states
  | 'setup_syncing'
  | 'setup_discovering'
  | 'setup_selecting_default'  // User picks default league
  | 'setup_complete'
  | 'setup_error'
  // Existing states
  | 'ready'
  | 'syncing'
  | 'success'
  | 'error';

interface SetupResult {
  discovered: Array<{
    sport: string;
    leagueName: string;
    teamName: string;
  }>;
  allLeagues: Array<{
    sport: string;
    leagueId: string;
    leagueName: string;
    teamName: string;
    seasonYear: number;
    isDefault: boolean;
  }>;
  added: number;
  skipped: number;
}
```

**Key UI Components to Add**:

1. `SetupProgress` - Shows step-by-step progress with checkmarks
2. `SetupSelectDefault` - Shows discovered leagues + dropdown to pick default
3. `SetupComplete` - Shows confirmation with selected default league
4. `SetupError` - Shows error with retry option

**Flow Logic**:

```typescript
// After successful pairing OR when user clicks "Sync to Flaim"
const handleFullSetup = async () => {
  const token = await getToken();
  if (!token) return;

  const espnCreds = await getEspnCredentials();
  if (!espnCreds || !validateCredentials(espnCreds)) {
    setState('paired_no_espn');
    return;
  }

  // Step 1: Sync credentials
  setState('setup_syncing');
  await setSetupState({ step: 'syncing' });

  try {
    await syncCredentials(token, espnCreds);
  } catch (err) {
    setState('setup_error');
    setError('Failed to sync credentials');
    await setSetupState({ step: 'error', error: 'Failed to sync credentials' });
    return;
  }

  // Step 2: Discover leagues
  setState('setup_discovering');
  await setSetupState({ step: 'discovering' });

  try {
    const result = await discoverLeagues(token);

    // Store result for UI
    setSetupResult({
      discovered: result.discovered.map(l => ({
        sport: l.sport,
        leagueName: l.leagueName,
        teamName: l.teamName,
      })),
      allLeagues: result.allLeagues,
      added: result.added,
      skipped: result.skipped,
    });

    // Step 3: User selects default league
    setState('setup_selecting_default');
    await setSetupState({
      step: 'selecting_default',
      discovered: result.discovered.map(l => ({
        sport: l.sport,
        leagueName: l.leagueName,
        teamName: l.teamName,
      })),
      allLeagues: result.allLeagues,
      added: result.added,
      skipped: result.skipped,
    });

  } catch (err) {
    setState('setup_error');
    setError(err instanceof Error ? err.message : 'Discovery failed');
    await setSetupState({ step: 'error', error: 'Discovery failed' });
  }
};

// Called when user selects default and clicks "Finish Setup"
const handleFinishSetup = async (selectedLeague: LeagueOption) => {
  const token = await getToken();
  if (!token) return;

  try {
    await setDefaultLeague(token, {
      leagueId: selectedLeague.leagueId,
      sport: selectedLeague.sport,
      seasonYear: selectedLeague.seasonYear,
    });

    setState('setup_complete');
    await setSetupState({ step: 'complete' });

  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to set default');
    // Stay on selecting_default state so user can retry
  }
};
```

**Popup Close Recovery**:

On extension popup open, check for in-progress or complete setup state:

```typescript
useEffect(() => {
  const init = async () => {
    // Check for saved setup state first
    const setupState = await getSetupState();

    if (setupState?.step === 'complete') {
      // User finished setup - go to normal ready state
      await clearSetupState();
      setState('ready');
      return;
    }

    if (setupState?.step === 'selecting_default') {
      // User was selecting default - restore that state
      setSetupResult({
        discovered: setupState.discovered || [],
        allLeagues: setupState.allLeagues || [],
        added: setupState.added || 0,
        skipped: setupState.skipped || 0,
      });
      setState('setup_selecting_default');
      return;
    }

    if (setupState?.step === 'error') {
      setError(setupState.error || 'Setup failed');
      setState('setup_error');
      return;
    }

    if (setupState?.step === 'syncing' || setupState?.step === 'discovering') {
      // Process was interrupted - restart from beginning
      await clearSetupState();
      // Fall through to normal init
    }

    // Continue with normal init...
  };

  init();
}, []);
```

#### Update: `src/popup/popup.css`

Add styles for progress UI:

```css
.setup-progress {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.setup-step {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.setup-step.completed {
  color: #16a34a;
}

.setup-step.active {
  color: #1e40af;
  font-weight: 500;
}

.setup-step.pending {
  color: #9ca3af;
}

.step-icon {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.step-icon.check {
  color: #16a34a;
}

.progress-bar {
  height: 4px;
  background: #e5e7eb;
  border-radius: 2px;
  overflow: hidden;
  margin-top: 8px;
}

.progress-bar-fill {
  height: 100%;
  background: #3b82f6;
  transition: width 0.3s ease;
}

.league-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 12px 0;
}

.league-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  background: #f9fafb;
  border-radius: 6px;
}

.league-item .sport-emoji {
  font-size: 16px;
}

.league-item .league-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.league-item .league-name {
  font-weight: 500;
  font-size: 13px;
}

.league-item .team-name {
  font-size: 12px;
  color: #6b7280;
}
```

### Phase 4: Update manifest.json

No changes needed - existing permissions cover the new endpoint.

## Database Considerations

### Existing Constraint

The `espn_leagues` table already has a unique constraint on `(clerk_user_id, sport, league_id, season_year)`. This ensures:
- No duplicate leagues per user
- Historical seasons stored separately
- Discovery can safely skip existing entries

### Storage Method

Add helper method to `EspnSupabaseStorage`:

```typescript
async leagueExists(
  userId: string,
  gameId: string,
  leagueId: string,
  seasonYear: number
): Promise<boolean> {
  const sport = gameIdToSport(gameId);
  const { data } = await this.client
    .from('espn_leagues')
    .select('id')
    .eq('clerk_user_id', userId)
    .eq('sport', sport)
    .eq('league_id', leagueId)
    .eq('season_year', seasonYear)
    .single();

  return !!data;
}
```

## Edge Cases

### 1. Popup Closes During Setup

**Handling**: State is persisted to `chrome.storage.local`. When popup reopens:
- If `step === 'syncing'` or `step === 'discovering'`: Show "Setup in progress..." and re-check status
- If `step === 'complete'`: Show completion UI
- If `step === 'error'`: Show error with retry option

### 2. User Has Existing Leagues

**Handling**: Discovery skips existing leagues. UI shows:
- "Added 2 new leagues (3 existing)"
- Only new leagues shown in the list

### 3. No Leagues Found

**Handling**: Show friendly message with link to manual entry:
- "No active leagues found for this season"
- [Add Leagues Manually] button

### 4. ESPN Authentication Fails

**Handling**:
- Clear stored credentials
- Show error: "ESPN credentials expired. Please log into ESPN and try again."
- [Retry] button

### 5. Partial Discovery Failure

**Handling**: If some sports succeed and others fail:
- Save successful leagues
- Show what was found
- Log errors for debugging

### 6. Rate Limiting from ESPN

**Handling**: Not a concern per user requirements, but code should:
- Use reasonable timeouts
- Continue on individual failures
- Complete what it can

## Testing Plan

### Manual Testing

1. **Fresh user flow**
   - New user pairs extension
   - Has 2 football leagues, 1 baseball league
   - Verify all 3 appear in completion UI
   - Verify all saved to database with team IDs
   - Verify historical seasons discovered

2. **Existing user flow**
   - User already has 1 league saved
   - Discovers 3 total leagues
   - Verify shows "Added 2 new leagues (1 existing)"
   - Verify no duplicates in database

3. **Popup close recovery**
   - Start setup, close popup mid-discovery
   - Reopen popup
   - Verify state restored or retryable

4. **No leagues found**
   - User has no ESPN fantasy leagues
   - Verify friendly empty state
   - Verify credentials still saved

5. **Expired credentials**
   - Use invalid ESPN cookies
   - Verify error shown
   - Verify retry works after fixing

### Automated Tests

1. `discoverAndSaveLeagues()` unit tests
2. Extension API mock tests
3. Storage state persistence tests

## Rollout Plan

1. **Phase 1**: Backend changes (auth-worker + web proxy)
   - Deploy to preview environment
   - Test with curl/Postman

2. **Phase 2**: Extension changes
   - Build with `NODE_ENV=development`
   - Load unpacked, test locally

3. **Phase 3**: Integration testing
   - Full flow testing with real ESPN accounts
   - Edge case testing

4. **Phase 4**: Production deployment
   - Deploy workers to prod
   - Build extension for CWS
   - Submit for review

## Files to Modify

### Backend
- `workers/auth-worker/src/index.ts` - Add `/extension/discover` and `/extension/set-default` routes
- `workers/auth-worker/src/v3/league-discovery.ts` - Add `discoverAndSaveLeagues()`, `discoverHistoricalSeasons()`
- `workers/auth-worker/src/supabase-storage.ts` - Add `leagueExists()`, `addLeague()`, `getAllLeagues()` helpers
- `web/app/api/extension/discover/route.ts` - New proxy route
- `web/app/api/extension/set-default/route.ts` - New proxy route

### Extension
- `extension/src/lib/api.ts` - Add `discoverLeagues()`, `setDefaultLeague()`
- `extension/src/lib/storage.ts` - Add setup state persistence with `allLeagues`
- `extension/src/popup/Popup.tsx` - New setup flow UI with default selection
- `extension/src/popup/popup.css` - Progress UI styles + dropdown styles
- `extension/manifest.json` - Bump version to 1.1.0

### Documentation
- `extension/README.md` - Update with v1.1 flow
- `docs/CHANGELOG.md` - Add v1.1 entry

## Decisions (Resolved)

1. **Default league**: User picks their default league from a dropdown at the end of the setup flow.
   - Shows all leagues (new + existing) in dropdown
   - User must select before completing setup

2. **Season discovery depth**: All available historical seasons are discovered and saved.
   - ESPN returns `previousSeasons` array - we fetch all of them
   - Historical seasons are saved but not shown in extension UI (keeps it clean)

3. **Re-discovery**: Every sync triggers discovery.
   - Helps users add new leagues they've joined
   - Helps add new seasons as they become available
   - Skips duplicates automatically

4. **Error retry**: Save what succeeded, show error for what failed, allow retry.
   - Partial success is still success
   - User can retry or continue to leagues page
