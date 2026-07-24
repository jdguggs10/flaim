# Yahoo Client Worker

Internal Yahoo Fantasy API client used by the unified gateway (`fantasy-mcp`). Handles all Yahoo Fantasy sports data fetching via OAuth 2.0.

> **Note**: Primarily called via service binding from `fantasy-mcp`. Uses OAuth tokens managed by `auth-worker`.

## Purpose

Consolidates all Yahoo Fantasy API interactions for multiple sports into a single worker:
- Football handlers ✅
- Baseball handlers ✅
- Basketball handlers ✅
- Hockey handlers ✅

### Roster Selectors (`get_roster`)

Yahoo's roster resource is sport-sensitive: `;week=` is valid for football only, while baseball/basketball/hockey take `;date=YYYY-MM-DD`. The handler consumes the normalized snapshot request from the gateway and emits the sport-correct selector (or none for the current roster); a wrong selector fails closed with a corrective `INVALID_ROSTER_SNAPSHOT_SELECTOR` error instead of sending a malformed Yahoo request. Responses carry a `snapshot` block identifying current vs `week` vs `date` coverage.

## Architecture

```
fantasy-mcp (gateway)
     |
     v (service binding)
yahoo-client
     |
     +---> Yahoo Fantasy API (fantasysports.yahooapis.com)
     +---> auth-worker (OAuth tokens via service binding)
```

## Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/execute` | POST | Execute tool (internal only) |

### `/execute` Request Format

```typescript
interface ExecuteRequest {
  tool: string;           // e.g., "get_league_info"
  params: {
    sport: 'football' | 'baseball';
    league_id: string;    // Yahoo league_key (e.g., "458.l.120956")
    season_year: number;
    team_id?: string;     // Can be numeric or full team_key
    week?: number;
    position?: string;
    count?: number;
  };
}
```

`/execute` reads end-user auth from the HTTP `Authorization` header and requires `X-Flaim-Internal-Token` for internal calls.

Yahoo auth and rate-limit failures return `success: false` with the matching HTTP status when the handler can classify them. Retryable failures include `retryable: true`, `retry_after`, and a `Retry-After` response header so the MCP gateway can preserve backoff guidance.

## Supported Tools

### Football
- `get_league_info` - League settings and members
- `get_standings` - League standings
- `get_matchups` - Weekly matchups
- `get_roster` - Team roster with player stats
- `get_free_agents` - Available free agents
- `get_players` - Player lookup with market/global ownership context
- `get_transactions` - Recent transactions (adds, drops, waivers, trades)

### Baseball
- `get_league_info` - League settings and members
- `get_standings` - League standings
- `get_matchups` - Weekly matchups (scoring periods)
- `get_roster` - Team roster with player stats
- `get_free_agents` - Available free agents
- `get_players` - Player lookup with market/global ownership context
- `get_transactions` - Recent transactions (adds, drops, waivers, trades)

`get_transactions` Yahoo-specific behavior in v1:
- Explicit `week` is ignored and replaced with a recent 14-day timestamp window.
- `type=waiver` and `type=pending_trade` use Yahoo's pending endpoint for the authenticated user's own team.
- Other supported types use Yahoo's recent league transaction feed.

## Yahoo API Specifics

### OAuth 2.0 Authentication
Unlike ESPN (cookie-based), Yahoo uses OAuth 2.0:
- Access tokens expire after ~1 hour
- Refresh handled automatically by `auth-worker`
- Tokens retrieved via service binding on each request
- Transient refresh and Yahoo rate-limit failures are surfaced as retryable errors rather than reconnect-required auth failures.

### JSON Response Format
Yahoo's JSON is structurally quirky:
- Numeric object keys: `{"0": {...}, "1": {...}}` instead of arrays
- Nested array wrappers: `{league: [0: {...}, 1: {...}]}`
- Mixed data/metadata in same object

**Normalizers handle this:**
- `asArray()` - Converts numeric-keyed objects to arrays
- `unwrapLeague()` - Extracts league data from wrapper arrays
- `unwrapTeam()` - Extracts team data from wrapper arrays
- `getPath()` - Safe deep path traversal

### Resource Keys
Yahoo uses hierarchical keys:
- League key: `{game_id}.l.{league_id}` (e.g., `458.l.120956`)
- Team key: `{league_key}.t.{team_id}` (e.g., `458.l.120956.t.3`)
- Player key: `{game_id}.p.{player_id}`

## Mappings Architecture

Each sport has a dedicated `mappings.ts` file for position translations.

### Per-sport mapping files

| Sport | File | Exports |
|-------|------|---------|
| Football | `src/sports/football/mappings.ts` | `POSITION_MAP`, `FA_POSITION_FILTER`, `getPositionName()`, `getPositionFilter()` |
| Baseball | `src/sports/baseball/mappings.ts` | `POSITION_MAP`, `FA_POSITION_FILTER`, `getPositionName()`, `getPositionFilter()` |

### Position Filter Mapping

Free agent searches require Yahoo-specific position abbreviations:
- Football: `QB`, `RB`, `WR`, `TE`, `K`, `DEF`
- Baseball: `C`, `1B`, `2B`, `3B`, `SS`, `OF`, `SP`, `RP`, `P`

The `FA_POSITION_FILTER` maps user-friendly position strings to Yahoo's expected format.

### Adding a new sport

When adding basketball or hockey:
1. Create `src/sports/{sport}/mappings.ts` with `POSITION_MAP` and `FA_POSITION_FILTER`
2. Create `src/sports/{sport}/handlers.ts` following the football/baseball pattern
3. Update sport router in `src/index.ts`

## Development

```bash
# Run locally from the repository root
corepack pnpm --dir workers/yahoo-client run dev  # Port 8791

# Or directly
corepack pnpm --dir workers/yahoo-client exec wrangler dev --env dev --port 8791

# Run tests
corepack pnpm --dir workers/yahoo-client run test

# Type check
corepack pnpm --dir workers/yahoo-client run type-check
```

## Testing

Unit tests validate Yahoo's quirky JSON parsing:
- `src/shared/__tests__/normalizers.test.ts` - 27 tests for `asArray`, `unwrapLeague`, `unwrapTeam`, `getPath`

## Tech Considerations

- Yahoo access tokens expire after ~1 hour (refresh handled by auth-worker)
- Team keys must be fully qualified for roster endpoints (e.g., `458.l.120956.t.3`, not just `3`)
- Week/period semantics differ by sport (football uses weeks, baseball uses scoring periods)

## Related

- [`fantasy-mcp`](../fantasy-mcp/) - Unified MCP gateway that calls this worker
- [`auth-worker`](../auth-worker/) - Provides Yahoo OAuth tokens and refresh logic
- [`espn-client`](../espn-client/) - Parallel ESPN client worker
