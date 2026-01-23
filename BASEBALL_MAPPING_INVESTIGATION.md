# ESPN Fantasy Baseball API Mapping Investigation

**Date:** 2026-01-22 (Updated with independent verification)
**Branch:** claude/investigate-baseball-mappings-C6qEd

## Executive Summary

After independent verification using **ESPN's own public API** and cross-referencing with the [cwendt94/espn-api](https://github.com/cwendt94/espn-api) library, I've confirmed that **THREE major mapping systems are broken**:

1. **PRO_TEAM_MAP** - COMPLETELY WRONG (every team ID is incorrect)
2. **POSITION_SLOTS** - Wrong for most positions
3. **POSITION_MAP** - Missing IDs 6-11 and 19
4. **STATS_MAP** - Significant discrepancies from verified source

## Verification Methodology

1. **Direct API verification**: Fetched team data from `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams`
2. **Individual team verification**: Confirmed specific teams (13=TEX, 14=TOR, 20=WSH) via ESPN API
3. **Cross-reference**: Compared against cwendt94/espn-api Python library constants
4. **Code analysis**: Reviewed current implementation

---

## 🚨 CRITICAL ISSUE #1: PRO_TEAM_MAP is COMPLETELY WRONG

**This was incorrectly marked as "correct" in the previous investigation.**

### Verified ESPN Team IDs (from ESPN's own API)

| ID | Correct | Our Code Says | Status |
|----|---------|---------------|--------|
| 1 | BAL | ATL | ❌ WRONG |
| 2 | BOS | BAL | ❌ WRONG |
| 3 | LAA | BOS | ❌ WRONG |
| 4 | CHW | CHC | ❌ WRONG |
| 5 | CLE | CWS | ❌ WRONG |
| 6 | DET | CIN | ❌ WRONG |
| 7 | KC | CLE | ❌ WRONG |
| 8 | MIL | COL | ❌ WRONG |
| 9 | MIN | DET | ❌ WRONG |
| 10 | NYY | HOU | ❌ WRONG |
| 11 | OAK | KC | ❌ WRONG |
| 12 | SEA | LAA | ❌ WRONG |
| 13 | TEX | LAD | ❌ WRONG |
| 14 | TOR | MIA | ❌ WRONG |
| 15 | ATL | MIL | ❌ WRONG |
| 16 | CHC | MIN | ❌ WRONG |
| 17 | CIN | NYM | ❌ WRONG |
| 18 | HOU | NYY | ❌ WRONG |
| 19 | LAD | OAK | ❌ WRONG |
| 20 | WSH | PHI | ❌ WRONG |
| 21 | NYM | PIT | ❌ WRONG |
| 22 | PHI | SD | ❌ WRONG |
| 23 | PIT | SF | ❌ WRONG |
| 24 | STL | SEA | ❌ WRONG |
| 25 | SD | STL | ❌ WRONG |
| 26 | SF | TB | ❌ WRONG |
| 27 | COL | TEX | ❌ WRONG |
| 28 | MIA | TOR | ❌ WRONG |
| 29 | ARI | WSH | ❌ WRONG |
| 30 | TB | ARI | ❌ WRONG |

**Impact:** Every player's team affiliation is displayed incorrectly.

### Correct PRO_TEAM_MAP (verified from ESPN API)

```typescript
export const PRO_TEAM_MAP: Record<number, string> = {
  0: 'FA',    // Free Agent
  1: 'BAL',   // Baltimore Orioles
  2: 'BOS',   // Boston Red Sox
  3: 'LAA',   // Los Angeles Angels
  4: 'CHW',   // Chicago White Sox
  5: 'CLE',   // Cleveland Guardians
  6: 'DET',   // Detroit Tigers
  7: 'KC',    // Kansas City Royals
  8: 'MIL',   // Milwaukee Brewers
  9: 'MIN',   // Minnesota Twins
  10: 'NYY',  // New York Yankees
  11: 'OAK',  // Oakland Athletics (Sacramento 2025-2027, Las Vegas 2028+)
  12: 'SEA',  // Seattle Mariners
  13: 'TEX',  // Texas Rangers
  14: 'TOR',  // Toronto Blue Jays
  15: 'ATL',  // Atlanta Braves
  16: 'CHC',  // Chicago Cubs
  17: 'CIN',  // Cincinnati Reds
  18: 'HOU',  // Houston Astros
  19: 'LAD',  // Los Angeles Dodgers
  20: 'WSH',  // Washington Nationals
  21: 'NYM',  // New York Mets
  22: 'PHI',  // Philadelphia Phillies
  23: 'PIT',  // Pittsburgh Pirates
  24: 'STL',  // St. Louis Cardinals
  25: 'SD',   // San Diego Padres
  26: 'SF',   // San Francisco Giants
  27: 'COL',  // Colorado Rockies
  28: 'MIA',  // Miami Marlins
  29: 'ARI',  // Arizona Diamondbacks
  30: 'TB',   // Tampa Bay Rays
};
```

**Source:** ESPN MLB Teams API: `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams`

---

## 🚨 CRITICAL ISSUE #2: POSITION_SLOTS Mapping is Wrong

### Current vs Correct Mapping

