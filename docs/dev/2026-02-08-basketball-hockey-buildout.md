# Basketball & Hockey Buildout — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add basketball and hockey support to both ESPN and Yahoo clients, bringing Flaim from 2-sport to 4-sport coverage.

**Architecture:** The gateway, types, season logic, database schema, and onboarding game IDs already support basketball/hockey. The work is: copy the handler pattern from football/baseball, fill in sport-specific mappings, and wire up the routers.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, Vitest, ESPN Fantasy API v3, Yahoo Fantasy API v2

**Constraints:** No live league credentials available for basketball/hockey. All ESPN mappings sourced from `cwendt94/espn-api` Python library and marked as unverified. Yahoo uses human-readable position strings so no numeric ID research needed.

---

## Task 1: ESPN Basketball Mappings

**Files:**
- Create: `workers/espn-client/src/sports/basketball/mappings.ts`
- Create: `workers/espn-client/src/sports/basketball/MAPPINGS.md`

**Step 1: Create the mappings file**

```typescript
// workers/espn-client/src/sports/basketball/mappings.ts

/**
 * Basketball data transforms for ESPN API responses
 * Maps ESPN's numeric IDs to human-readable names
 *
 * Source: cwendt94/espn-api constant.py (basketball)
 * Verified: NOT YET — no live league credentials available
 */

// =============================================================================
// SINGLE ID SPACE — Basketball uses the same IDs for both defaultPositionId
// and lineupSlotId/eligibleSlots (unlike baseball which has two separate spaces).
// =============================================================================

// Position IDs to position names
// Used for both defaultPositionId and lineupSlotId/eligibleSlots
export const POSITION_MAP: Record<number, string> = {
  0: 'PG',     // Point Guard
  1: 'SG',     // Shooting Guard
  2: 'SF',     // Small Forward
  3: 'PF',     // Power Forward
  4: 'C',      // Center
  5: 'G',      // Guard (PG/SG flex)
  6: 'F',      // Forward (SF/PF flex)
  7: 'SG/SF',  // Swing (SG/SF)
  8: 'G/F',    // Guard/Forward
  9: 'PF/C',   // Power Forward/Center
  10: 'F/C',   // Forward/Center
  11: 'UTIL',  // Utility (any position)
  12: 'Bench', // Bench
  13: 'IR',    // Injured Reserve
};

// Alias for consistency with football/baseball handler imports
export const LINEUP_SLOT_MAP = POSITION_MAP;

// Pro team IDs to team abbreviations (NBA teams)
// Source: cwendt94/espn-api constant.py
export const PRO_TEAM_MAP: Record<number, string> = {
  0: 'FA',    // Free Agent
  1: 'ATL',   // Atlanta Hawks
  2: 'BOS',   // Boston Celtics
  3: 'NOP',   // New Orleans Pelicans
  4: 'CHI',   // Chicago Bulls
  5: 'CLE',   // Cleveland Cavaliers
  6: 'DAL',   // Dallas Mavericks
  7: 'DEN',   // Denver Nuggets
  8: 'DET',   // Detroit Pistons
  9: 'GSW',   // Golden State Warriors
  10: 'HOU',  // Houston Rockets
  11: 'IND',  // Indiana Pacers
  12: 'LAC',  // Los Angeles Clippers
  13: 'LAL',  // Los Angeles Lakers
  14: 'MIA',  // Miami Heat
  15: 'MIL',  // Milwaukee Bucks
  16: 'MIN',  // Minnesota Timberwolves
  17: 'BKN',  // Brooklyn Nets
  18: 'NYK',  // New York Knicks
  19: 'ORL',  // Orlando Magic
  20: 'PHI',  // Philadelphia 76ers
  21: 'PHX',  // Phoenix Suns
  22: 'POR',  // Portland Trail Blazers
  23: 'SAC',  // Sacramento Kings
  24: 'SAS',  // San Antonio Spurs
  25: 'OKC',  // Oklahoma City Thunder
  26: 'UTA',  // Utah Jazz
  27: 'WAS',  // Washington Wizards
  28: 'TOR',  // Toronto Raptors
  29: 'MEM',  // Memphis Grizzlies
  30: 'CHA',  // Charlotte Hornets
};

// Injury status codes (same across all ESPN sports)
export const INJURY_STATUS_MAP: Record<string, string> = {
  ACTIVE: 'Active',
  OUT: 'Out',
  DAY_TO_DAY: 'Day-to-Day',
  QUESTIONABLE: 'Questionable',
  DOUBTFUL: 'Doubtful',
  INJURY_RESERVE: 'IR',
  SUSPENSION: 'Suspended',
};

// POSITION_SLOTS: Maps position filter names to lineup slot IDs
// Used for filterSlotIds in ESPN free agent queries
export const POSITION_SLOTS: Record<string, number[]> = {
  'PG': [0],
  'SG': [1],
  'SF': [2],
  'PF': [3],
  'C': [4],
  'G': [5],
  'F': [6],
  'UTIL': [11],
  'ALL': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

// STATS_MAP: ESPN stat IDs to readable stat names
// Source: cwendt94/espn-api constant.py (basketball)
// UNVERIFIED — no live league credentials
export const STATS_MAP: Record<number, string> = {
  0: 'PTS',     // Points
  1: 'BLK',     // Blocks
  2: 'STL',     // Steals
  3: 'AST',     // Assists
  4: 'OREB',    // Offensive Rebounds
  5: 'DREB',    // Defensive Rebounds
  6: 'REB',     // Total Rebounds
  7: 'EJ',      // Ejections
  8: 'FF',      // Flagrant Fouls
  9: 'PF',      // Personal Fouls
  10: 'TF',     // Technical Fouls
  11: 'TO',     // Turnovers
  12: 'DQ',     // Disqualifications
  13: 'FGM',    // Field Goals Made
  14: 'FGA',    // Field Goals Attempted
  15: 'FTM',    // Free Throws Made
  16: 'FTA',    // Free Throws Attempted
  17: '3PM',    // Three Pointers Made
  18: '3PA',    // Three Pointers Attempted
  19: 'FG%',    // Field Goal Percentage
  20: 'FT%',    // Free Throw Percentage
  21: '3PT%',   // Three Point Percentage
  22: 'AFG%',   // Adjusted FG%
  23: 'FGMI',   // Field Goals Missed
  24: 'FTMI',   // Free Throws Missed
  25: '3PMI',   // Three Pointers Missed
  26: 'APG',    // Assists Per Game
  27: 'BPG',    // Blocks Per Game
  28: 'MPG',    // Minutes Per Game
  29: 'PPG',    // Points Per Game
  30: 'RPG',    // Rebounds Per Game
  31: 'SPG',    // Steals Per Game
  32: 'TOPG',   // Turnovers Per Game
  33: '3PG',    // Three Pointers Per Game
  34: 'PPM',    // Points Per Minute
  35: 'A/TO',   // Assist to Turnover Ratio
  36: 'STR',    // Starter
  37: 'DD',     // Double-Doubles
  38: 'TD',     // Triple-Doubles
  39: 'QD',     // Quadruple-Doubles
  40: 'MIN',    // Minutes Played
  41: 'GS',     // Games Started
  42: 'GP',     // Games Played
  43: 'TW',     // Team Wins
  44: 'FTR',    // Free Throw Rate
};

// Track unknown IDs for logging
const UNKNOWN_POSITION_IDS = new Set<number>();
const UNKNOWN_LINEUP_SLOT_IDS = new Set<number>();

export function getPositionName(positionId: number): string {
  const name = POSITION_MAP[positionId];
  if (name) return name;
  if (!UNKNOWN_POSITION_IDS.has(positionId)) {
    UNKNOWN_POSITION_IDS.add(positionId);
    console.warn(`[basketball-mappings] Unknown position ID: ${positionId}`);
  }
  return `POS_${positionId}`;
}

export function getLineupSlotName(slotId: number): string {
  const name = LINEUP_SLOT_MAP[slotId];
  if (name) return name;
  if (!UNKNOWN_LINEUP_SLOT_IDS.has(slotId)) {
    UNKNOWN_LINEUP_SLOT_IDS.add(slotId);
    console.warn(`[basketball-mappings] Unknown lineup slot ID: ${slotId}`);
  }
  return `SLOT_${slotId}`;
}

export function getProTeamAbbrev(teamId: number): string {
  return PRO_TEAM_MAP[teamId] || 'FA';
}

export function getInjuryStatus(status: string): string {
  return INJURY_STATUS_MAP[status] || status;
}

export function transformEligiblePositions(slots: number[]): string[] {
  return slots
    .map(slot => POSITION_MAP[slot])
    .filter((name): name is string => !!name && !['Bench', 'IR'].includes(name));
}

export function getStatName(statId: number): string {
  return STATS_MAP[statId] || `STAT_${statId}`;
}

export function transformStats(stats: Record<string, number>): Record<string, number> {
  const transformed: Record<string, number> = {};
  for (const [key, value] of Object.entries(stats)) {
    const statId = parseInt(key, 10);
    const statName = getStatName(statId);
    transformed[statName] = value;
  }
  return transformed;
}
```

