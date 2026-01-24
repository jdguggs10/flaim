# ESPN Football Mappings (Fantasy API v3)

This document explains the **football mapping conventions** used by the `espn-client` worker: what the mappings are, **how they were derived**, and **why they exist**. It is intentionally concise and avoids implementation detail beyond what is needed to understand and validate the mappings.

**Last verified:** 2026-01-23
**Scope:** ESPN Fantasy Football API v3 (`lm-api-reads.fantasy.espn.com`)

---

## Why mappings exist

ESPN Fantasy Football uses **internal numeric IDs** for teams, positions, roster slots, and injury statuses. These IDs:

- **Do not match** ESPN's public sports API IDs
- **Do not match** NFL team IDs you might expect
- **Use different ID spaces** for player positions vs roster slots

To make the data readable and filterable for MCP tools, we map these IDs to canonical names.

---

## Two different position ID spaces

ESPN uses **two related but distinct position ID systems**:

1) **`defaultPositionId` (player's natural position)** - e.g., `1 = QB`
2) **`lineupSlotId` / `eligibleSlots` (roster slot positions)** - e.g., `0 = QB slot`

Football is simpler than baseball here (the IDs are more aligned), but we still maintain **two separate maps** for consistency with the baseball architecture and to avoid future bugs.

---

## Mapping summary (football)

All mappings live in:
- `workers/espn-client/src/sports/football/mappings.ts`

### 1) Player Positions (defaultPositionId → POSITION_MAP)

| ID | Position |
|----|----------|
| 1 | QB |
| 2 | RB |
| 3 | WR |
| 4 | TE |
| 5 | K |
| 16 | D/ST |

### 2) Roster Slot Positions (lineupSlotId → LINEUP_SLOT_MAP)

| ID | Slot |
|----|------|
| 0 | QB |
| 2 | RB |
| 4 | WR |
| 6 | TE |
| 17 | K |
| 16 | D/ST |
| 23 | FLEX (RB/WR/TE) |
| 20 | Bench |
| 21 | IR |

### 3) Pro Team IDs (proTeamId → PRO_TEAM_MAP)

| ID | Team | ID | Team |
|----|------|----|------|
| 0 | FA | 17 | NE |
| 1 | ATL | 18 | NO |
| 2 | BUF | 19 | NYG |
| 3 | CHI | 20 | NYJ |
| 4 | CIN | 21 | PHI |
| 5 | CLE | 22 | ARI |
| 6 | DAL | 23 | PIT |
| 7 | DEN | 24 | LAC |
| 8 | DET | 25 | SF |
| 9 | GB | 26 | SEA |
| 10 | TEN | 27 | TB |
| 11 | IND | 28 | WSH |
| 12 | KC | 29 | CAR |
| 13 | LV | 30 | JAX |
| 14 | LAR | 33 | BAL |
| 15 | MIA | 34 | HOU |
| 16 | MIN | | |

Note: IDs 31-32 are not assigned (expansion slots or historical gaps).

### 4) Injury Status (INJURY_STATUS_MAP)

| Code | Display |
|------|---------|
| ACTIVE | Active |
| OUT | Out |
| QUESTIONABLE | Questionable |
| DOUBTFUL | Doubtful |
| INJURY_RESERVE | IR |
| SUSPENSION | Suspended |
| PROBABLE | Probable |
| DAY_TO_DAY | Day-to-Day |

### 5) Free Agent Slot Filters (POSITION_SLOTS)

Named filters map to roster slot IDs for `filterSlotIds` in ESPN free agent queries:

| Filter | Slot IDs |
|--------|----------|
| QB | [0] |
| RB | [2] |
| WR | [4] |
| TE | [6] |
| K | [17] |
| D/ST | [16] |
| DST | [16] (alias) |
| FLEX | [23] |
| ALL | [0, 2, 4, 6, 16, 17, 23] |

### 6) Player Stats (STATS_MAP)

Football stats are organized by category. Unlike baseball (which splits batting/pitching), football uses a single `STATS_MAP` since players can accumulate stats across multiple categories (e.g., a QB with rushing yards).

| ID Range | Category | Key Stats |
|----------|----------|-----------|
| 0-22 | Passing | passAtt, passCmp, passYds, passTD, passINT |
| 23-40 | Rushing | rushAtt, rushYds, rushTD, rushYPA |
| 41-61 | Receiving | rec, recYds, recTD, recTgt, recYAC |
| 62-73 | Misc Offense | fum, fumLost, TO, sacked |
| 74-88 | Kicking | FGM, FGA, XPM, XPA (by distance) |
| 89-136 | Defense/ST | defSack, defINT, defTD, defPtsAllow |
| 155+ | Head Coach | hcWin, hcLoss, margin-of-victory bonuses |

See `mappings.ts` for complete stat ID list with inline comments.

---

## How the mappings were derived

1) **Authoritative baseline**
   - Cross-referenced the community-maintained `cwendt94/espn-api` football constants.

2) **Fantasy API v3 verification**
   - Inspected live league data for:
     - `defaultPositionId` on players
     - `lineupSlotId` on roster entries
     - `eligibleSlots` arrays
     - `proTeamId` values
   - Correlated with known NFL team/player data.

3) **espn-api library validation**
   - Confirmed POSITION_SLOTS values match the library's free agent implementation.

---

## Verification endpoints (Fantasy API v3)

Use **Fantasy API v3** only:

```
https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{YEAR}/players?scoringPeriodId=0&view=players_wl
https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{YEAR}?view=proTeamSchedules
https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{YEAR}/segments/0/leagues/{LEAGUE_ID}?view=mRoster
https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{YEAR}/segments/0/leagues/{LEAGUE_ID}?view=mSettings
```

Do **not** use the public ESPN sports API for verification; it uses a different ID system.

---

## Differences from baseball

| Aspect | Football | Baseball |
|--------|----------|----------|
| Position complexity | Simple (6 positions) | Complex (11 positions) |
| Roster slots | Fewer (9 slots) | Many (19+ slots) |
| Stats mapping | Single STATS_MAP | Split BATTING/PITCHING maps |
| ID alignment | Position/slot IDs similar | Position/slot IDs very different |

Football uses a single `STATS_MAP` because players can accumulate stats across categories (QB with rushing yards). Baseball splits into `BATTING_STATS_MAP` and `PITCHING_STATS_MAP` because players are typically one or the other.

---

## Why this matters for MCP tools

The unified MCP tools (`get_roster`, `get_free_agents`, `get_standings`) rely on these mappings to:

- Render correct player positions
- Filter free agents by slots accurately
- Show proper team abbreviations and injury statuses
- Transform stats to readable names (passYds, rushTD, etc.)

Keeping the mappings accurate prevents user-facing errors and avoids subtle AI misinterpretations.
