# Transactions API Research — ESPN, Yahoo, Sleeper

**Date:** 2026-02-23
**Status:** Research complete, no implementation yet
**Purpose:** Evaluate feasibility of a `get_transactions` MCP tool covering adds, drops, trades, and waiver claims across all three platforms.
**Verification note (2026-02-23):** Claims were revalidated against external sources. Sleeper and Yahoo are backed by official/published docs; ESPN details remain community-verified (unofficial API surface).

---

## Summary

All three platforms expose transaction history. Feasibility is high for Sleeper and Yahoo (documented surfaces), and high-but-unofficial for ESPN (community-maintained API knowledge). No platform has a single universal "get all transactions for a season" endpoint that is ideal for MCP latency — each requires either per-week iteration (ESPN `mTransactions2`, Sleeper) or paginated feed iteration (Yahoo/ESPN activity feed). Trades require special handling on ESPN.

| Platform | Endpoint Style | Auth Required | Trade Support | Pagination |
|---|---|---|---|---|
| ESPN | Two distinct patterns (structured + activity feed) | espn_s2 + SWID cookies | Via activity feed (message IDs) | Per scoring period OR offset-based |
| Yahoo | Single REST endpoint with matrix params | OAuth 2.0 bearer token | Yes, `type=trade` | `count` limit only (no cursor) |
| Sleeper | Per-week endpoint, iterate all weeks | None (public API) | Yes, `type=trade` | None (per-week call) |

---

## ESPN

**Confidence level:** Medium. Endpoint behavior is verified through mature community libraries and reverse-engineered references, not an official ESPN Fantasy API specification.

### Base URL

```
https://lm-api-reads.fantasy.espn.com/apis/v3/games/{sport}/seasons/{year}/segments/0/leagues/{leagueId}
```

Sport codes: `ffl` (football), `flb` (baseball), `fba` (basketball), `fhl` (hockey)

Note: community clients use `https://lm-api-reads.fantasy.espn.com/apis/v3/...` as the stable host. The legacy `https://fantasy.espn.com/apis/v3/...` path may redirect but should not be relied on.

### Authentication

Private leagues (all Flaim users) require two cookies:
- `espn_s2` — long auth token
- `SWID` — user GUID (`{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}`)

Passed as HTTP `Cookie` header. Username/password auth via API is no longer supported. These are already captured by the Flaim Chrome extension.

### Two Distinct Approaches

ESPN exposes transactions via two completely different mechanisms. They serve different use cases and return different shapes.

---

#### Approach A: `mTransactions2` view (structured records, per-week)

Best for: structured add/drop/waiver data with bid amounts, per scoring period.

**Request:**
```
GET .../leagues/{leagueId}?view=mTransactions2&scoringPeriodId={week}
x-fantasy-filter: {"transactions":{"filterType":{"value":["FREEAGENT","WAIVER","WAIVER_ERROR"]}}}
```

To include trades, add `"TRADE_ACCEPT"` to the filter array (reliability varies — see caveats).

**Full list of known `filterType` values:**
```
DRAFT, FREEAGENT, WAIVER, WAIVER_ERROR,
TRADE_ACCEPT, TRADE_PROPOSAL, TRADE_DECLINE,
TRADE_VETO, TRADE_UPHOLD, TRADE_ERROR,
ROSTER, RETRO_ROSTER, FUTURE_ROSTER
```

**Response shape:**
```json
{
  "transactions": [
    {
      "teamId": 3,
      "type": "FREEAGENT",
      "status": "EXECUTED",
      "scoringPeriodId": 7,
      "processDate": 1699200000000,
      "proposedDate": 1699100000000,
      "bidAmount": 15,
      "items": [
        { "playerId": 4362887, "type": "ADD", "fromTeamId": 0, "toTeamId": 3 },
        { "playerId": 3054220, "type": "DROP", "fromTeamId": 3, "toTeamId": 0 }
      ]
    }
  ]
}
```