**Step 2: Create MAPPINGS.md**

```markdown
# ESPN Basketball Mappings

## Sources
- **Primary:** `cwendt94/espn-api` Python library — `espn_api/basketball/constant.py`
- **Verification status:** UNVERIFIED — no live basketball league credentials available

## Notes
- Basketball uses a **single ID space** for both `defaultPositionId` and `lineupSlotId/eligibleSlots`
  (unlike baseball which has two separate spaces)
- `PRO_TEAM_MAP` covers all 30 NBA teams (IDs 1-30, plus 0 for Free Agent)
- `STATS_MAP` covers 45 stat categories including per-game averages
- Some stat IDs may not appear in all league scoring formats

## Verification Checklist
When live credentials become available:
- [ ] Confirm POSITION_MAP IDs against actual roster entries
- [ ] Confirm STATS_MAP IDs against player stat objects
- [ ] Confirm PRO_TEAM_MAP against proTeamSchedules endpoint
- [ ] Log any unknown IDs that appear in practice
```

**Step 3: Commit**

```bash
git add workers/espn-client/src/sports/basketball/
git commit -m "feat(espn-client): add basketball mappings from cwendt94/espn-api"
```

---

## Task 2: ESPN Hockey Mappings

**Files:**
- Create: `workers/espn-client/src/sports/hockey/mappings.ts`
- Create: `workers/espn-client/src/sports/hockey/MAPPINGS.md`