| Position | Current ID | Correct ID | Status |
|----------|-----------|------------|--------|
| C | [0] | [0] | ✅ OK |
| 1B | [1] | [1] | ✅ OK |
| 2B | [2] | [2] | ✅ OK |
| 3B | [3] | [3] | ✅ OK |
| SS | [4] | [4] | ✅ OK |
| LF | [5] | [8] | ❌ WRONG |
| CF | [6] | [9] | ❌ WRONG |
| RF | [7] | [10] | ❌ WRONG |
| OF | [5,6,7] | [5] or [5,8,9,10] | ❌ WRONG |
| DH | [8] | [11] | ❌ WRONG |
| UTIL | [9] | [12] | ❌ WRONG |
| SP | [11] | [14] | ❌ WRONG |
| RP | [12] | [15] | ❌ WRONG |
| P | [10,11,12] | [13,14,15] | ❌ WRONG |

### Correct POSITION_SLOTS (from cwendt94/espn-api)

```typescript
export const POSITION_SLOTS: Record<string, number[]> = {
  'C': [0],
  '1B': [1],
  '2B': [2],
  '3B': [3],
  'SS': [4],
  'OF': [5],      // General outfield slot
  'MI': [6],      // Middle Infielder (2B/SS)
  'CI': [7],      // Corner Infielder (1B/3B)
  'LF': [8],
  'CF': [9],
  'RF': [10],
  'DH': [11],
  'UTIL': [12],
  'P': [13],      // General pitcher
  'SP': [14],
  'RP': [15],
  'BE': [16],     // Bench
  'IL': [17],     // Injured List
  'IF': [19],     // Infield (1B/2B/SS/3B)

  // Convenience groupings
  'OUTFIELD': [5, 8, 9, 10],
  'PITCHER': [13, 14, 15],
  'ALL': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
};
```

**Source:** [cwendt94/espn-api baseball/constant.py](https://github.com/cwendt94/espn-api/blob/master/espn_api/baseball/constant.py)

---

## 🔴 ISSUE #3: POSITION_MAP Missing IDs

The current POSITION_MAP is missing IDs 6-11 and 19.

### Correct POSITION_MAP

```typescript
export const POSITION_MAP: Record<number, string> = {
  0: 'C',
  1: '1B',
  2: '2B',
  3: '3B',
  4: 'SS',
  5: 'OF',
  6: '2B/SS',   // Middle Infielder (MI)
  7: '1B/3B',   // Corner Infielder (CI)
  8: 'LF',
  9: 'CF',
  10: 'RF',
  11: 'DH',
  12: 'UTIL',
  13: 'P',
  14: 'SP',
  15: 'RP',
  16: 'BE',
  17: 'IL',
  19: 'IF',     // Infield
};
```

---

## ⚠️ ISSUE #4: STATS_MAP Has Discrepancies

The cwendt94/espn-api library shows different stat ID mappings:

### Sample Discrepancies (Batting Stats)

| ID | Our Code | cwendt94/espn-api |
|----|----------|-------------------|
| 3 | HR | 2B |
| 4 | R | 3B |
| 5 | RBI | HR |
| 6 | SB | XBH |
| 7 | 2B | 1B |
| 20 | OBP | R |
| 21 | SLG | RBI |

**Recommendation:** The stat mapping needs thorough verification with actual API responses. Either our mapping or the cwendt94 mapping could be correct depending on which view/endpoint is being used.

---

## Files Requiring Updates

1. **`workers/espn-client/src/sports/baseball/mappings.ts`**
   - Fix PRO_TEAM_MAP (lines 127-158) - **CRITICAL**
   - Fix POSITION_SLOTS (lines 172-188) - **CRITICAL**
   - Complete POSITION_MAP (lines 9-22)
   - Complete LINEUP_SLOT_MAP (lines 25-38)

2. **`workers/baseball-espn-mcp/src/transforms/baseball.ts`**
   - Fix PRO_TEAM_MAP
   - Complete POSITION_MAP
   - Complete LINEUP_SLOT_MAP

3. **`workers/baseball-espn-mcp/src/espn.ts`**
   - Fix POSITION_SLOTS (lines 136-152)

---

## Recommended Priority

1. **HIGHEST: Fix PRO_TEAM_MAP** - Every player's team is wrong
2. **HIGH: Fix POSITION_SLOTS** - Free agent filtering is broken
3. **MEDIUM: Complete POSITION_MAP** - Some positions display as POS_X
4. **MEDIUM: Verify STATS_MAP** - Need to test with real API data

---

## Verification Sources

1. **ESPN MLB Teams API** (PRIMARY - authoritative)
   - URL: `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams`
   - Individual: `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/{id}`

2. **cwendt94/espn-api** (well-maintained community library)
   - [Baseball constant.py](https://github.com/cwendt94/espn-api/blob/master/espn_api/baseball/constant.py)
   - [Baseball league.py](https://github.com/cwendt94/espn-api/blob/master/espn_api/baseball/league.py)

3. **ESPN Support Documentation**
   - [Roster Slots - Batters/Pitchers](https://support.espn.com/hc/en-us/articles/360046052652-Roster-Slots-Batters-Pitchers)
   - [Position Eligibility](https://support.espn.com/hc/en-us/articles/360000093592-Position-Eligibility)

---

## Key Insight: ESPN's ID Pattern

ESPN uses a consistent pattern for baseball team IDs where:
- IDs 1-14 are American League teams
- IDs 15-30 are National League teams (with some gaps/variations)
- ID 0 represents Free Agent (no team)

This differs from our current mapping which appears to be alphabetical by team name.
