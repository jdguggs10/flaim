# ESPN Fantasy Baseball API Mapping Investigation

**Date:** 2026-01-23
**Investigator:** Claude
**Branch:** claude/investigate-baseball-mappings-C6qEd

## Executive Summary

After extensive web research and code analysis, **CRITICAL ISSUES** have been identified in the baseball position mappings. The `POSITION_SLOTS` constant used for free agent filtering contains **completely incorrect slot IDs**, causing free agent searches to return wrong results. Additionally, the `POSITION_MAP` is missing several key position IDs (6-11, 18-22).

## Investigation Methodology

1. **Web Research:** Searched ESPN Fantasy Baseball API documentation, reverse engineering resources, and community projects
2. **Primary Source:** Found authoritative mappings in the [cwendt94/espn-api](https://github.com/cwendt94/espn-api) Python library (most popular ESPN Fantasy API wrapper with 1.2k+ stars)
3. **Code Analysis:** Reviewed current implementation in both `espn-client` and `baseball-espn-mcp` workers
4. **Cross-Reference:** Compared with football mappings to understand ESPN's pattern

## Key Findings

### 🚨 CRITICAL ISSUE #1: POSITION_SLOTS Mapping is COMPLETELY WRONG

**Current Implementation (INCORRECT):**
```typescript
// workers/espn-client/src/sports/baseball/mappings.ts:172-188
// workers/baseball-espn-mcp/src/espn.ts:136-152
export const POSITION_SLOTS: Record<string, number[]> = {
  'C': [0],       // ✅ CORRECT
  '1B': [1],      // ✅ CORRECT
  '2B': [2],      // ✅ CORRECT
  '3B': [3],      // ✅ CORRECT
  'SS': [4],      // ✅ CORRECT
  'LF': [5],      // ❌ WRONG! 5 = OF (general outfield), NOT LF
  'CF': [6],      // ❌ WRONG! 6 = MI (2B/SS combo), NOT CF
  'RF': [7],      // ❌ WRONG! 7 = CI (1B/3B combo), NOT RF
  'OF': [5, 6, 7],      // ❌ WRONG! Should be [5] or [8, 9, 10]
  'DH': [8],      // ❌ WRONG! 8 = LF, NOT DH
  'UTIL': [9],    // ❌ WRONG! 9 = CF, NOT UTIL
  'SP': [11],     // ❌ WRONG! 11 = DH, NOT SP
  'RP': [12],     // ❌ WRONG! 12 = UTIL, NOT RP
  'P': [10, 11, 12],    // ❌ WRONG! 10 = RF, NOT P
  'ALL': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
};
```

**Correct Mapping (from cwendt94/espn-api):**
```typescript
export const POSITION_SLOTS: Record<string, number[]> = {
  'C': [0],       // Catcher
  '1B': [1],      // First Base
  '2B': [2],      // Second Base
  '3B': [3],      // Third Base
  'SS': [4],      // Shortstop
  'OF': [5],      // Outfield (general position)
  'MI': [6],      // Middle Infielder (2B/SS combo position)
  'CI': [7],      // Corner Infielder (1B/3B combo position)
  'LF': [8],      // Left Field
  'CF': [9],      // Center Field
  'RF': [10],     // Right Field
  'DH': [11],     // Designated Hitter
  'UTIL': [12],   // Utility
  'P': [13],      // Pitcher (general)
  'SP': [14],     // Starting Pitcher
  'RP': [15],     // Relief Pitcher
  'BE': [16],     // Bench
  'IL': [17],     // Injured List
  'IF': [19],     // Infield (1B/2B/SS/3B combo position)

  // Convenience groupings for filtering
  'OUTFIELD': [5, 8, 9, 10],  // All outfield variants
  'PITCHER': [13, 14, 15],     // All pitcher variants
  'INFIELD': [1, 2, 3, 4, 6, 7, 19],  // All infield positions

  'ALL': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19]
};
```

**Impact:** Free agent filtering is completely broken. When users search for:
- SP (starting pitchers) → Returns DHs (designated hitters)
- LF (left fielders) → Returns general outfielders
- CF (center fielders) → Returns middle infielders
- DH (designated hitters) → Returns left fielders
- And so on...

### 🔴 CRITICAL ISSUE #2: POSITION_MAP is Incomplete

**Current Implementation (INCOMPLETE):**
```typescript
// workers/espn-client/src/sports/baseball/mappings.ts:9-22
export const POSITION_MAP: Record<number, string> = {
  0: 'C',      // Catcher
  1: '1B',     // First Base
  2: '2B',     // Second Base
  3: '3B',     // Third Base
  4: 'SS',     // Shortstop
  5: 'OF',     // Outfield
  // ❌ MISSING: 6, 7, 8, 9, 10, 11
  12: 'UTIL',  // Utility
  13: 'P',     // Pitcher (general)
  14: 'SP',    // Starting Pitcher
  15: 'RP',    // Relief Pitcher
  16: 'BE',    // Bench
  17: 'IL',    // Injured List
  // ❌ MISSING: 18, 19, 20, 21, 22
};
```

**Correct Mapping (from cwendt94/espn-api):**
```typescript
export const POSITION_MAP: Record<number, string> = {
  0: 'C',       // Catcher
  1: '1B',      // First Base
  2: '2B',      // Second Base
  3: '3B',      // Third Base
  4: 'SS',      // Shortstop
  5: 'OF',      // Outfield
  6: '2B/SS',   // Middle Infielder (MI)
  7: '1B/3B',   // Corner Infielder (CI)
  8: 'LF',      // Left Field
  9: 'CF',      // Center Field
  10: 'RF',     // Right Field
  11: 'DH',     // Designated Hitter
  12: 'UTIL',   // Utility
  13: 'P',      // Pitcher (general)
  14: 'SP',     // Starting Pitcher
  15: 'RP',     // Relief Pitcher
  16: 'BE',     // Bench
  17: 'IL',     // Injured List
  // 18: Unknown (observed but undetermined)
  19: 'IF',     // Infield (1B/2B/SS/3B)
  // 20-22: Unknown (may exist but not documented)
};
```

**Impact:** When players have positions 6-11 or 19 in their `defaultPositionId` or `eligibleSlots`, they show as `POS_6`, `POS_7`, etc., instead of proper position names.

### ⚠️ ISSUE #3: LINEUP_SLOT_MAP Needs Verification

**Current Implementation:**
```typescript
// workers/espn-client/src/sports/baseball/mappings.ts:25-38
export const LINEUP_SLOT_MAP: Record<number, string> = {
  0: 'C',
  1: '1B',
  2: '2B',
  3: '3B',
  4: 'SS',
  5: 'OF',
  12: 'UTIL',
  13: 'P',
  14: 'SP',
  15: 'RP',
  16: 'Bench',
  17: 'IL',
};
```

**Analysis:** This mapping appears to be for **lineup slots** (where players are placed in your roster), which may differ from **player positions** (what positions a player is eligible to play). The lineup slot map is missing the same IDs as POSITION_MAP (6-11, 18-22).

**Recommendation:** Lineup slots may need different IDs than position eligibility. Need to verify if ESPN uses the same ID system for both or if they're distinct. Based on the cwendt94/espn-api library, they appear to use the same IDs.

### ✅ ISSUE #4: PRO_TEAM_MAP Appears Correct

**Current Implementation:**
```typescript
// workers/espn-client/src/sports/baseball/mappings.ts:127-158
export const PRO_TEAM_MAP: Record<number, string> = {
  1: 'ATL',   // Atlanta Braves
  2: 'BAL',   // Baltimore Orioles
  3: 'BOS',   // Boston Red Sox
  // ... (all 30 teams mapped)
  30: 'ARI',  // Arizona Diamondbacks
};
```

**Status:** ✅ All 30 MLB teams are correctly mapped. Oakland Athletics (ID 19: 'OAK') is still correct for 2025 season despite relocation plans (temporarily playing in Sacramento, moving to Las Vegas in 2028).

### ⚠️ ISSUE #5: BATTING_STATS_MAP & PITCHING_STATS_MAP Need Verification

**Current Implementation:**
- Batting stats: IDs 0-31 (32 stats)
- Pitching stats: IDs 32-77 (46 stats)

**Status:** Could not find official ESPN documentation for stat IDs. The current mappings look reasonable and follow standard baseball statistics. However, without official docs or API responses to verify against, we cannot be 100% certain these are correct.

**Recommendation:** Test with actual API responses to verify stat IDs match the expected values.

### ⚠️ ISSUE #6: INJURY_STATUS_MAP Appears Standard

**Current Implementation:**
```typescript
export const INJURY_STATUS_MAP: Record<string, string> = {
  ACTIVE: 'Active',
  OUT: 'Out',
  DAY_TO_DAY: 'Day-to-Day',
  INJURY_RESERVE: 'IL (Injured List)',
  SUSPENSION: 'Suspended',
  PATERNITY: 'Paternity Leave',
  BEREAVEMENT: 'Bereavement',
};
```

**Status:** These appear standard and match common injury status codes. No issues identified.

## Understanding ESPN's Position System

Based on research, ESPN uses a dual-concept system:

1. **Player Eligibility (`defaultPositionId`, `eligibleSlots`)**: What positions a player is eligible to play
   - Example: A shortstop might have `eligibleSlots: [4, 6, 12]` meaning SS, MI (2B/SS), and UTIL

2. **Lineup Slots (`lineupSlotId`)**: Where a player is currently slotted in your roster
   - Example: That same shortstop might be in `lineupSlotId: 6` (MI position in your lineup)

Both systems appear to use the **same ID numbering scheme**, which is why POSITION_MAP and LINEUP_SLOT_MAP should be identical or very similar.

## Combo Positions Explained

ESPN Fantasy Baseball includes "combo positions" for roster flexibility:

- **MI (ID 6)**: Middle Infielder - Can be filled by 2B or SS
- **CI (ID 7)**: Corner Infielder - Can be filled by 1B or 3B
- **IF (ID 19)**: Infield - Can be filled by 1B, 2B, 3B, or SS
- **UTIL (ID 12)**: Utility - Can be filled by any position player (not pitchers)

## Files Requiring Updates

### Primary Mapping Files
1. `/home/user/flaim/workers/espn-client/src/sports/baseball/mappings.ts`
   - Fix POSITION_SLOTS (lines 172-188)
   - Complete POSITION_MAP (lines 9-22)
   - Update LINEUP_SLOT_MAP if needed (lines 25-38)

2. `/home/user/flaim/workers/baseball-espn-mcp/src/transforms/baseball.ts`
   - Fix POSITION_MAP (lines 8-21)
   - Update LINEUP_SLOT_MAP (lines 25-38)

3. `/home/user/flaim/workers/baseball-espn-mcp/src/espn.ts`
   - Fix POSITION_SLOTS (lines 136-152)

### Files Using These Mappings
4. `/home/user/flaim/workers/espn-client/src/sports/baseball/handlers.ts`
   - Uses POSITION_SLOTS for free agent filtering (line 12, 342)
   - Will automatically benefit from fixes

## Recommended Actions

### Priority 1: Fix POSITION_SLOTS (CRITICAL)
Update the position slot mappings to correct values in:
- `workers/espn-client/src/sports/baseball/mappings.ts`
- `workers/baseball-espn-mcp/src/espn.ts`

This is **critical** because free agent filtering is completely broken.

### Priority 2: Complete POSITION_MAP
Add missing position IDs (6-11, 19) to:
- `workers/espn-client/src/sports/baseball/mappings.ts`
- `workers/baseball-espn-mcp/src/transforms/baseball.ts`

This will fix display of player positions that currently show as `POS_6`, `POS_7`, etc.

### Priority 3: Update LINEUP_SLOT_MAP
Add missing lineup slot IDs to match POSITION_MAP in:
- `workers/espn-client/src/sports/baseball/mappings.ts`
- `workers/baseball-espn-mcp/src/transforms/baseball.ts`

### Priority 4: Test with Real Data
After fixes, test with actual ESPN API responses to verify:
- Position filtering returns correct players
- Position names display correctly
- Stat IDs match expected values

### Priority 5: Add Tests
Create unit tests to prevent regression:
- Test position ID to name mapping
- Test position filtering logic
- Test that all known position IDs have mappings

## References & Sources

- [cwendt94/espn-api GitHub Repository](https://github.com/cwendt94/espn-api) - Most authoritative community resource
- [espn-api Baseball Constants](https://github.com/cwendt94/espn-api/blob/master/espn_api/baseball/constant.py) - Source of correct mappings
- [ESPN Fantasy Baseball Support - Roster Slots](https://support.espn.com/hc/en-us/articles/360046052652-Roster-Slots-Batters-Pitchers)
- [Using ESPN's Fantasy API (v3)](https://stmorse.github.io/journal/espn-fantasy-v3.html) - API exploration blog
- [ESPN Hidden API Docs](https://gist.github.com/akeaswaran/b48b02f1c94f873c6655e7129910fc3b) - Community documentation
- [Unlocking ESPN's Hidden API Guide](https://zuplo.com/blog/2024/10/01/espn-hidden-api-guide) - Developer guide

## Proposed Solution

I recommend creating a single, authoritative mapping file that can be shared between workers to ensure consistency. This would eliminate the duplication between `espn-client` and `baseball-espn-mcp` workers.

Alternatively, if separation is preferred for architectural reasons, ensure both files are kept in sync and consider adding automated tests to verify consistency.

## Next Steps

1. **Review this investigation** with the team
2. **Prioritize the fixes** based on impact (POSITION_SLOTS is most critical)
3. **Implement corrections** to the mapping constants
4. **Add test coverage** to prevent future regressions
5. **Test with live data** to verify fixes work correctly
6. **Document the mappings** with inline comments explaining combo positions

## Questions for Follow-up

1. Should we consolidate the duplicate mapping constants between workers?
2. Do we have access to a test ESPN Baseball league to verify the fixes?
3. Should we add validation to warn if unknown position IDs are encountered?
4. Do we need to support filtering by combo positions (MI, CI, IF)?
