# Baseball MCP Worker Research

Research conducted January 2026 to inform deepening the baseball MCP worker functionality.

## Current Implementation

### Existing Tools (8 total)

| Tool | ESPN View | Purpose |
|------|-----------|---------|
| `get_user_session` | N/A (auth-worker) | Returns leagues, defaults, season info |
| `get_espn_baseball_league_info` | `mSettings` | League settings and metadata |
| `get_espn_baseball_team_roster` | `mRoster` | Team roster with player entries |
| `get_espn_baseball_matchups` | `mMatchup` | Current/upcoming matchups |
| `get_espn_baseball_standings` | `mStandings` + `mTeam` | League standings |
| `get_espn_baseball_free_agents` | `kona_player_info` | Available free agents with filters |
| `get_espn_baseball_box_scores` | `mMatchupScore` + `mScoreboard` | Detailed matchup statistics |
| `get_espn_baseball_recent_activity` | `kona_league_communication` | Trades, adds, drops, waivers |

### Strengths
- ESPN-prefixed error codes for clear error handling
- Proper auth flow through auth-worker service binding
- Smart league/season normalization with defaults
- Structured logging with masked user IDs
- Multi-season support

---

## ESPN Fantasy API Reference (Verified January 2026)

### Base URL (Updated April 2024)
```
https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/{year}/segments/0/leagues/{leagueId}
```

**Sport Codes:**
- `ffl` - Fantasy Football
- `flb` - Fantasy Baseball
- `fba` - Fantasy Basketball
- `fhl` - Fantasy Hockey

### Authentication
- **Public leagues**: No auth required
- **Private leagues**: Requires cookies: `SWID={swid}; espn_s2={s2}`

As of August 2025, ESPN has tightened historical data access - the `espn_s2` cookie is now required for most league data.

### Common Headers
```
User-Agent: baseball-espn-mcp/1.0
Accept: application/json
X-Fantasy-Source: kona
X-Fantasy-Platform: kona-web-2.0.0
```

### Available Views (query parameter)

| View | Data Returned | Notes |
|------|---------------|-------|
| `mSettings` | League settings, scoring rules, roster slots | |
| `mRoster` | Team rosters with player entries | Requires auth for private |
| `mMatchup` | Matchup schedule and scores | |
| `mMatchupScore` | Detailed matchup statistics | Use with mScoreboard |
| `mScoreboard` | Scoreboard with box scores | Use with mMatchupScore |
| `mStandings` | Team standings and rankings | |
| `mTeam` | Team information | |
| `mDraftDetail` | Draft history and picks | |
| `mLiveScoring` | Live score updates | |
| `mPendingTransactions` | Pending moves | |
| `mSchedule` | Full schedule | |
| `kona_player_info` | Player pool (free agents, all players) | Requires filter header |
| `kona_league_communication` | Recent activity (trades, adds, drops) | |
| `kona_playercard` | Individual player details | |
| `players_wl` | All active players | |
| `proTeamSchedules_wl` | MLB team schedules | |

**Important**: Calling multiple views together can return different results than calling them separately.

### X-Fantasy-Filter Header (Critical for Free Agents)

The `x-fantasy-filter` header enables advanced filtering. Without it, ESPN limits player responses to ~50 records.

**Free Agents Filter:**
```json
{
  "players": {
    "filterStatus": {"value": ["FREEAGENT", "WAIVERS"]},
    "filterSlotIds": {"value": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]},
    "sortPercOwned": {"sortPriority": 1, "sortAsc": false},
    "sortDraftRanks": {"sortPriority": 100, "sortAsc": true, "value": "STANDARD"},
    "limit": 100,
    "offset": 0
  }
}
```

**Single Player Filter:**
```json
{
  "players": {
    "filterIds": {"value": [14876]}
  }
}
```

**Top Owned Players:**
```json
{
  "players": {
    "limit": 50,
    "sortPercOwned": {"sortPriority": 1, "sortAsc": false}
  }
}
```

### Scoring Period Parameter
Use `scoringPeriodId` query parameter for specific day/week stats. Baseball uses daily scoring periods (not weekly like football).

---

## External API Reference (Non-Fantasy)

ESPN also exposes public sports data APIs (no auth required):

### MLB Core Endpoints
```
https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard
https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams
https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/standings
https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/news
```

### Player Data
```
https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/athletes/{id}/overview
https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/athletes/{id}/gamelog
https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/athletes/{id}/splits
```

These could be useful for enriching fantasy data with real MLB stats.

---

## Gap Analysis: Remaining Opportunities

### Potential Future Tools