**Step 1: Create the mappings file**

```typescript
// workers/espn-client/src/sports/hockey/mappings.ts

/**
 * Hockey data transforms for ESPN API responses
 * Maps ESPN's numeric IDs to human-readable names
 *
 * Source: cwendt94/espn-api constant.py (hockey)
 * Verified: NOT YET — no live league credentials available
 */

// Position IDs to position names
// Used for both defaultPositionId and lineupSlotId/eligibleSlots
export const POSITION_MAP: Record<number, string> = {
  0: 'C',      // Center
  1: 'LW',     // Left Wing
  2: 'RW',     // Right Wing
  3: 'F',      // Forward (C/LW/RW flex)
  4: 'D',      // Defense
  5: 'G',      // Goalie
  6: 'UTIL',   // Utility
  7: 'Bench',  // Bench
  8: 'IR',     // Injured Reserve
};

// Alias for consistency with football/baseball handler imports
export const LINEUP_SLOT_MAP = POSITION_MAP;

// Pro team IDs to team abbreviations (NHL teams)
// Source: cwendt94/espn-api constant.py
// Note: ESPN uses large IDs for expansion teams (Seattle, Utah)
export const PRO_TEAM_MAP: Record<number, string> = {
  0: 'FA',        // Free Agent
  1: 'BOS',       // Boston Bruins
  2: 'BUF',       // Buffalo Sabres
  3: 'CGY',       // Calgary Flames
  4: 'CHI',       // Chicago Blackhawks
  5: 'DET',       // Detroit Red Wings
  6: 'EDM',       // Edmonton Oilers
  7: 'CAR',       // Carolina Hurricanes
  8: 'LAK',       // Los Angeles Kings
  9: 'DAL',       // Dallas Stars
  10: 'MTL',      // Montréal Canadiens
  11: 'NJD',      // New Jersey Devils
  12: 'NYI',      // New York Islanders
  13: 'NYR',      // New York Rangers
  14: 'OTT',      // Ottawa Senators
  15: 'PHI',      // Philadelphia Flyers
  16: 'PIT',      // Pittsburgh Penguins
  17: 'COL',      // Colorado Avalanche
  18: 'SJS',      // San Jose Sharks
  19: 'STL',      // St. Louis Blues
  20: 'TBL',      // Tampa Bay Lightning
  21: 'TOR',      // Toronto Maple Leafs
  22: 'VAN',      // Vancouver Canucks
  23: 'WSH',      // Washington Capitals
  24: 'ARI',      // Arizona Coyotes (may be deprecated — see Utah)
  25: 'ANA',      // Anaheim Ducks
  26: 'FLA',      // Florida Panthers
  27: 'NSH',      // Nashville Predators
  28: 'WPG',      // Winnipeg Jets
  29: 'CBJ',      // Columbus Blue Jackets
  30: 'MIN',      // Minnesota Wild
  37: 'VGK',      // Vegas Golden Knights
  124292: 'SEA',  // Seattle Kraken
  129764: 'UTA',  // Utah Hockey Club
};

// Injury status codes
export const INJURY_STATUS_MAP: Record<string, string> = {
  ACTIVE: 'Active',
  OUT: 'Out',
  DAY_TO_DAY: 'Day-to-Day',
  QUESTIONABLE: 'Questionable',
  DOUBTFUL: 'Doubtful',
  INJURY_RESERVE: 'IR',
  SUSPENSION: 'Suspended',
};

// POSITION_SLOTS: Maps position filter names to lineup slot IDs
export const POSITION_SLOTS: Record<string, number[]> = {
  'C': [0],
  'LW': [1],
  'RW': [2],
  'F': [3],
  'D': [4],
  'G': [5],
  'UTIL': [6],
  'ALL': [0, 1, 2, 3, 4, 5, 6],
};

// STATS_MAP: ESPN stat IDs to readable stat names
// Source: cwendt94/espn-api constant.py (hockey)
// UNVERIFIED — no live league credentials
// Note: IDs 0-12 are goalie stats, 13+ are skater stats
export const SKATER_STATS_MAP: Record<number, string> = {
  13: 'G',      // Goals
  14: 'A',      // Assists
  15: '+/-',    // Plus/Minus
  17: 'PIM',    // Penalty Minutes
  18: 'PPG',    // Power Play Goals
  19: 'PPA',    // Power Play Assists
  20: 'SHG',    // Short-Handed Goals
  21: 'SHA',    // Short-Handed Assists
  22: 'GWG',    // Game-Winning Goals
  23: 'FOW',    // Faceoffs Won
  24: 'FOL',    // Faceoffs Lost
  27: 'ATOI',   // Average Time On Ice
  28: 'HAT',    // Hat Tricks
  29: 'SOG',    // Shots On Goal
  31: 'HIT',    // Hits
  32: 'BLK',    // Blocked Shots
  33: 'DEF',    // Defenseman Points (?)
  34: 'GP',     // Games Played
  35: 'STPG',   // Shorthanded Time Per Game
  36: 'STPA',   // Shorthanded Time Per Appearance
  37: 'STP',    // Special Teams Points (?)
  38: 'PPP',    // Power Play Points
  39: 'SHP',    // Short-Handed Points
};

export const GOALIE_STATS_MAP: Record<number, string> = {
  0: 'GS',     // Games Started
  1: 'W',      // Wins
  2: 'L',      // Losses
  3: 'SA',     // Shots Against
  4: 'GA',     // Goals Against
  6: 'SV',     // Saves
  7: 'SO',     // Shutouts
  9: 'OTL',    // Overtime Losses
  10: 'GAA',   // Goals Against Average
  11: 'SV%',   // Save Percentage
};

// Track unknown IDs for logging
const UNKNOWN_POSITION_IDS = new Set<number>();
const UNKNOWN_LINEUP_SLOT_IDS = new Set<number>();

export function getPositionName(positionId: number): string {
  const name = POSITION_MAP[positionId];
  if (name) return name;
  if (!UNKNOWN_POSITION_IDS.has(positionId)) {
    UNKNOWN_POSITION_IDS.add(positionId);
    console.warn(`[hockey-mappings] Unknown position ID: ${positionId}`);
  }
  return `POS_${positionId}`;
}

export function getLineupSlotName(slotId: number): string {
  const name = LINEUP_SLOT_MAP[slotId];
  if (name) return name;
  if (!UNKNOWN_LINEUP_SLOT_IDS.has(slotId)) {
    UNKNOWN_LINEUP_SLOT_IDS.add(slotId);
    console.warn(`[hockey-mappings] Unknown lineup slot ID: ${slotId}`);
  }
  return `SLOT_${slotId}`;
}

export function getProTeamAbbrev(teamId: number): string {
  return PRO_TEAM_MAP[teamId] || 'FA';
}

export function getInjuryStatus(status: string): string {
  return INJURY_STATUS_MAP[status] || status;
}

export function transformEligiblePositions(slots: number[]): string[] {
  return slots
    .map(slot => POSITION_MAP[slot])
    .filter((name): name is string => !!name && !['Bench', 'IR'].includes(name));
}

/**
 * Get stat name from ESPN stat ID
 * IDs 0-12: Goalie stats
 * IDs 13+: Skater stats
 */
export function getStatName(statId: number): string {
  if (statId < 13) {
    return GOALIE_STATS_MAP[statId] || `STAT_${statId}`;
  }
  return SKATER_STATS_MAP[statId] || `STAT_${statId}`;
}

export function transformStats(stats: Record<string, number>): Record<string, number> {
  const transformed: Record<string, number> = {};
  for (const [key, value] of Object.entries(stats)) {
    const statId = parseInt(key, 10);
    const statName = getStatName(statId);
    transformed[statName] = value;
  }
  return transformed;
}
```