Key fields:
- `type`: `FREEAGENT`, `WAIVER`, `WAIVER_ERROR`, `TRADE_ACCEPT`, etc.
- `status`: `EXECUTED` (completed)
- `processDate` / `proposedDate`: Unix millisecond timestamps
- `bidAmount`: FAAB bid (waivers only)
- `items[].type`: `ADD` or `DROP`
- `items[].playerId`: ESPN player ID (resolve separately)
- `fromTeamId` / `toTeamId`: `0` = free agent pool

**Scope:** One scoring period per call. Loop `scoringPeriodId=1..N` to reconstruct a full season.

---

#### Approach B: `kona_league_communication` activity feed (paginated, full-season)

Best for: chronological activity feed across the full season, and the most reliable approach for trades.

**Request:**
```
GET .../leagues/{leagueId}/communication/?view=kona_league_communication
x-fantasy-filter: {
  "topics": {
    "filterType": {"value": ["ACTIVITY_TRANSACTIONS"]},
    "limit": 25,
    "limitPerMessageSet": {"value": 25},
    "offset": 0,
    "sortMessageDate": {"sortPriority": 1, "sortAsc": false},
    "sortFor": {"sortPriority": 2, "sortAsc": false},
    "filterIncludeMessageTypeIds": {"value": [178, 180, 179, 239, 181, 244]}
  }
}
```

**Message type IDs:**
| ID | Meaning |
|---|---|
| 178 | FA added |
| 179 | Dropped (standalone or via FA add) |
| 180 | Waiver added |
| 181 | Dropped via waiver |
| 239 | Dropped (traded away) |
| 244 | Traded |

**Response shape:**
```json
{
  "topics": [
    {
      "date": 1699200000000,
      "messages": [
        {
          "messageTypeId": 180,
          "from": 15,
          "to": 3,
          "for": 0,
          "targetId": 4362887
        }
      ]
    }
  ]
}
```

Field semantics by `messageTypeId`:
- `244` (TRADED): `msg['from']` = team
- `239` (DROPPED-for-trade): `msg['for']` = team
- All others: `msg['to']` = team
- For waiver adds (180): `msg['from']` = FAAB bid amount
- `targetId`: ESPN player ID

**Pagination:** Increment `offset` by 25 per page. Only works for 2019+ leagues.

---

#### Approach C: `mPendingTransactions` (pending/in-progress)

```
GET .../leagues/{leagueId}?view=mPendingTransactions
```

Returns pending trade proposals and unprocessed waiver claims. Format is "very inscrutable" (community characterization) — uses internal UUIDs requiring many follow-up calls to resolve. No library has cleanly wrapped this. **Not recommended for initial implementation.**

---

### ESPN Caveats

- No official rate limit published. Community practice: add small delays when looping over weeks.
- `mTransactions2` trades (`TRADE_ACCEPT`) are unreliable depending on league settings — use activity feed for trades.
- `leagueHistory` endpoint (pre-2018) now requires auth and ESPN has been restricting historical access.
- The `x-fantasy-filter` header schema is entirely undocumented and could change without notice.
- For baseball/basketball/hockey, `kona_league_communication` message type IDs are confirmed the same. `mTransactions2` is less well-tested for non-football sports but the URL pattern is identical.
- ESPN details in this document should be treated as community-verified rather than officially supported contract.

---

## Yahoo

**Confidence level:** High. Endpoint patterns and auth model are documented in Yahoo Fantasy/OAuth docs (plus widely used wrappers).

### Base URL

```
https://fantasysports.yahooapis.com/fantasy/v2
```

Default response format is XML. Append `?format=json` for JSON (recommended).

### Authentication

