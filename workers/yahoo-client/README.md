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

Player entries omit `team` and `status` on any historical (`week`/`date`) snapshot, and the response adds `limitations: { playerProTeamAvailable: false }` (FLA-278). Yahoo's roster player object exposes `editorial_team_abbr`/`status` as the player's CURRENT club and CURRENT status only — there is no historical value in this payload for a past week/date, so a player traded or whose status changed since would otherwise show present-day facts mislabeled as historical. Current-roster entries are unaffected.

### Keeper / League-Format Context (FLA-284)

**Status: coded and fixture-tested only, not live-verified.** Yahoo API access has been cut since 2026-07-27 (FLA-237); the fields below are shaped from real captured fixtures and Yahoo's own (sparse) documentation, not a live call against this worker. Treat them as best-effort until FLA-237 clears and a live check runs.

`get_roster`, `get_free_agents`, and `get_players` (`search-players.ts`) each emit an optional `isKeeper: { status: boolean, cost, kept: boolean }` per player, sourced from Yahoo's `is_keeper` field, when Yahoo returns it — omitted entirely otherwise. Notes:
- `is_keeper` is **undocumented** — it does not appear in Yahoo's published API samples. It was reverse-engineered from real captured league fixtures and could change silently; some third-party Yahoo API clients explicitly ignore it for that reason.
- `status`/`kept` are normalized from whatever representation Yahoo sends (native booleans, `"0"`/`"1"` strings, `"true"`/`"false"` strings case-insensitive/trimmed, or `0`/`1` numbers — all appear elsewhere in this API) to plain booleans. An encoding that isn't recognized normalizes to `undefined` (omitted from the JSON response) rather than being guessed at — it is never coerced to `true`. `cost` is passed through unchanged — every known capture shows it `false`; no confirmed populated example exists, so there's no known shape to normalize it to.
- `is_keeper` was **observed** on every player object in the captured roster, player-collection, and free-agent fixtures for a keeper-format league, with `status`/`kept` explicitly `false` for non-kept players rather than merely absent. Its universality across all Yahoo resources/league configs is unverified — Yahoo doesn't document the field at all, let alone when it's guaranteed to be present — so treat "always present for keeper leagues" as this worker's working assumption from fixtures, not a documented guarantee. `isKeeper` is omitted when the field itself is absent from Yahoo's response (i.e. the league isn't keeper-format, Yahoo didn't return it for this resource, or a future/unobserved response shape simply lacks it); when the field is present but its `status`/`kept` sub-values use an unrecognized encoding, `isKeeper` is still emitted with those keys individually `undefined`.
- Not gated by roster historical-snapshot logic (unlike `team`/`status`, see above): keeper designation is a season-long constant set pre-draft, not a point-in-time club/status fact, so the FLA-278 temporal-purity rule doesn't apply here.
- Yahoo also supports a `league/{key}/players;status=K` filter that lists every keeper-designated player league-wide in one call. It is **not used** by this worker — the tools above already carry `is_keeper` per player at no extra fetch cost, and a dedicated keeper-listing tool is out of scope for this phase.

`get_league_info` adds one more fetch, `GET /league/{key}/settings`, and emits `draftType`, `isAuctionDraft`, `canTradeDraftPicks`, `tradeEndDate`, `tradeRatifyType`, `tradeRejectTime`, `usesFaab`, and `isProLeague` (already present on the `/teams` response's league metadata — no extra fetch needed) when available. **Important: Yahoo's API exposes no keeper configuration at all** — no `max_keepers`, no `uses_keeper` flag, no keeper deadline, no cost rule. Yahoo's own help content says as much: "there is no setting to signify being a keeper league." Keeper cost on Yahoo is always a league-specific house rule the commissioner enforces manually — Flaim cannot read or compute it.

The `/settings` fetch runs **sequentially after** `/teams`, not concurrently with it: Yahoo's aggressive throttling (HTTP 999) is sensitive to concurrent requests per the team's operating posture, so this worker deliberately avoids firing them in parallel.

The `/settings` fetch degrades independently and can never fail `get_league_info`: if it 404s/5xxs, times out, rejects outright, or returns an unexpected shape, the response still returns exactly what `/teams` alone would have (unchanged from before this fetch existed) plus a `warning: "LEAGUE_SETTINGS_UNAVAILABLE: ..."` string, matching this worker's existing `get_transactions` degrade-with-warning convention. It never throws out of the handler.

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

`get_transactions` Yahoo-specific behavior:
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
- `toYahooBoolean()` - Normalizes a boolean flag that may arrive as a native boolean, `"0"`/`"1"` string, or `0`/`1` number, depending on resource
- `toYahooFiniteNumber()` - Parses a numeric field that may arrive as a string

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