**Step 2: Create MAPPINGS.md**

```markdown
# ESPN Hockey Mappings

## Sources
- **Primary:** `cwendt94/espn-api` Python library — `espn_api/hockey/constant.py`
- **Verification status:** UNVERIFIED — no live hockey league credentials available

## Notes
- Hockey uses a **single ID space** for positions (like basketball, unlike baseball)
- `PRO_TEAM_MAP` includes expansion teams with large IDs: Seattle Kraken (124292), Utah Hockey Club (129764)
- Stats are split: IDs 0-12 are goalie stats, IDs 13+ are skater stats
- Some stat IDs in the source are marked with `?` or unknown — these are included as-is
- Arizona Coyotes (ID 24) may be deprecated in favor of Utah Hockey Club (ID 129764)

## Verification Checklist
When live credentials become available:
- [ ] Confirm POSITION_MAP IDs against actual roster entries
- [ ] Confirm goalie vs skater stat ID boundary
- [ ] Confirm PRO_TEAM_MAP — especially expansion team IDs
- [ ] Check if Arizona (24) still appears or is fully replaced by Utah (129764)
- [ ] Log any unknown IDs that appear in practice
```

**Step 3: Commit**

```bash
git add workers/espn-client/src/sports/hockey/
git commit -m "feat(espn-client): add hockey mappings from cwendt94/espn-api"
```