| Feature | ESPN View | User Value | Complexity |
|---------|-----------|------------|------------|
| Draft History | `mDraftDetail` | Medium - historical context | Low |
| Player Cards | `kona_playercard` | Medium - player deep-dive | Low |
| Live Scoring | `mLiveScoring` | Medium - real-time updates | Low |
| Pending Transactions | `mPendingTransactions` | Low - waiver status | Low |

### Completed ✅

- Free Agents (`kona_player_info` + filter)
- Box Scores (`mMatchupScore` + `mScoreboard`)
- Recent Activity (`kona_league_communication`)
- Data transforms (position/stat ID mappings)

---

## Reference: espn-api Python Library

Source: https://github.com/cwendt94/espn-api

### Baseball Methods Available

```python
league.standings()                    # Teams sorted by standing
league.scoreboard(matchupPeriod)      # Matchups for period
league.recent_activity(size, type)    # Transaction history
league.free_agents(week, size, pos)   # Available players
league.box_scores(matchup, scoring)   # Detailed stats
```

### Position Mapping (from espn-api constants)

```typescript
const POSITION_MAP: Record<number, string> = {
  0: 'C',    // Catcher
  1: '1B',   // First Base
  2: '2B',   // Second Base
  3: '3B',   // Third Base
  4: 'SS',   // Shortstop
  5: 'LF',   // Left Field
  6: 'CF',   // Center Field
  7: 'RF',   // Right Field
  8: 'DH',   // Designated Hitter
  9: 'UTIL', // Utility
  10: 'P',   // Pitcher (general)
  11: 'SP',  // Starting Pitcher
  12: 'RP',  // Relief Pitcher
  13: 'BE',  // Bench
  14: 'IL',  // Injured List
  15: 'IF',  // Infield (combined)
  16: 'OF',  // Outfield (combined)
};
```

### Stat Mapping (subset, from espn-api constants)

```typescript
// Batting stats (IDs 0-31)
const BATTING_STATS: Record<number, string> = {
  0: 'AB',   // At Bats
  1: 'H',    // Hits
  2: 'AVG',  // Batting Average
  3: 'HR',   // Home Runs
  4: 'R',    // Runs
  5: 'RBI',  // Runs Batted In
  6: 'SB',   // Stolen Bases
  17: 'TB',  // Total Bases
  20: 'OBP', // On-Base Percentage
  21: 'SLG', // Slugging
  22: 'OPS', // On-Base + Slugging
  // ... additional stats
};

// Pitching stats (IDs 32-77)
const PITCHING_STATS: Record<number, string> = {
  32: 'IP',   // Innings Pitched
  33: 'W',    // Wins
  34: 'L',    // Losses
  35: 'SV',   // Saves
  36: 'K',    // Strikeouts
  37: 'ERA',  // Earned Run Average
  38: 'WHIP', // Walks + Hits per IP
  41: 'QS',   // Quality Starts
  47: 'K/9', // Strikeouts per 9
  // ... additional stats
};
```

---

## Other Projects Using ESPN Fantasy API

### WaiverWireWinner (Baseball)
Source: https://github.com/aferra12/WaiverWireWinnerV1

Uses ESPN API + MLB Stats API to:
- Monitor rest days since last game
- Calculate Sharpe ratio for player rankings
- Filter free agents by availability
- Send automated recommendations

### ffscrapr (R Package)
Source: https://ffscrapr.ffverse.com/

Wraps ESPN Fantasy API for R users. Good reference for view combinations and filter structures.

### espn-api (Python)
Source: https://github.com/cwendt94/espn-api

Most comprehensive reverse-engineering effort. Supports football, basketball, hockey, baseball.

---

## MCP Best Practices

From the Model Context Protocol specification:

