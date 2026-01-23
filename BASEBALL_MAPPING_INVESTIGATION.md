# ESPN Fantasy Baseball API v3 Mapping Investigation

**Purpose:** Document mapping discrepancies for AI-driven verification
**API Version:** ESPN Fantasy API **v3** (critical - different from public ESPN API)
**Branch:** claude/investigate-baseball-mappings-C6qEd

---

## API Context (CRITICAL FOR VERIFICATION)

### Correct API Base URL (Fantasy API v3)
```
https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/{YEAR}/...
```

### WRONG API (Do NOT use for verification)
```
https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/...
```

The public ESPN sports API uses **different team IDs** than the Fantasy API v3. Only use the Fantasy API v3 (`lm-api-reads.fantasy.espn.com`) for verification.

### Sport Code
- Baseball: `flb` (fantasy league baseball)
- Football: `ffl` (fantasy league football) - uses DIFFERENT IDs

---

## Reference Source: cwendt94/espn-api

The [cwendt94/espn-api](https://github.com/cwendt94/espn-api) Python library is the most authoritative community resource for ESPN Fantasy API v3 mappings. It has 1.2k+ GitHub stars and is actively maintained.

**Source file:** https://github.com/cwendt94/espn-api/blob/master/espn_api/baseball/constant.py

---

## MAPPING 1: PRO_TEAM_MAP (MLB Teams)

### Current Code (BELIEVED TO BE WRONG)

Location: `workers/espn-client/src/sports/baseball/mappings.ts` lines 127-158

```typescript
export const PRO_TEAM_MAP: Record<number, string> = {
  1: 'ATL',   // Atlanta Braves
  2: 'BAL',   // Baltimore Orioles
  3: 'BOS',   // Boston Red Sox
  4: 'CHC',   // Chicago Cubs
  5: 'CWS',   // Chicago White Sox
  6: 'CIN',   // Cincinnati Reds
  7: 'CLE',   // Cleveland Guardians
  8: 'COL',   // Colorado Rockies
  9: 'DET',   // Detroit Tigers
  10: 'HOU',  // Houston Astros
  11: 'KC',   // Kansas City Royals
  12: 'LAA',  // Los Angeles Angels
  13: 'LAD',  // Los Angeles Dodgers
  14: 'MIA',  // Miami Marlins
  15: 'MIL',  // Milwaukee Brewers
  16: 'MIN',  // Minnesota Twins
  17: 'NYM',  // New York Mets
  18: 'NYY',  // New York Yankees
  19: 'OAK',  // Oakland Athletics
  20: 'PHI',  // Philadelphia Phillies
  21: 'PIT',  // Pittsburgh Pirates
  22: 'SD',   // San Diego Padres
  23: 'SF',   // San Francisco Giants
  24: 'SEA',  // Seattle Mariners
  25: 'STL',  // St. Louis Cardinals
  26: 'TB',   // Tampa Bay Rays
  27: 'TEX',  // Texas Rangers
  28: 'TOR',  // Toronto Blue Jays
  29: 'WSH',  // Washington Nationals
  30: 'ARI',  // Arizona Diamondbacks
};
```

### cwendt94/espn-api Says (BELIEVED TO BE CORRECT)

```python
PRO_TEAM_MAP = {
    0: 'FA',    # Free Agent
    1: 'Bal',   # Baltimore Orioles
    2: 'Bos',   # Boston Red Sox
    3: 'LAA',   # Los Angeles Angels
    4: 'ChW',   # Chicago White Sox
    5: 'Cle',   # Cleveland Guardians
    6: 'Det',   # Detroit Tigers
    7: 'KC',    # Kansas City Royals
    8: 'Mil',   # Milwaukee Brewers
    9: 'Min',   # Minnesota Twins
    10: 'NYY',  # New York Yankees
    11: 'Oak',  # Oakland Athletics
    12: 'Sea',  # Seattle Mariners
    13: 'Tex',  # Texas Rangers
    14: 'Tor',  # Toronto Blue Jays
    15: 'Atl',  # Atlanta Braves
    16: 'ChC',  # Chicago Cubs
    17: 'Cin',  # Cincinnati Reds
    18: 'Hou',  # Houston Astros
    19: 'LAD',  # Los Angeles Dodgers
    20: 'Wsh',  # Washington Nationals
    21: 'NYM',  # New York Mets
    22: 'Phi',  # Philadelphia Phillies
    23: 'Pit',  # Pittsburgh Pirates
    24: 'StL',  # St. Louis Cardinals
    25: 'SD',   # San Diego Padres
    26: 'SF',   # San Francisco Giants
    27: 'Col',  # Colorado Rockies
    28: 'Mia',  # Miami Marlins
    29: 'Ari',  # Arizona Diamondbacks
    30: 'TB',   # Tampa Bay Rays
}
```

### Partial Verification Completed

Using the Fantasy API v3 player endpoint, I verified:

| Player Name | Actual Team | proTeamId from API |
|-------------|-------------|-------------------|
| Ronald Acuña Jr. | Atlanta Braves | 15 |
| Keegan Akin | Baltimore Orioles | 1 |
| Wilyer Abreu | Boston Red Sox | 2 |

This matches cwendt94, NOT our current code.

### Verification Needed

**For each team, verify the proTeamId by:**

1. Query: `https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2025/players?scoringPeriodId=0&view=players_wl`
2. Find a known player from each team
3. Check their `proTeamId` field
4. Confirm it matches cwendt94's mapping

**Teams requiring verification:**

| ID | cwendt94 Says | Verify With Player |
|----|---------------|-------------------|
| 0 | FA (Free Agent) | Any free agent player |
| 1 | BAL (Baltimore) | ✓ Verified: Keegan Akin |
| 2 | BOS (Boston) | ✓ Verified: Wilyer Abreu |
| 3 | LAA (LA Angels) | Find Angels player |
| 4 | CHW (Chicago White Sox) | Find White Sox player |
| 5 | CLE (Cleveland) | Find Guardians player |
| 6 | DET (Detroit) | Find Tigers player |
| 7 | KC (Kansas City) | Find Royals player |
| 8 | MIL (Milwaukee) | Find Brewers player |
| 9 | MIN (Minnesota) | Find Twins player |
| 10 | NYY (NY Yankees) | Find Yankees player |
| 11 | OAK (Oakland) | Find Athletics player |
| 12 | SEA (Seattle) | Find Mariners player |
| 13 | TEX (Texas) | Find Rangers player |
| 14 | TOR (Toronto) | Find Blue Jays player |
| 15 | ATL (Atlanta) | ✓ Verified: Ronald Acuña Jr. |
| 16 | CHC (Chicago Cubs) | Find Cubs player |
| 17 | CIN (Cincinnati) | Find Reds player |
| 18 | HOU (Houston) | Find Astros player |
| 19 | LAD (LA Dodgers) | Find Dodgers player |
| 20 | WSH (Washington) | Find Nationals player |
| 21 | NYM (NY Mets) | Find Mets player |
| 22 | PHI (Philadelphia) | Find Phillies player |
| 23 | PIT (Pittsburgh) | Find Pirates player |
| 24 | STL (St. Louis) | Find Cardinals player |
| 25 | SD (San Diego) | Find Padres player |
| 26 | SF (San Francisco) | Find Giants player |
| 27 | COL (Colorado) | Find Rockies player |
| 28 | MIA (Miami) | Find Marlins player |
| 29 | ARI (Arizona) | Find Diamondbacks player |
| 30 | TB (Tampa Bay) | Find Rays player |

---

## MAPPING 2: POSITION_MAP (Player Positions)

### Current Code (INCOMPLETE)

Location: `workers/espn-client/src/sports/baseball/mappings.ts` lines 9-22

```typescript
export const POSITION_MAP: Record<number, string> = {
  0: 'C',      // Catcher
  1: '1B',     // First Base
  2: '2B',     // Second Base
  3: '3B',     // Third Base
  4: 'SS',     // Shortstop
  5: 'OF',     // Outfield
  // MISSING: 6, 7, 8, 9, 10, 11
  12: 'UTIL',  // Utility
  13: 'P',     // Pitcher (general)
  14: 'SP',    // Starting Pitcher
  15: 'RP',    // Relief Pitcher
  16: 'BE',    // Bench
  17: 'IL',    // Injured List
  // MISSING: 19
};
```

### cwendt94/espn-api Says (BELIEVED TO BE CORRECT)

```python
POSITION_MAP = {
    0: 'C',       # Catcher
    1: '1B',      # First Base
    2: '2B',      # Second Base
    3: '3B',      # Third Base
    4: 'SS',      # Shortstop
    5: 'OF',      # Outfield (general)
    6: '2B/SS',   # Middle Infielder (MI)
    7: '1B/3B',   # Corner Infielder (CI)
    8: 'LF',      # Left Field
    9: 'CF',      # Center Field
    10: 'RF',     # Right Field
    11: 'DH',     # Designated Hitter
    12: 'UTIL',   # Utility
    13: 'P',      # Pitcher (general)
    14: 'SP',     # Starting Pitcher
    15: 'RP',     # Relief Pitcher
    16: 'BE',     # Bench
    17: 'IL',     # Injured List
    19: 'IF',     # Infield (1B/2B/SS/3B)
}
```

### Verification Needed

**For each position, verify by:**

1. Query player data from Fantasy API v3
2. Check the `defaultPositionId` field for players at known positions
3. Check the `eligibleSlots` array to understand slot eligibility

**Positions requiring verification:**

| ID | cwendt94 Says | How to Verify |
|----|---------------|---------------|
| 0 | C (Catcher) | Find a catcher, check defaultPositionId |
| 1 | 1B | Find a first baseman |
| 2 | 2B | Find a second baseman |
| 3 | 3B | Find a third baseman |
| 4 | SS | Find a shortstop |
| 5 | OF | Find an outfielder |
| 6 | 2B/SS (MI) | Check eligibleSlots for 2B/SS players |
| 7 | 1B/3B (CI) | Check eligibleSlots for 1B/3B players |
| 8 | LF | Find a left fielder, or check eligibleSlots |
| 9 | CF | Find a center fielder, or check eligibleSlots |
| 10 | RF | Find a right fielder, or check eligibleSlots |
| 11 | DH | Check eligibleSlots for DH-eligible players |
| 12 | UTIL | Check eligibleSlots (most position players) |
| 13 | P | Find a two-way player or check pitcher eligibleSlots |
| 14 | SP | Find a starting pitcher, check defaultPositionId |
| 15 | RP | Find a relief pitcher, check defaultPositionId |
| 16 | BE | Check eligibleSlots (all players should have this) |
| 17 | IL | Check eligibleSlots (injured players) |
| 19 | IF | Check eligibleSlots for infielders |

**Note:** ID 18 is not documented in cwendt94. If encountered, document what it represents.

---

## MAPPING 3: POSITION_SLOTS (For Free Agent Filtering)

### Current Code (BELIEVED TO BE WRONG)

Location: `workers/espn-client/src/sports/baseball/mappings.ts` lines 172-188

```typescript
export const POSITION_SLOTS: Record<string, number[]> = {
  'C': [0],
  '1B': [1],
  '2B': [2],
  '3B': [3],
  'SS': [4],
  'LF': [5],        // WRONG per cwendt94 - should be [8]
  'CF': [6],        // WRONG per cwendt94 - should be [9]
  'RF': [7],        // WRONG per cwendt94 - should be [10]
  'OF': [5, 6, 7],  // WRONG per cwendt94 - should be [5] or [5,8,9,10]
  'DH': [8],        // WRONG per cwendt94 - should be [11]
  'UTIL': [9],      // WRONG per cwendt94 - should be [12]
  'SP': [11],       // WRONG per cwendt94 - should be [14]
  'RP': [12],       // WRONG per cwendt94 - should be [15]
  'P': [10, 11, 12], // WRONG per cwendt94 - should be [13,14,15]
  'ALL': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
};
```

### Correct Mapping (per cwendt94)

```typescript
export const POSITION_SLOTS: Record<string, number[]> = {
  'C': [0],
  '1B': [1],
  '2B': [2],
  '3B': [3],
  'SS': [4],
  'OF': [5],
  'MI': [6],      // Middle Infielder (2B/SS)
  'CI': [7],      // Corner Infielder (1B/3B)
  'LF': [8],
  'CF': [9],
  'RF': [10],
  'DH': [11],
  'UTIL': [12],
  'P': [13],
  'SP': [14],
  'RP': [15],
  'BE': [16],
  'IL': [17],
  'IF': [19],
};
```

### Verification Needed

**Verify by using filterSlotIds in API requests:**

1. Make a free agent request with `filterSlotIds: {"value": [14]}`
2. Confirm only starting pitchers are returned
3. Repeat for other slot IDs

---

## MAPPING 4: STATS_MAP (Statistics)

### Current Code vs cwendt94 (DISCREPANCIES EXIST)

| Stat ID | Our Code | cwendt94 | Status |
|---------|----------|----------|--------|
| 0 | AB | AB | ✓ Match |
| 1 | H | H | ✓ Match |
| 2 | AVG | AVG | ✓ Match |
| 3 | HR | 2B | ❌ Different |
| 4 | R | 3B | ❌ Different |
| 5 | RBI | HR | ❌ Different |
| 6 | SB | XBH | ❌ Different |
| 7 | 2B | 1B | ❌ Different |
| ... | ... | ... | Need full comparison |

### Verification Needed

1. Query player stats from Fantasy API v3
2. Find a player with known stats (e.g., from ESPN website)
3. Match the stat values to determine which mapping is correct

**Note:** Different API views may return stats in different formats. Test with `view=kona_player_info` and other views.

---

## FILES TO UPDATE AFTER VERIFICATION

1. **`workers/espn-client/src/sports/baseball/mappings.ts`**
   - PRO_TEAM_MAP (lines 127-158)
   - POSITION_MAP (lines 9-22)
   - LINEUP_SLOT_MAP (lines 25-38)
   - POSITION_SLOTS (lines 172-188)
   - Possibly BATTING_STATS_MAP and PITCHING_STATS_MAP

2. **`workers/baseball-espn-mcp/src/transforms/baseball.ts`**
   - Same constants duplicated here

3. **`workers/baseball-espn-mcp/src/espn.ts`**
   - POSITION_SLOTS (lines 136-152)

---

## API ENDPOINTS FOR VERIFICATION

### Get Player Data (includes proTeamId, defaultPositionId, eligibleSlots)
```
GET https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2025/players?scoringPeriodId=0&view=players_wl
```

### Get Pro Team Schedules (team IDs and names)
```
GET https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2025?view=proTeamSchedules
```

### Get Free Agents with Position Filter
```
GET https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2025/segments/0/leagues/{LEAGUE_ID}?view=kona_player_info

Header: X-Fantasy-Filter: {"players":{"filterSlotIds":{"value":[14]},"filterStatus":{"value":["FREEAGENT"]},"limit":10}}
```

### Get League Settings (roster slot configuration)
```
GET https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2025/segments/0/leagues/{LEAGUE_ID}?view=mSettings
```

---

## SUMMARY FOR VERIFICATION AI

1. **Trust cwendt94/espn-api** as the starting point - it's well-tested
2. **Only use Fantasy API v3** (`lm-api-reads.fantasy.espn.com`)
3. **Verify team-by-team** using player data
4. **Verify position-by-position** using defaultPositionId and eligibleSlots
5. **Document any discrepancies** from cwendt94
6. **Note any undocumented IDs** (like ID 18 for positions)

The goal is to produce a verified, authoritative mapping that can be used to fix the codebase.