---

## Task 3: ESPN Basketball Handlers

**Files:**
- Create: `workers/espn-client/src/sports/basketball/handlers.ts`

**Step 1: Create handlers**

Copy from `workers/espn-client/src/sports/football/handlers.ts` with these changes:
- `GAME_ID = 'fba'` (was `'ffl'`)
- Export name: `basketballHandlers` (was `footballHandlers`)
- Import mappings from `./mappings` (same function names, basketball-specific data)

The handler logic is identical — same ESPN API views, same response parsing, same error handling. The only difference is the `GAME_ID` constant which controls the URL path segment.

```typescript
// workers/espn-client/src/sports/basketball/handlers.ts
import type { Env, ToolParams, ExecuteResponse, EspnLeagueResponse, EspnPlayerPoolResponse } from '../../types';
import { getCredentials } from '../../shared/auth';
import { espnFetch, handleEspnError, requireCredentials } from '../../shared/espn-api';
import { extractErrorCode } from '@flaim/worker-shared';
import {
  getPositionName,
  getLineupSlotName,
  getProTeamAbbrev,
  getInjuryStatus,
  transformEligiblePositions,
  transformStats,
  POSITION_SLOTS,
} from './mappings';

const GAME_ID = 'fba'; // ESPN's game ID for fantasy basketball
```