### Tool Structure
- **name**: snake_case identifier
- **title**: Human-readable display name (we're missing this)
- **description**: Clear explanation of purpose
- **inputSchema**: JSON Schema with parameter descriptions
- **outputSchema**: Expected output structure (we're missing this)

### Error Handling
- **Protocol errors**: Invalid requests, unknown tools (-32600 codes)
- **Tool execution errors**: Business logic failures (isError: true)

### Our Compliance Status
- [x] inputSchema with descriptions
- [x] Error handling with isError
- [x] snake_case naming
- [x] title field for display
- [ ] outputSchema for structured results (optional)

---

## Implementation Plan

### Phase 1: New Tools ✅ Complete

#### 1. `get_espn_baseball_free_agents`

**ESPN Endpoint:**
```
GET /games/flb/seasons/{year}/segments/0/leagues/{leagueId}?view=kona_player_info&scoringPeriodId={day}
```

**Required Header:**
```
X-Fantasy-Filter: {"players":{"filterStatus":{"value":["FREEAGENT","WAIVERS"]},"filterSlotIds":{"value":[0,1,2,3,4,5,6,7,11,12]},"sortPercOwned":{"sortPriority":1,"sortAsc":false},"limit":50}}
```

**Tool Schema:**
```typescript
{
  name: 'get_espn_baseball_free_agents',
  title: 'Baseball Free Agents',
  description: 'Get available free agents from ESPN fantasy baseball league',
  inputSchema: {
    type: 'object',
    properties: {
      leagueId: { type: 'string', description: 'League ID from get_user_session' },
      seasonId: { type: 'string', description: 'Season year (optional)' },
      position: {
        type: 'string',
        enum: ['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP', 'ALL'],
        description: 'Filter by position (default ALL)'
      },
      limit: { type: 'number', description: 'Max players (default 25, max 100)' }
    },
    required: ['leagueId']
  }
}
```

#### 2. `get_espn_baseball_box_scores`

**ESPN Endpoint:**
```
GET /games/flb/seasons/{year}/segments/0/leagues/{leagueId}?view=mMatchupScore&view=mScoreboard&scoringPeriodId={day}
```

**Tool Schema:**
```typescript
{
  name: 'get_espn_baseball_box_scores',
  title: 'Baseball Box Scores',
  description: 'Get detailed box scores with player-by-player statistics',
  inputSchema: {
    type: 'object',
    properties: {
      leagueId: { type: 'string', description: 'League ID from get_user_session' },
      seasonId: { type: 'string', description: 'Season year (optional)' },
      matchupPeriod: { type: 'number', description: 'Matchup period/week' },
      scoringPeriod: { type: 'number', description: 'Specific day (optional)' }
    },
    required: ['leagueId']
  }
}
```

#### 3. `get_espn_baseball_recent_activity`

**ESPN Endpoint:**
```
GET /games/flb/seasons/{year}/segments/0/leagues/{leagueId}?view=kona_league_communication
```

**Tool Schema:**
```typescript
{
  name: 'get_espn_baseball_recent_activity',
  title: 'Baseball Recent Activity',
  description: 'Get recent league activity including trades, adds, drops, waiver claims',
  inputSchema: {
    type: 'object',
    properties: {
      leagueId: { type: 'string', description: 'League ID from get_user_session' },
      seasonId: { type: 'string', description: 'Season year (optional)' },
      limit: { type: 'number', description: 'Number of activities (default 25)' },
      type: {
        type: 'string',
        enum: ['ALL', 'WAIVER', 'TRADE', 'FA'],
        description: 'Filter by activity type'
      }
    },
    required: ['leagueId']
  }
}
```

### Phase 2: Data Transforms ✅ Created (not wired)

Created `src/transforms/baseball.ts` with mappings (POSITION_MAP, BATTING_STATS_MAP, PITCHING_STATS_MAP, PRO_TEAM_MAP). Not integrated into tools - raw ESPN data returned. LLMs handle it fine.

### Phase 3: MCP Compliance ✅ Complete

Added `title` field to all 8 tools. `outputSchema` skipped - Claude Code ignores it ([bug #4427](https://github.com/anthropics/claude-code/issues/4427)).

---

## Risk Considerations

### API Stability
ESPN's API is unofficial and undocumented. Changes can happen without notice:
- Base URL changed April 2024
- Authentication tightened August 2025

**Mitigation**: Strong error handling, version logging, graceful degradation.

### Rate Limiting
ESPN may rate-limit aggressive usage.

**Mitigation**: Already have 200 calls/day limit in auth-worker. Consider caching hot data.

### Authentication Expiry
ESPN cookies (`espn_s2`) can expire.

**Mitigation**: Already handle with `ESPN_COOKIES_EXPIRED` error code and user guidance.

---

## Sources

- [ESPN API Python Library](https://github.com/cwendt94/espn-api)
- [MCP Tools Specification](https://modelcontextprotocol.io/docs/concepts/tools)
- [ESPN Fantasy API v3 Guide](https://stmorse.github.io/journal/espn-fantasy-v3.html)
- [ESPN NFL Endpoints Gist](https://gist.github.com/nntrn/ee26cb2a0716de0947a0a4e9a157bc1c)
- [ESPN Hidden API Guide](https://zuplo.com/learning-center/espn-hidden-api-guide)
- [ffscrapr ESPN Endpoints](https://ffscrapr.ffverse.com/articles/espn_getendpoint.html)
- [Public ESPN API Documentation](https://github.com/pseudo-r/Public-ESPN-API)
- [Player Info JSON Views](https://thomaswildetech.com/projects/espn/player-info-json-views/)
- [WaiverWireWinner Baseball Bot](https://github.com/aferra12/WaiverWireWinnerV1)
