# Yahoo Client Worker (Phase 2) Design

> **Status:** Design complete, ready for implementation planning.

**Goal:** Create `yahoo-client` worker to enable MCP tools (get_league_info, get_standings, get_roster) to work with Yahoo Fantasy leagues.

**Date:** 2026-01-27

---

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Scope** | 3 tools: get_league_info, get_standings, get_roster | Validate integration before full feature parity |
| **Credentials** | Service binding to auth-worker | Centralized token refresh, matches ESPN pattern |
| **JSON parsing** | Shared normalizers module | Yahoo quirks consistent across sports, reusable for baseball |
| **League key** | Trust stored value from discovery | Discovery already validated; Yahoo API is source of truth |
| **Testing** | Unit tests for normalizers only | Normalizers are tricky part; handlers straightforward |
| **Format** | JSON with `?format=json` param | Consistent with codebase, no XML parser needed |
| **Error handling** | Match espn-client patterns | Structured ExecuteResponse with error codes |

---

## Architecture

### Worker Structure

```
workers/yahoo-client/
├── src/
│   ├── index.ts                 # Hono app, /health + /execute endpoints
│   ├── types.ts                 # Env, ExecuteRequest, ExecuteResponse, ToolParams
│   │
│   ├── shared/
│   │   ├── yahoo-api.ts         # yahooFetch() - auth header, base URL, ?format=json
│   │   ├── auth.ts              # getYahooCredentials() - service binding to auth-worker
│   │   └── normalizers.ts       # unwrapResource(), asArray(), getPath()
│   │
│   ├── sports/
│   │   └── football/
│   │       ├── handlers.ts      # get_league_info, get_standings, get_roster
│   │       └── mappings.ts      # Position names, roster slots (if needed)
│   │
│   └── __tests__/
│       └── normalizers.test.ts  # Unit tests with Yahoo JSON fixtures
│
├── wrangler.jsonc               # Service bindings: AUTH_WORKER
├── package.json
└── tsconfig.json
```

### Data Flow

```
Claude/ChatGPT
  → fantasy-mcp (gateway)
    → yahoo-client /execute (service binding)
      → auth-worker /connect/yahoo/credentials (get token)
      → Yahoo Fantasy API (https://fantasysports.yahooapis.com/fantasy/v2/)
```

### Yahoo API Endpoints

| Tool | Yahoo Endpoint |
|------|----------------|
| `get_league_info` | `GET /league/{league_key}?format=json` |
| `get_standings` | `GET /league/{league_key}/standings?format=json` |
| `get_roster` | `GET /team/{team_key}/roster?format=json` |

---

## Yahoo JSON Structure

Yahoo's JSON is XML-transformed with quirks:
- Root is `fantasy_content`
- Data in arrays: `[0]` = metadata, `[1]` = nested resources
- Access: `fantasy_content.league[0].league_key` for metadata
- Access: `fantasy_content.league[1].standings` for nested data

### Normalizer Functions

```typescript
// Convert numeric-keyed objects to arrays
// {"0": {...}, "1": {...}} → [{...}, {...}]
function asArray<T>(obj: Record<string, T>): T[]

// Safe deep path traversal
function getPath(obj: unknown, path: (string | number)[]): unknown

// Unwrap Yahoo resource envelope
function unwrapLeague(data: unknown): YahooLeagueRaw
function unwrapTeam(data: unknown): YahooTeamRaw
```

---

## Error Handling

| Error | Detection | Response Code |
|-------|-----------|---------------|
| Token expired/invalid | Yahoo 401 | `YAHOO_AUTH_ERROR` |
| League not found | Yahoo 404 | `YAHOO_NOT_FOUND` |
| Rate limited | Yahoo 429 | `YAHOO_RATE_LIMITED` |
| Network timeout | Fetch throws | `YAHOO_TIMEOUT` |
| Invalid JSON | Parse throws | `YAHOO_INVALID_RESPONSE` |

---

## Service Bindings

**yahoo-client/wrangler.jsonc:**
```jsonc
{
  "name": "yahoo-client",
  "services": [
    { "binding": "AUTH_WORKER", "service": "auth-worker" }
  ]
}
```

**fantasy-mcp/wrangler.jsonc (update):**
```jsonc
{
  "services": [
    { "binding": "ESPN", "service": "espn-client" },
    { "binding": "YAHOO", "service": "yahoo-client" },
    { "binding": "AUTH_WORKER", "service": "auth-worker" }
  ]
}
```

---

## References

- [Yahoo Fantasy Sports API Guide](https://developer.yahoo.com/fantasysports/guide/)
- [espn-client implementation](/workers/espn-client/src/)
- [ADD_YAHOO_PLATFORM.md](/docs/dev/ADD_YAHOO_PLATFORM.md)