Then paste the rest of the football handlers file verbatim (from the `type HandlerFn` line through end), changing only the export name:

```typescript
export const basketballHandlers: Record<string, HandlerFn> = {
  get_league_info: handleGetLeagueInfo,
  get_standings: handleGetStandings,
  get_matchups: handleGetMatchups,
  get_roster: handleGetRoster,
  get_free_agents: handleGetFreeAgents,
};
```

All 5 handler function bodies are identical to football.

**Step 2: Commit**

```bash
git add workers/espn-client/src/sports/basketball/handlers.ts
git commit -m "feat(espn-client): add basketball handlers (5 tools)"
```

---

## Task 4: ESPN Hockey Handlers

**Files:**
- Create: `workers/espn-client/src/sports/hockey/handlers.ts`

**Step 1: Create handlers**

Same as Task 3 but for hockey:
- `GAME_ID = 'fhl'`
- Export name: `hockeyHandlers`
- Import from `./mappings`

```typescript
const GAME_ID = 'fhl'; // ESPN's game ID for fantasy hockey

export const hockeyHandlers: Record<string, HandlerFn> = { ... };
```

All 5 handler function bodies identical to football.

**Step 2: Commit**

```bash
git add workers/espn-client/src/sports/hockey/handlers.ts
git commit -m "feat(espn-client): add hockey handlers (5 tools)"
```

---

## Task 5: ESPN Router Wiring

**Files:**
- Modify: `workers/espn-client/src/index.ts` (lines 5-6, 176-180)

**Step 1: Add imports**

At top of file, after existing handler imports (line 6):

```typescript
import { basketballHandlers } from './sports/basketball/handlers';
import { hockeyHandlers } from './sports/hockey/handlers';
```

**Step 2: Replace stubs in `routeToSport`**

Replace the two stub cases (lines 176-180):

```typescript
    case 'basketball': {
      const handler = basketballHandlers[tool];
      if (!handler) {
        return {
          success: false,
          error: `Unknown basketball tool: ${tool}`,
          code: 'UNKNOWN_TOOL'
        };
      }
      return handler(env, params, authHeader, correlationId);
    }

    case 'hockey': {
      const handler = hockeyHandlers[tool];
      if (!handler) {
        return {
          success: false,
          error: `Unknown hockey tool: ${tool}`,
          code: 'UNKNOWN_TOOL'
        };
      }
      return handler(env, params, authHeader, correlationId);
    }
```

**Step 3: Commit**

```bash
git add workers/espn-client/src/index.ts
git commit -m "feat(espn-client): wire basketball and hockey into router"
```

---

## Task 6: ESPN Onboarding Gate

**Files:**
- Modify: `workers/espn-client/src/onboarding/handlers.ts` (line 51)

**Step 1: Expand `isOnboardingSport`**

Change line 51 from:

```typescript
function isOnboardingSport(sport: Sport): sport is 'football' | 'baseball' {
  return sport === 'football' || sport === 'baseball';
}
```

To:

```typescript
function isOnboardingSport(sport: Sport): boolean {
  return sport === 'football' || sport === 'baseball' || sport === 'basketball' || sport === 'hockey';
}
```

**Step 2: Commit**