OAuth 2.0 bearer token (already handled by Flaim's Yahoo auth flow):
```
Authorization: Bearer {access_token}
```

Access tokens expire after 3600 seconds. Refresh tokens are long-lived. Private league data (all Flaim users) requires 3-legged OAuth.

### Transaction Endpoint

#### GET all league transactions

```
GET /league/{league_key}/transactions;types=add,drop,trade;count=50?format=json
```

Matrix parameters (semicolon-separated, not `&`):
| Param | Singular/Plural | Values | Notes |
|---|---|---|---|
| `types` | plural | `add`, `drop`, `commish`, `trade` | For general league feed |
| `type` | singular | `add`, `drop`, `commish`, `trade`, `waiver`, `pending_trade` | For team-scoped calls |
| `count` | — | any integer | Omit to return all |
| `team_key` | — | `{game_id}.l.{league_id}.t.{team_id}` | Required for `waiver` and `pending_trade` |

**Important:** `waiver` and `pending_trade` are NOT returned by the general league endpoint. They only surface with `team_key` filtering. Completed waiver claims appear as `add` type in the general history.

#### Key/ID Format

| Key | Format | Example |
|---|---|---|
| `league_key` | `{game_id}.l.{league_id}` | `423.l.193847` |
| `team_key` | `{game_id}.l.{league_id}.t.{team_id}` | `423.l.193847.t.3` |
| `transaction_key` | `{game_id}.l.{league_id}.tr.{transaction_id}` | `423.l.193847.tr.142` |
| `player_key` | `{game_id}.p.{player_id}` | `423.p.30977` |

Game codes: `nfl` (current NFL season), `mlb`, `nba`, `nhl`. For historical seasons, use numeric `game_id` (e.g., 423 = NFL 2023, 449 = NFL 2024).

#### Response Structure (JSON)

```json
{
  "transaction_key": "423.l.193847.tr.142",
  "transaction_id": "142",
  "type": "add",
  "status": "successful",
  "timestamp": "1698765432",
  "players": {
    "0": {
      "player": [
        [
          {"player_key": "423.p.30977"},
          {"player_id": "30977"},
          {"name": {"full": "Josh Jacobs", "first": "Josh", "last": "Jacobs"}}
        ],
        {
          "transaction_data": {
            "type": "add",
            "source_type": "freeagents",
            "destination_type": "team",
            "destination_team_key": "423.l.193847.t.3",
            "destination_team_name": "Team Chaos"
          }
        }
      ]
    },
    "count": "1"
  }
}
```

`transaction_data` fields:
- `type`: `add` or `drop`
- `source_type` / `destination_type`: `freeagents`, `waivers`, `team`
- `source_team_key` / `destination_team_key`: team key strings
- `faab_bid`: integer (populated on waiver claims)

For trades, additional top-level fields:
- `trader_team_key`, `trader_team_name`
- `tradee_team_key`, `tradee_team_name`
- `picks[]`: array of draft pick objects with `round`, `source_team_key`, `destination_team_key`, `original_team_key`

#### Multi-Sport Support

Identical endpoint across all four sports. Sport is encoded in the `game_id` prefix of the `league_key`.

### Yahoo Caveats

- **JSON is deeply irregular.** Players use numeric string keys (`"0"`, `"1"`) with a `"count"` sibling — a mechanical XML→JSON conversion. Requires custom traversal.
- **`type` vs `types` inconsistency.** Use `types` (plural) for general calls, `type` (singular) with `team_key`.
- **No pagination cursor.** Only a `count` limit. To get all, omit `count`.
- **Rate limit ~few thousand req/hour.** Returns HTTP 999 when hit. Block lifts after 10-15 min. Throttled per `client_id`, not per user.
- **Historical seasons require numeric `game_id`**, not the code (`nfl` always resolves to current season).
- Draft pick trade support via API is inconsistently documented.

---

## Sleeper

**Confidence level:** High. Endpoints and response examples are explicitly documented by Sleeper.

### Base URL

```
https://api.sleeper.app/v1
```

### Authentication

None required. Entirely public read-only API.

### Transaction Endpoint

#### GET transactions by week

```
GET /league/{league_id}/transactions/{round}
```

The `round` parameter is the **week number** (1-based). Inside responses, the same value appears as the `leg` field. For NFL: iterate rounds 1–18 for regular season. Returns `[]` for weeks with no activity (safe to over-iterate).

There is no single-call endpoint for a full season's transactions.

#### GET all traded picks

```
GET /league/{league_id}/traded_picks
```

Returns a flat array of all draft picks that have been traded (current state, not history). Useful for dynasty leagues. No `round` parameter required.

#### Response Structure

```json
[
  {
    "transaction_id": "434852362033561600",
    "type": "trade",
    "status": "complete",
    "status_updated": 1558039402803,
    "created": 1558039391576,
    "leg": 1,
    "roster_ids": [1, 2],
    "consenter_ids": [1, 2],
    "creator": "160000000000000000",
    "adds": {
      "2374": 1,
      "6904": 2
    },
    "drops": {
      "1408": 1,
      "2133": 2
    },
    "draft_picks": [
      {
        "season": "2025",
        "round": 5,
        "roster_id": 1,
        "previous_owner_id": 1,
        "owner_id": 2
      }
    ],
    "waiver_budget": [
      {
        "sender": 2,
        "receiver": 3,
        "amount": 55
      }
    ],
    "settings": null,
    "metadata": null
  }
]
```

#### Field Reference

| Field | Type | Description |
|---|---|---|
| `transaction_id` | string | 18-digit Snowflake-style ID (store as string) |
| `type` | string | `"trade"`, `"waiver"`, `"free_agent"` |
| `status` | string | `"complete"` or `"failed"` |
| `status_updated` | int64 | Unix ms timestamp of last status change |
| `created` | int64 | Unix ms timestamp of creation |
| `leg` | int | Week number (same as `round` in URL) |
| `roster_ids` | int[] | Rosters involved |
| `consenter_ids` | int[] | Rosters that approved (relevant for trades) |
| `creator` | string | User ID who initiated |
| `adds` | object or null | `{ "player_id": roster_id }` — players added |
| `drops` | object or null | `{ "player_id": roster_id }` — players dropped |
| `draft_picks` | array or null | Picks exchanged (trades only) |
| `waiver_budget` | array or null | FAAB transfers (`sender`, `receiver`, `amount`) |
| `settings` | object or null | `{ "waiver_bid": 44 }` for FAAB waivers |
| `metadata` | object or null | Usually null; occasionally contains notes |

#### Transaction Types

| `type` | Description |
|---|---|
| `"free_agent"` | Direct free agent pickup (no waiver period) |
| `"waiver"` | Processed waiver claim |
| `"trade"` | Completed trade |

**Waiver bid:** For `"waiver"` type, `settings.waiver_bid` contains the FAAB amount. `waiver_budget` reflects the FAAB deduction.

#### Waiver Order / FAAB Balance

No dedicated endpoint. Lives on the roster object:
```
GET /league/{league_id}/rosters
```
Each roster's `settings` contains:
- `waiver_position`: current waiver priority
- `waiver_budget_used`: FAAB spent to date

Remaining FAAB = `league.settings.waiver_budget - roster.settings.waiver_budget_used`

#### Multi-Sport Support

Identical endpoint URL for NFL and NBA (Sleeper's two supported sports). The `leg` field maps to the weekly scoring period for both. NBA seasons typically run ~20–26 weekly periods; use `league.settings.playoff_week_start` to determine the max round.

### Sleeper Caveats

- **No single-season endpoint.** Must loop per week. 18 calls for NFL, ~25 for NBA.
- **`adds`/`drops` are objects not arrays.** Keys are player ID strings, values are roster ID integers.
- **Player IDs are strings as keys** but integers elsewhere — handle type consistently.
- **`transaction_id` is 18-digit integer stored as string.** Do not parse as JS `Number` (overflow risk).
- **Player metadata not in transactions.** Resolve player name/position via `GET /players/{sport}` — a large static file (~5MB for NFL). Cache it.
- **`draft_picks` in transaction vs `/traded_picks` endpoint** are complementary: per-transaction records the specific trade, `/traded_picks` reflects net current ownership.
- **Rate limit:** 1,000 API calls/minute. Season-scraping (18 calls/league) is nowhere near this.
- **Status values beyond `"complete"` are underdocumented.** `"failed"` observed in practice.

---

## Implementation Notes

### Recommended `get_transactions` Tool Design

A single `get_transactions` tool across all platforms. Suggested parameters:

| Param | Type | Required | Notes |
|---|---|---|---|
| `platform` | string | yes | `"espn"`, `"yahoo"`, `"sleeper"` |
| `sport` | string | yes | `"football"`, `"baseball"`, etc. |
| `league_id` | string | yes | |
| `season_year` | number | yes | |
| `week` | number | no | Platform-specific: ESPN/Sleeper honor explicit `week`; Yahoo ignores `week` and uses recent timestamp window |
| `type` | string | no | Filter: `"add"`, `"drop"`, `"trade"`, `"waiver"` — Yahoo `type="waiver"` is explicitly unsupported in v1 |
| `count` | number | no | Max results to return (default 25) |

**V1 latency guardrail recommendation:** when `week` is omitted, default to a bounded recent window instead of full-season history. Suggested default: current week + previous week (or latest 2 scoring periods available), then apply `count`.

### Per-Platform Implementation Approach

**ESPN:**
- Use `kona_league_communication` activity feed as primary source (handles trades reliably, full-season paginated feed).
- Use `mTransactions2` as supplementary source for structured bid amounts when needed.
- Pass existing `espn_s2` / `SWID` cookies (already stored in Flaim).
- Map message type IDs (178/179/180/181/239/244) to normalized types.

**Yahoo:**
- Call `/league/{league_key}/transactions;types=add,drop,trade?format=json`.
- Use `league_key` constructed from stored `game_id` and `league_id`.
- Normalize the irregular numeric-keyed JSON player array (existing Yahoo normalizer pattern in the codebase).
- Note: pending waivers require per-team calls; out of scope for v1.

**Sleeper:**
- If `week` param provided: single call `/league/{league_id}/transactions/{week}`.
- If no week: call last 2 weeks and merge.
- Filter by `type` client-side (no server-side filter param).
- Resolve player names via cached `/players/{sport}` endpoint.

### Response Normalization

All three platforms should return a normalized shape:
```typescript
{
  transaction_id: string
  type: "add" | "drop" | "trade" | "waiver"
  status: "complete" | "failed" | "pending"
  timestamp: number           // Unix ms
  week: number | null
  teams_involved: string[]    // team names
  players_added: { id: string, name: string, position: string }[]
  players_dropped: { id: string, name: string, position: string }[]
  faab_bid: number | null
  draft_picks: object[] | null
}
```

### Open Questions Before Implementation

1. **ESPN `mTransactions2` vs activity feed for v1?** Activity feed is simpler for comprehensive history but requires message ID mapping. `mTransactions2` is more structured but needs per-week looping and trade reliability is uncertain. Could start with activity feed only.
2. **Player name resolution for Sleeper:** The `/players/nfl` file is ~5MB. Cache in KV or fetch once and store? Current ESPN/Yahoo handlers do not need this since player data comes embedded in responses.
3. **`week` parameter scope:** Should a `week=null` call return recent transactions (last 1-2 weeks) or the entire season? Season-wide means many API calls for ESPN/Sleeper and more pagination on Yahoo — likely too slow/noisy for MCP defaults. Defaulting to "current + previous week" is safer.
4. **Yahoo pending waivers:** Per-team calls needed to surface pending claims. Worth including or out of scope for v1?
5. **Rate limiting:** ESPN has no documented limits; Yahoo throttles at HTTP 999 ~few thousand req/hour. For MCP tool calls this should be fine, but worth noting.

## Recommended V1 Decisions (Based on Verified Findings)

1. Use **bounded recent window by default** with platform semantics (`week` omitted => ESPN/Sleeper current+previous week, Yahoo last 14 days, capped by `count`).
2. Use **ESPN activity feed as primary** for unified history/trades in v1.
3. Keep **Yahoo pending waivers out of v1** to avoid per-team fan-out complexity.
4. Treat ESPN integration as **best-effort unofficial surface** and design tolerant parsing + graceful fallback messaging.

## Confirmed Phasing Decisions (2026-02-23)

1. **V1 default window:** confirmed as platform-specific when `week` is omitted: ESPN/Sleeper use current+previous week; Yahoo uses recent 14-day timestamp window.
2. **ESPN enrichment:** include `mTransactions2` enrichment in a separate implementation phase after base v1.
3. **Yahoo waivers enrichment:** keep pending-waiver team fan-out in a separate implementation phase after base v1.
4. **Sleeper enrichment coupling:** defer Sleeper player/free-agent enrichment to a later phase aligned with planned Sleeper free-agents work.
5. **Yahoo `type=waiver` behavior in v1:** return explicit unsupported-filter error (do not silently return empty results).

## Implementation Blueprint (Codebase-Specific)

This maps the proposed tool to current worker architecture so implementation work is scoped and predictable.

### Gateway (`fantasy-mcp`)

Add new MCP tool definition and routing call:
- `workers/fantasy-mcp/src/mcp/tools.ts`
  - Add `get_transactions` with:
    - `platform`: `espn|yahoo|sleeper`
    - `sport`: `football|baseball|basketball|hockey`
    - `league_id`, `season_year`
    - optional `week`, `type`, `count`
  - Mirror existing patterns:
    - `requiredScope: "mcp:read"`
    - `securitySchemes` + OpenAI invocation metadata
    - `withToolLogging(...)` + `routeToClient(...)`
- `workers/fantasy-mcp/src/types.ts`
  - Extend `ToolParams` with optional `type?: string`
- `workers/fantasy-mcp/src/__tests__/tools.test.ts`
  - Add `get_transactions` to expected unified tool list.
  - Add route/serialization parity tests.

### ESPN client

Current ESPN code routes by sport and tool map in each sport handler file:
- `workers/espn-client/src/index.ts`
- `workers/espn-client/src/sports/{football,baseball,basketball,hockey}/handlers.ts`

Recommended implementation:
1. Add `get_transactions` in each sport handler map.
2. Add shared helper:
   - `workers/espn-client/src/shared/espn-transactions.ts` (new)
3. V1 source:
   - `kona_league_communication` activity feed (`/communication/?view=kona_league_communication`)
4. ESPN enrichment phase:
   - `mTransactions2` per week/window for richer FAAB fields.

Notes:
- `workers/espn-client/src/shared/espn-api.ts` already supports custom headers + cookie auth.
- `workers/espn-client/src/types.ts` already documents ESPN as undocumented API surface.

### Yahoo client

Current Yahoo code already has robust irregular JSON helpers:
- `workers/yahoo-client/src/shared/normalizers.ts` (`asArray`, `getPath`, `unwrapLeague`, `unwrapTeam`)

Recommended implementation:
1. Add `get_transactions` in each sport handler map:
   - `workers/yahoo-client/src/sports/{football,baseball,basketball,hockey}/handlers.ts`
2. Add shared helper:
   - `workers/yahoo-client/src/shared/yahoo-transactions.ts` (new)
3. V1 endpoint pattern:
   - `/league/{league_key}/transactions;types=add,drop,trade`
   - optional `;count={n}`
4. Yahoo enrichment phase:
   - pending waivers/pending trades via team fan-out:
   - `/league/{league_key}/transactions;team_key={team_key};type=waiver`
   - `/league/{league_key}/transactions;team_key={team_key};type=pending_trade`

Note:
- `workers/yahoo-client/src/shared/yahoo-api.ts` appends `format=json`, compatible with matrix-param URLs.

### Sleeper client

Current Sleeper support is football + basketball only:
- `workers/sleeper-client/src/index.ts`
- `workers/sleeper-client/src/types.ts` (`Sport = "football" | "basketball"`)

Recommended implementation:
1. Add `get_transactions` in:
   - `workers/sleeper-client/src/sports/football/handlers.ts`
   - `workers/sleeper-client/src/sports/basketball/handlers.ts`
2. Add shared helper:
   - `workers/sleeper-client/src/shared/sleeper-transactions.ts` (new)
3. V1 behavior:
   - if `week` provided: single call `/league/{league_id}/transactions/{week}`
   - if omitted: fetch current + previous week and merge/sort
   - return player IDs when names are unavailable inline.
4. Sleeper enrichment phase:
   - player-name enrichment from `/players/{sport}` cache, aligned with planned Sleeper free-agents work.

## Suggested Tool Contract (V1)

Input:
```ts
{
  platform: "espn" | "yahoo" | "sleeper";
  sport: "football" | "baseball" | "basketball" | "hockey";
  league_id: string;
  season_year: number;
  week?: number; // ESPN/Sleeper only in v1; Yahoo ignores
  type?: "add" | "drop" | "trade" | "waiver"; // Yahoo "waiver" returns explicit unsupported error in v1
  count?: number; // default 25, max 100
}
```

Output (v1 pragmatic shape):
```ts
{
  success: true;
  data: {
    platform: string;
    sport: string;
    league_id: string;
    season_year: number;
    window: {
      mode: "explicit_week" | "recent_two_weeks" | "recent_two_weeks_timestamp";
      weeks: number[];
      start_timestamp_ms?: number; // Yahoo v1
      end_timestamp_ms?: number;   // Yahoo v1
    };
    warning?: string;
    dropped_invalid_timestamp_count?: number; // Yahoo v1 timestamp guardrail
    transactions: Array<{
      transaction_id: string;
      type: "add" | "drop" | "trade" | "waiver";
      status: "complete" | "failed" | "pending" | "unknown";
      timestamp: number; // unix ms
      week: number | null;
      team_ids?: string[];
      team_names?: string[];
      players_added?: Array<{ id: string; name?: string }>;
      players_dropped?: Array<{ id: string; name?: string }>;
      faab_bid?: number | null;
      draft_picks?: unknown[] | null;
    }>;
    count: number;
  };
}
```

## Performance and Reliability Guardrails

1. Default query window:
- `week` omitted => ESPN/Sleeper current + previous week; Yahoo recent 14-day timestamp window.

2. Hard caps:
- `count` default 25, max 100 (clamp).
- sort by `timestamp desc`, then trim.

3. Timeouts:
- follow current utility defaults (ESPN ~5-7s, Yahoo/Sleeper ~10s) and avoid unbounded fan-out.

4. Degradation:
- return structured platform error codes instead of leaking raw upstream payloads.

## Error Mapping (Recommended)

Reuse existing code prefix style:
- ESPN:
  - `ESPN_TRANSACTIONS_UNSUPPORTED`
  - `ESPN_TRANSACTIONS_PARSE_ERROR`
- Yahoo:
  - `YAHOO_TRANSACTIONS_PARSE_ERROR`
  - `YAHOO_MATRIX_PARAM_ERROR`
- Sleeper:
  - `SLEEPER_TRANSACTIONS_PARSE_ERROR`

Gateway-level:
- `INVALID_PARAM` (invalid `type`, `count`, `week`)
- `SPORT_NOT_SUPPORTED` (Sleeper baseball/hockey)

## Test Plan Additions

### Gateway tests
- `workers/fantasy-mcp/src/__tests__/tools.test.ts`
  - tool list includes `get_transactions`
  - schema validation for defaults/clamps
  - routing + response formatting checks

### ESPN client tests
- activity message mapping coverage (178/179/180/181/239/244)
- week-window behavior
- type filtering + count clamp
- malformed-message fallback

### Yahoo client tests
- matrix-param URL construction:
  - `types=add,drop,trade`
  - optional `count`
- numeric-key JSON traversal via existing normalizers
- pending-waiver fan-out excluded from v1 tests (phase-gated)

### Sleeper client tests
- explicit week vs default two-week merge
- deterministic sort by `status_updated`/`created`
- `transaction_id` preserved as string

## Source Quality Notes

- Sleeper and Yahoo behavior in this doc is grounded in published docs.
- ESPN behavior is based on stable community reverse-engineered implementations and should be treated as best-effort compatibility, not contractual API support.

---

## Sources

- Sleeper official docs:
  - [Sleeper API Docs](https://docs.sleeper.com/)
- Yahoo docs and references:
  - [Yahoo OAuth 2.0 Guide](https://developer.yahoo.com/oauth2/guide/)
  - [Yahoo Fantasy Sports API Guide](https://developer.yahoo.com/fantasysports/guide/)
  - [Yahoo Fantasy transactions reference (community docs mirror)](https://yahoofantasysportsapidocs.readthedocs.io/guide/resource/league/transactions.html)
- ESPN community-maintained references (unofficial):
  - [cwendt94/espn-api](https://github.com/cwendt94/espn-api) — request constants, league transaction/activity methods, transaction/activity constants
  - [pseudo-r/Public-ESPN-API](https://github.com/pseudo-r/Public-ESPN-API)
