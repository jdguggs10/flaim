# Yahoo Football Feature Parity Design

**Date:** 2026-01-28

**Goal:** Add `get_matchups` and `get_free_agents` handlers to yahoo-client to achieve feature parity with ESPN (5/5 tools).

## Current State

Yahoo Football has 3/5 handlers working:
- `get_league_info` ✅
- `get_standings` ✅
- `get_roster` ✅
- `get_matchups` ❌ (this design)
- `get_free_agents` ❌ (this design)

## Architecture

Both new handlers follow the existing pattern:
1. Get credentials via `getYahooCredentials()`
2. Call Yahoo API via `yahooFetch()`
3. Parse response using existing normalizers
4. Return normalized response matching ESPN shape

**Files to modify:**
- `workers/yahoo-client/src/sports/football/handlers.ts` — Add 2 handlers
- `workers/yahoo-client/src/sports/football/mappings.ts` — Add position filter mapping

No gateway changes needed — routing already works for `platform: "yahoo"`.

## Yahoo API Endpoints

| Tool | Endpoint | Parameters |
|------|----------|------------|
| `get_matchups` | `/league/{league_key}/scoreboard` | `;week={N}` (optional) |
| `get_free_agents` | `/league/{league_key}/players` | `;status=FA`, `;count={N}`, `;position={POS}` |

Consistent with existing handlers:
- `get_league_info`: `/league/{league_key}`
- `get_standings`: `/league/{league_key}/standings`
- `get_roster`: `/team/{team_key}/roster;week={N}`

## Response Shapes

### get_matchups

```typescript
{
  leagueKey: string,
  leagueName: string,
  currentWeek: number,
  matchupWeek: number,
  matchups: [{
    matchupId: number,
    week: number,
    home: { teamKey, teamName, points, projectedPoints },
    away: { teamKey, teamName, points, projectedPoints },
    winner?: string,
  }]
}
```

### get_free_agents

```typescript
{
  leagueKey: string,
  leagueName: string,
  position: string,
  count: number,
  freeAgents: [{
    playerKey: string,
    playerId: string,
    name: string,
    team: string,
    position: string,
    percentOwned?: number,
    status?: string,
  }]
}
```

## Error Handling

Reuse existing patterns:
- `requireCredentials()` — `YAHOO_NOT_CONNECTED`
- `handleYahooError()` — maps 401/403/404/429
- `extractErrorCode()` — extracts code from message

## Testing

Manual E2E via chat app + Cloudflare logs (same as Phase 2 testing).
No new unit tests — existing normalizer tests cover parsing logic.

## Edge Cases

| Case | Handling |
|------|----------|
| No matchups for week | Return empty `matchups: []` |
| No free agents | Return empty `freeAgents: []` |
| Invalid week | Pass Yahoo API error through |
| Invalid position | Default to `ALL` |