```bash
git add workers/espn-client/src/onboarding/handlers.ts
git commit -m "feat(espn-client): allow basketball/hockey in onboarding"
```

---

## Task 7: Yahoo Basketball

**Files:**
- Create: `workers/yahoo-client/src/sports/basketball/mappings.ts`
- Create: `workers/yahoo-client/src/sports/basketball/handlers.ts`

**Step 1: Create mappings**

Yahoo returns human-readable position strings, so this is simple:

```typescript
// workers/yahoo-client/src/sports/basketball/mappings.ts

export const POSITION_MAP: Record<string, string> = {
  'PG': 'Point Guard',
  'SG': 'Shooting Guard',
  'SF': 'Small Forward',
  'PF': 'Power Forward',
  'C': 'Center',
  'G': 'Guard',
  'F': 'Forward',
  'UTIL': 'Utility',
  'Util': 'Utility',
  'BN': 'Bench',
  'IR': 'Injured Reserve',
  'IR+': 'Injured Reserve+',
  'IL': 'Injured List',
  'IL+': 'Injured List+',
};

export function getPositionName(posAbbrev: string): string {
  return POSITION_MAP[posAbbrev] || posAbbrev;
}

export const FA_POSITION_FILTER: Record<string, string> = {
  'ALL': '',
  'PG': 'PG',
  'SG': 'SG',
  'SF': 'SF',
  'PF': 'PF',
  'C': 'C',
  'G': 'G',
  'F': 'F',
  'UTIL': 'Util',
};

export function getPositionFilter(position?: string): string {
  if (!position) return '';
  const key = position.toUpperCase();
  return FA_POSITION_FILTER[key] ?? '';
}
```

**Step 2: Create handlers**

Copy from `workers/yahoo-client/src/sports/football/handlers.ts`. The only change is the export name and mappings import:

```typescript
import { getPositionFilter } from './mappings';

export const basketballHandlers: Record<string, HandlerFn> = {
  get_league_info: handleGetLeagueInfo,
  get_standings: handleGetStandings,
  get_roster: handleGetRoster,
  get_matchups: handleGetMatchups,
  get_free_agents: handleGetFreeAgents,
};
```

All 5 handler function bodies are identical to football. The Yahoo normalizers (`unwrapLeague`, `unwrapTeam`, `asArray`) are sport-agnostic.

**Step 3: Commit**

```bash
git add workers/yahoo-client/src/sports/basketball/
git commit -m "feat(yahoo-client): add basketball handlers and mappings"
```

---

## Task 8: Yahoo Hockey

**Files:**
- Create: `workers/yahoo-client/src/sports/hockey/mappings.ts`
- Create: `workers/yahoo-client/src/sports/hockey/handlers.ts`

**Step 1: Create mappings**

```typescript
// workers/yahoo-client/src/sports/hockey/mappings.ts

export const POSITION_MAP: Record<string, string> = {
  'C': 'Center',
  'LW': 'Left Wing',
  'RW': 'Right Wing',
  'D': 'Defense',
  'G': 'Goalie',
  'W': 'Wing',
  'F': 'Forward',
  'UTIL': 'Utility',
  'Util': 'Utility',
  'BN': 'Bench',
  'IR': 'Injured Reserve',
  'IR+': 'Injured Reserve+',
  'NA': 'Not Active',
};

export function getPositionName(posAbbrev: string): string {
  return POSITION_MAP[posAbbrev] || posAbbrev;
}

export const FA_POSITION_FILTER: Record<string, string> = {
  'ALL': '',
  'C': 'C',
  'LW': 'LW',
  'RW': 'RW',
  'D': 'D',
  'G': 'G',
  'W': 'W',
  'F': 'F',
};

export function getPositionFilter(position?: string): string {
  if (!position) return '';
  const key = position.toUpperCase();
  return FA_POSITION_FILTER[key] ?? '';
}
```

**Step 2: Create handlers**

Same pattern — copy from football, change export name and mappings import:

```typescript
export const hockeyHandlers: Record<string, HandlerFn> = { ... };
```

