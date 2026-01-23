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

## Known unknowns

Two roster slot IDs still appear without confirmed meaning:

| ID | Context | Status |
|----|---------|--------|
| 18 | `lineupSlotCounts` only | Unobserved on players |
| 22 | `eligibleSlots` on minor-league pitchers | Likely NA/Minors, unverified |

If future data confirms these, update the roster slot map and document the source evidence.

---

## Why this matters for MCP tools

The unified MCP tools (`get_roster`, `get_free_agents`, `get_standings`) rely on these mappings to:

- Render correct player positions
- Filter free agents by slots accurately
- Label stats correctly for AI consumption

Keeping the mappings accurate prevents user-facing errors and avoids subtle AI misinterpretations.
