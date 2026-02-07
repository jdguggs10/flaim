# Basketball & Hockey API Spike

**Date:** 2026-02-07
**Purpose:** Verify ESPN and Yahoo basketball/hockey APIs use the same response structures as football/baseball, and identify any differences that could affect buildout.

## Methodology

This spike was conducted via **code analysis**, not live API probes. We don't currently have basketball/hockey league credentials to test against. Evidence is derived from:
- Existing codebase patterns (game IDs, URL construction, type definitions)
- ESPN onboarding handlers that already define all four sport segments
- Yahoo API documentation and existing normalizer code
- Season year translation logic already implemented for all four sports

Live verification curl commands are provided below for future use when credentials are available.

## Summary

Based on code analysis, ESPN and Yahoo basketball/hockey APIs follow the **same structural patterns** as football/baseball. The buildout can proceed as planned with sport-specific mappings being the primary new work. This conclusion should be re-verified with live probes when basketball/hockey league credentials become available.

## ESPN

### Sport Segments (Game IDs)

| Sport | Game ID | Status |
|-------|---------|--------|
| Football | `ffl` | Implemented |
| Baseball | `flb` | Implemented |
| Basketball | `fba` | Defined in code, not implemented |
| Hockey | `fhl` | Defined in code, not implemented |

Game IDs are already defined in `workers/espn-client/src/onboarding/handlers.ts`.

### URL Pattern

Identical across all sports:
```
https://lm-api-reads.fantasy.espn.com/apis/v3/games/{gameId}/seasons/{YEAR}/segments/0/leagues/{LEAGUE_ID}?view={VIEW}
```

### Season Year Convention

**Key difference:** ESPN uses the **end year** for basketball/hockey seasons.

| Sport | Canonical 2024-25 | ESPN seasonId |
|-------|-------------------|---------------|
| Football | 2024 | 2024 |
| Baseball | 2025 | 2025 |
| Basketball | 2024 | **2025** (end year) |
| Hockey | 2024 | **2025** (end year) |

Translation already exists in `workers/espn-client/src/shared/season.ts` (`toEspnSeasonYear()`).

### Response Shapes

The same `EspnLeagueResponse` types work across all sports. Views (`mSettings`, `mStandings`, `mTeam`, `mRoster`, `mMatchupScore`, `kona_player_info`) return consistent top-level structures.

### What's New for Basketball/Hockey

Only sport-specific **mappings** are needed:
- Position IDs (`defaultPositionId`) — different position systems (G/F/C for basketball; C/LW/RW/D/G for hockey)
- Roster slot IDs (`lineupSlotId`) — separate from position IDs
- Pro team IDs (`proTeamId`) — NBA/NHL team abbreviations
- Stat category IDs — sport-specific stat names

## Yahoo

### League Key Prefixes

| Sport | Game Code (current season) |
|-------|---------------------------|
| Football | `449` |
| Baseball | `396` |
| Basketball | `418` |
| Hockey | `427` |

Note: Game codes are season-specific and change yearly. Current league keys follow `{game_code}.l.{league_id}`.

### URL Pattern

Identical across all sports:
```
https://fantasysports.yahooapis.com/fantasy/v2/{resource}?format=json
```

### Season Year Convention

Yahoo uses the **start year** consistently for all sports. No translation needed.

### Response Shapes

Same XML-to-JSON structure with numeric keys. Existing normalizers (`unwrapLeague()`, `unwrapTeam()`, `asArray()`) work across all sports.

### What's New for Basketball/Hockey

Only sport-specific **mappings** needed:
- Position abbreviation mappings (Yahoo returns readable position strings, simpler than ESPN)
- Position filter values for free agent queries

## Current Implementation Status

| Component | Football | Baseball | Basketball | Hockey |
|-----------|----------|----------|------------|--------|
| Types (`Sport`) | Yes | Yes | Yes | Yes |
| ESPN handlers | Yes | Yes | Stub (error) | Stub (error) |
| Yahoo handlers | Yes | Yes | Stub (error) | Stub (error) |
| ESPN mappings | Yes | Yes | No | No |
| Yahoo mappings | Yes | Yes | No | No |
| Gateway routing | Yes | Yes | Yes (routes, hits stub) | Yes (routes, hits stub) |