**Step 3: Commit**

```bash
git add workers/yahoo-client/src/sports/hockey/
git commit -m "feat(yahoo-client): add hockey handlers and mappings"
```

---

## Task 9: Yahoo Router Wiring

**Files:**
- Modify: `workers/yahoo-client/src/index.ts` (lines 4-5, 135-139)

**Step 1: Add imports**

After existing handler imports (line 5):

```typescript
import { basketballHandlers } from './sports/basketball/handlers';
import { hockeyHandlers } from './sports/hockey/handlers';
```

**Step 2: Replace stubs in `routeToSport`**

Replace the two stub cases (lines 135-139):

```typescript
    case 'basketball': {
      const handler = basketballHandlers[tool];
      if (!handler) {
        return {
          success: false,
          error: `Unknown basketball tool: ${tool}`,
          code: 'UNKNOWN_TOOL'
        };
      }
      return handler(env, params, authHeader, correlationId);
    }

    case 'hockey': {
      const handler = hockeyHandlers[tool];
      if (!handler) {
        return {
          success: false,
          error: `Unknown hockey tool: ${tool}`,
          code: 'UNKNOWN_TOOL'
        };
      }
      return handler(env, params, authHeader, correlationId);
    }
```

**Step 3: Commit**

```bash
git add workers/yahoo-client/src/index.ts
git commit -m "feat(yahoo-client): wire basketball and hockey into router"
```

---

## Task 10: Build Verification

**Step 1: Run TypeScript compilation**

```bash
cd workers/espn-client && npx tsc --noEmit
cd ../yahoo-client && npx tsc --noEmit
```

Both should pass with zero errors.

**Step 2: Run existing tests**

```bash
cd workers/espn-client && npm test
cd ../yahoo-client && npm test
```

Existing tests should still pass (no changes to shared code).

**Step 3: Run lint**

```bash
npm run lint
```

**Step 4: Commit any lint fixes, then final commit**

```bash
git add -A
git commit -m "chore: basketball/hockey build verification passes"
```

---

## Task 11: Documentation Updates

**Files:**
- Modify: `docs/STATUS.md` — update sport coverage table
- Modify: `docs/CHANGELOG.md` — add entry under `[Unreleased]`
- Modify: `docs/dev/CURRENT-EXECUTION-STATE.md` — update phase status

Consult `docs/INDEX.md` for which docs own which facts. Do not duplicate.

**Changelog entry:**

```markdown
### Basketball & Hockey Support
- **Added**: ESPN basketball handlers (5 tools) with position, team, and stat mappings
- **Added**: ESPN hockey handlers (5 tools) with skater/goalie stat split mappings
- **Added**: Yahoo basketball handlers (5 tools) with position mappings
- **Added**: Yahoo hockey handlers (5 tools) with position mappings
- **Added**: Basketball/hockey now routable in both ESPN and Yahoo clients
- **Added**: Basketball/hockey enabled for ESPN onboarding (discover-seasons)
- **Note**: All ESPN mappings sourced from `cwendt94/espn-api` — marked unverified pending live league testing
```

---

## Summary

| Task | Component | New Files | Edits | Effort |
|------|-----------|-----------|-------|--------|
| 1 | ESPN basketball mappings | 2 | 0 | Research done |
| 2 | ESPN hockey mappings | 2 | 0 | Research done |
| 3 | ESPN basketball handlers | 1 | 0 | Copy from football |
| 4 | ESPN hockey handlers | 1 | 0 | Copy from football |
| 5 | ESPN router wiring | 0 | 1 | ~15 lines |
| 6 | ESPN onboarding gate | 0 | 1 | 1 line |
| 7 | Yahoo basketball | 2 | 0 | Copy + mappings |
| 8 | Yahoo hockey | 2 | 0 | Copy + mappings |
| 9 | Yahoo router wiring | 0 | 1 | ~15 lines |
| 10 | Build verification | 0 | 0 | Run commands |
| 11 | Doc updates | 0 | 3 | Changelog + status |
| **Total** | | **10 new** | **6 edits** | |
