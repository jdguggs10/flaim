# ESPN Baseball Mappings (Fantasy API v3)

This document explains the **baseball mapping conventions** used by the `espn-client` worker: what the mappings are, **how they were derived**, and **why they exist**. It is intentionally concise and avoids implementation detail beyond what is needed to understand and validate the mappings.

**Last verified:** 2026-01-23  
**Scope:** ESPN Fantasy Baseball API v3 (`lm-api-reads.fantasy.espn.com`)

---

## Why mappings exist

ESPN Fantasy Baseball uses **internal numeric IDs** for teams, positions, roster slots, and stats. These IDs:

- **Do not match** ESPN’s public sports API IDs
- **Do not match** MLB team IDs you might expect
- **Use different ID spaces** for player positions vs roster slots

To make the data readable and filterable for MCP tools, we map these IDs to canonical names.

---

## Critical: two different position ID spaces

ESPN uses **two unrelated position ID systems**:

1) **`defaultPositionId` (player’s natural position)**
2) **`lineupSlotId` / `eligibleSlots` (roster slot positions)**

These must **never** be merged into a single map. Example:

- `defaultPositionId = 6` → **SS**
- `eligibleSlots = [6]` → **MI slot**

The `espn-client` worker keeps **two separate maps** to avoid the historical bug where these were conflated.

---

## Mapping summary (baseball)

All mappings live in:
- `workers/espn-client/src/sports/baseball/mappings.ts`

### 1) Pro Team IDs → Abbreviations

`proTeamId` → `MLB team abbreviation`

Validated against ESPN Fantasy API v3 player data and team schedules. The fantasy API uses a **unique ID order** (e.g., `1 = BAL`, `15 = ATL`), which is **different from ESPN’s public API**.

### 2) Player Positions (defaultPositionId)

`defaultPositionId` → `SP, C, 1B, 2B, 3B, SS, LF, CF, RF, DH, RP`

Derived by correlating a player’s known MLB position with their `defaultPositionId` in league roster data.

### 3) Roster Slot Positions (lineupSlotId / eligibleSlots)

`lineupSlotId` and `eligibleSlots` → `C, 1B, 2B, 3B, SS, OF, MI, CI, LF, CF, RF, DH, UTIL, P, SP, RP, BE, IL, IF`

This map covers **active roster slots** and **eligibility-only slots** (like `MI`, `CI`, `IF`) used for filtering.

### 4) Free Agent Slot Filters (POSITION_SLOTS)

Named filters (e.g., `OF`, `INFIELD`, `PITCHER`) map to multiple roster slot IDs to allow multi-slot queries.

### 5) Stat IDs (batting & pitching)

Fantasy stat IDs (e.g., `R`, `HR`, `ERA`, `K`) are mapped to ESPN’s internal stat IDs so MCP tools can read and label stat output correctly.

---

## How the mappings were derived

1) **Authoritative baseline**
   - Cross-referenced the community-maintained `cwendt94/espn-api` baseball constants (widely used and actively maintained).

2) **Fantasy API v3 verification**
   - Sampled a live league (ID `30201`) and inspected:
     - `defaultPositionId`
     - `lineupSlotId`
     - `eligibleSlots`
     - `proTeamId`
   - Correlated with real player positions to confirm the ID → position meaning.

3) **Roster slot confirmation**
   - Compared ESPN’s official roster slot names to the IDs observed in `eligibleSlots` and `lineupSlotCounts`.

4) **Stats validation**
   - Verified stat IDs against known output in league data and the community constants to correct historical misalignment.

---

## Verification endpoints (Fantasy API v3)

Use **Fantasy API v3** only:

```
https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/{YEAR}/players?scoringPeriodId=0&view=players_wl
https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/{YEAR}?view=proTeamSchedules
https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/{YEAR}/segments/0/leagues/{LEAGUE_ID}?view=mRoster
https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/{YEAR}/segments/0/leagues/{LEAGUE_ID}?view=mSettings
```

Do **not** use the public ESPN sports API for verification; it uses a different ID system.

---

## Investigated unknowns (slot IDs 18, 21, 22)

Three roster slot IDs appear in ESPN data without official documentation. After thorough investigation (Feb 2026), here is what we know.

### Community status

The authoritative community reference [`cwendt94/espn-api` baseball/constant.py](https://github.com/cwendt94/espn-api/blob/master/espn_api/baseball/constant.py) explicitly notes:

> `# 18, 21, 22 have appeared but unknown what position they correspond to`

After years of active community development, these remain unmapped there as well.

### Cross-sport slot ID pattern

ESPN follows a consistent pattern across sports: the slot immediately after the IL/IR slot is an internal/reserved ID that is never assigned to players.

| Sport | Bench | IL/IR | Next slot(s) |
|-------|-------|-------|--------------|
| **Baseball** | 16 (BE) | 17 (IL) | **18=?**, 19=IF, **22=?** |
| **Football** | 20 (BE) | 21 (IR) | **22=`''`** (empty), 23=FLEX |
| **Basketball** | 12 (BE) | 13 (IR) | **14=`''`** (empty), 15=Rookie |
| **Hockey** | 7 (Bench) | 8 (IR) | *(no higher IDs)* |

### Per-slot analysis

**Slot 18** — Internal/reserved (safe to ignore)
- Appears **only** in `lineupSlotCounts` (league settings metadata), never on actual player roster entries.
- Follows the cross-sport pattern where the slot after IL/IR is an empty internal placeholder.
- ESPN does **not** offer IL+ in baseball (that is a Yahoo-only feature), ruling that out.

**Slot 21** — Unknown internal slot
- Noted as unknown by `cwendt94/espn-api`; not observed in Flaim production data.
- Likely another internal/reserved slot.

**Slot 22** — Eligibility-only marker for minor-league players
- Observed in `eligibleSlots` arrays on minor-league pitchers, but never as a `lineupSlotId` (i.e., no player is ever *placed* in this slot).
- ESPN does **not** offer dedicated minor-league/NA roster slots (that is also a Yahoo-only feature).
- In football, slot 22 is also `''` (empty/unused).
- Most likely an eligibility-only tag ESPN uses internally to mark minor-league players, similar to how MI (6), CI (7), and IF (19) are eligibility-only slots.

### Practical impact on Flaim

**None.** The current code handles these correctly:
- `getLineupSlotName()` returns `SLOT_18` / `SLOT_22` as graceful fallbacks.
- `transformEligiblePositions()` filters out unknown slots (they return `undefined` from the map and are excluded).
- `console.warn` logging alerts if these appear in unexpected contexts.

No code changes are needed. These IDs are intentionally left out of `LINEUP_SLOT_MAP`.

### Optional future verification

During a live baseball season, you could settle this definitively:
1. Query `?view=mSettings` for a league and check if `lineupSlotCounts[18]` is non-zero.
2. Query `?view=mRoster` and search for any player with `lineupSlotId: 18` or `22`.
3. Inspect a dynasty/keeper league's API response where minor-league pitchers are rostered.

---

## Why this matters for MCP tools

The unified MCP tools (`get_roster`, `get_free_agents`, `get_standings`) rely on these mappings to:

- Render correct player positions
- Filter free agents by slots accurately
- Label stats correctly for AI consumption

Keeping the mappings accurate prevents user-facing errors and avoids subtle AI misinterpretations.