Both clients return `"not yet supported"` errors for basketball/hockey — the routing infrastructure is in place.

## Risk Assessment

**Low risk.** The API patterns are identical. Implementation is straightforward:

1. Create `workers/{espn,yahoo}-client/src/sports/{basketball,hockey}/` directories
2. Copy handler structure from football/baseball (5 tools each)
3. Research and implement sport-specific mappings
4. Update router switch cases in both client `index.ts` files
5. Verify ESPN season year translation works correctly

**Main effort:** Researching and verifying the position/stat/team ID mappings for ESPN (undocumented API). Yahoo mappings are simpler since positions are returned as human-readable strings.

## Reproducible Probe Commands

When basketball/hockey league credentials are available, run these to verify response structure parity.

### ESPN Basketball

```bash
# League info (expect: settings, teams, schedule keys at top level)
curl -s "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2026/segments/0/leagues/{LEAGUE_ID}?view=mSettings&view=mTeam" \
  -H "Cookie: espn_s2={S2}; SWID={SWID}" | jq 'keys'
# Expected: ["draftDetail","gameId","id","members","scoringPeriodId","seasonId","segmentId","settings","status","teams"]

# Standings
curl -s "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2026/segments/0/leagues/{LEAGUE_ID}?view=mStandings&view=mTeam" \
  -H "Cookie: espn_s2={S2}; SWID={SWID}" | jq '.teams[0] | keys'
# Expected: includes "record" with "overall" containing wins/losses/ties

# Roster (verify player position IDs exist)
curl -s "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2026/segments/0/leagues/{LEAGUE_ID}?view=mRoster" \
  -H "Cookie: espn_s2={S2}; SWID={SWID}" | jq '.teams[0].roster.entries[0].playerPoolEntry.player | {fullName, defaultPositionId, eligibleSlots}'
# Expected: numeric defaultPositionId and eligibleSlots array (same shape as football/baseball)
```

### ESPN Hockey

```bash
# Same commands as basketball but with fhl game ID
curl -s "https://lm-api-reads.fantasy.espn.com/apis/v3/games/fhl/seasons/2026/segments/0/leagues/{LEAGUE_ID}?view=mSettings&view=mTeam" \
  -H "Cookie: espn_s2={S2}; SWID={SWID}" | jq 'keys'
```

### Yahoo Basketball

```bash
# League info (expect: numeric-keyed object with league metadata)
curl -s "https://fantasysports.yahooapis.com/fantasy/v2/league/nba.l.{LEAGUE_ID}?format=json" \
  -H "Authorization: Bearer {ACCESS_TOKEN}" | jq '.fantasy_content.league | keys'
# Expected: ["0", "1"] numeric keys (same XML-to-JSON pattern as football/baseball)

# Standings
curl -s "https://fantasysports.yahooapis.com/fantasy/v2/league/nba.l.{LEAGUE_ID}/standings?format=json" \
  -H "Authorization: Bearer {ACCESS_TOKEN}" | jq '.fantasy_content.league[1].standings[0].teams | keys'
# Expected: numeric keys with team objects containing "team_standings"
```

### Yahoo Hockey

```bash
# Same commands as basketball but with nhl league prefix
curl -s "https://fantasysports.yahooapis.com/fantasy/v2/league/nhl.l.{LEAGUE_ID}/standings?format=json" \
  -H "Authorization: Bearer {ACCESS_TOKEN}" | jq '.fantasy_content.league[1].standings[0].teams | keys'
```

### Verification Checklist

For each sport+platform probe, confirm:
- [ ] Top-level response keys match football/baseball pattern
- [ ] Team objects contain `record.overall` (ESPN) or `team_standings` (Yahoo)
- [ ] Player objects have `defaultPositionId` + `eligibleSlots` (ESPN) or position abbreviations (Yahoo)
- [ ] Matchup structure has home/away with scores
- [ ] Free agent endpoint returns player pool entries

## Decision

**Proceed with buildout as planned.** No scope changes needed. Basketball/hockey support follows the same patterns with sport-specific data mappings as the only new work.

**Caveat:** This decision is based on code analysis, not live probes. Re-verify with live API calls when credentials are available. If response structures differ, the primary risk is in the mapping layer (position IDs, stat categories), not in the core handler/normalizer code.
