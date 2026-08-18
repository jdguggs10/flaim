# Sleeper Client Worker

Internal Sleeper fantasy API client used by the unified gateway (`fantasy-mcp`). Handles all Sleeper fantasy sports data fetching for NFL and NBA leagues.

> **Note**: Primarily called via service binding from `fantasy-mcp`. Sleeper's API is entirely public — no OAuth or API key is required.

## Purpose

Consolidates all Sleeper API interactions for supported sports into a single worker:
- Football (NFL) handlers ✅
- Basketball (NBA) handlers ✅

## Architecture

```
fantasy-mcp (gateway)
     |
     v (service binding)
sleeper-client
     |
     +---> Sleeper API (api.sleeper.app/v1 — public, no auth)
     +---> auth-worker (user lookup via service binding)
```

## Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check |
| `/execute` | POST | Execute tool (internal only) |

### `/execute` Request Format

```typescript
interface ExecuteRequest {
  tool: string;        // e.g., "get_league_info"
  params: {
    sport: 'football' | 'basketball';
    league_id: string; // Sleeper league ID (numeric string)
    season_year: number;
    team_id?: string;  // Sleeper roster/user ID within the league
    week?: number;
  };
}
```

`/execute` requires `X-Flaim-Internal-Token` for internal calls.

## Supported Tools

### Football (NFL)
- `get_league_info` — League settings and members, plus traded draft-pick ownership
- `get_standings` — League standings (computed from roster settings: wins, losses, ties, points)
- `get_roster` — Team roster with player details
- `get_matchups` — Weekly matchups (paired by `matchup_id`)
- `get_free_agents` — Available free agents (uses KV-backed player index cache)
- `get_players` — Player lookup with ownership unavailable semantics (`market_percent_owned: null`, `ownership_scope: "unavailable"`)
- `get_transactions` — Recent transactions with player name/position enrichment and a roster/owner `teams` map

### Basketball (NBA)
- `get_league_info` — League settings and members, plus traded draft-pick ownership
- `get_standings` — League standings (computed from roster settings: wins, losses, ties, points)
- `get_roster` — Team roster with player details
- `get_matchups` — Weekly matchups (paired by `matchup_id`)
- `get_free_agents` — Available free agents (uses KV-backed player index cache)
- `get_players` — Player lookup with ownership unavailable semantics (`market_percent_owned: null`, `ownership_scope: "unavailable"`)
- `get_transactions` — Recent transactions with player name/position enrichment and a roster/owner `teams` map

## Roster/Matchup Player Enrichment and Team Names

`get_roster` (current and historical) and `get_matchups` resolve Sleeper's bare player-ID strings into enriched entries using the same KV-backed player index described below:
- Current roster (`starters`, `bench`, `reserve`, `taxi`) and matchups (`starters`, per side): index hit → `{ id, name, position, team }` (`team` omitted when the record has none).
- Historical week roster (`starters`, `bench` — reserve/taxi classification isn't available historically): index hit → `{ id, name, position }`, **never** `team`. The player index only tracks each player's CURRENT club, so a past-week roster omits `team` rather than risk showing a club the player joined after that week; `limitations.playerProTeamAvailable: false` marks this explicitly alongside the existing `reserveAndTaxiClassificationAvailable: false`.
- Matchups follow the same rule: when `week` is omitted the handler resolves the live week and starters carry `team`; when `week` is passed explicitly (which may be a past week) starters omit `team` and the response carries `limitations.playerProTeamAvailable: false`.
- Sleeper's `"0"` empty-lineup-slot sentinel: `{ id: "0", empty: true }` — no lookup is attempted.
- Unknown ID or an unavailable player index: `{ id }` only — array order and length are always preserved, and the request never fails because of enrichment.
- When the player index is unavailable, the response still succeeds and adds a top-level `warnings: string[]` explaining player names/positions are unavailable for that call.

`get_league_info`, `get_standings`, `get_roster`, and `get_matchups` all add `teamName` alongside the existing `ownerName`. Sleeper only exposes a manager-set fantasy team name via `users[].metadata.team_name`; when it is unset (common), `teamName` falls back to Sleeper's own default `Team <display name>` — the exact name league members see in the Sleeper app — so every team always has a `teamName`. The fallback matches Sleeper's UI convention rather than inventing one; ESPN uses the analogous `Team <id>` fallback.

## Transaction Team Names

`get_transactions` fetches `GET /league/{league_id}/rosters` and `GET /league/{league_id}/users` alongside the transaction window and player-index lookups, and adds a top-level `teams` map — `{ "<rosterId>": { ownerName, teamName } }`, keyed by the same string roster ids used in `team_ids` — the same purpose as ESPN's inline transactions `teams` map, so the model doesn't have to cross-reference `get_league_info` to say who moved whom. Each row also gets `team_names: string[]`, parallel to `team_ids`, resolved through that map (falling back to the raw roster id when a particular id has no matching roster). If the rosters/users fetch fails, `teams` is omitted and a `TEAMS_UNAVAILABLE` warning is added — the transaction rows themselves are unaffected (`team_names` falls back to raw ids), and the request never fails because of it.

## Traded Draft-Pick Ownership (Sleeper Only)

`get_league_info` additionally fetches `GET /league/{league_id}/traded_picks` and surfaces `tradedPicks` — but only picks that changed hands; Sleeper does not list untraded picks, so this is not an exhaustive picture of every future draft. Each returned entry resolves the raw roster ids to names via the same user directory: `{ season, round, originalRosterId, originalOwnerName?, originalTeamName?, previousRosterId, currentRosterId, currentOwnerName?, currentTeamName? }`, sorted by season, round, then originalRosterId. `draftRounds` (from `league.settings.draft_rounds`) is also surfaced so a future draft's round count can be reasoned about. When `tradedPicks` is non-empty, a one-sentence `pickOwnershipNote` reminds the caller that every roster owns its own untraded picks and that Sleeper allows pick trading for the current season plus up to three future seasons depending on league settings — seasons beyond what's listed are unverified; the note is suppressed when `tradedPicks` is empty since there is nothing to caveat. Redraft leagues (and any league with nothing traded) return an empty `tradedPicks: []` array with no warning. Every raw entry is runtime-validated (`season` a non-empty string, `round`/`roster_id`/`previous_owner_id`/`owner_id` integers) before use. Malformed entries are dropped and the valid ones are kept, with a `TRADED_PICKS_PARTIAL: N malformed ...` entry added to a top-level `warnings: string[]` so the caller knows the list may be incomplete; if the fetch fails, the body isn't an array, or no entry is valid, `tradedPicks` and `pickOwnershipNote` are omitted and a `TRADED_PICKS_UNAVAILABLE` warning is added instead — never failing the whole `get_league_info` call, so the rest of the league/roster/user data still succeeds. A pick whose roster id has no matching roster resolves with the id fields present and the name fields omitted, never a thrown error.

## Player Cache (KV)

`get_free_agents`, `get_transactions`, `get_roster`, and `get_matchups` enrichment all use a shared KV-backed player index (`SLEEPER_PLAYERS_CACHE`):
- Fetches `GET /v1/players/{sport}` (NFL or NBA) on cache miss.
- Caches every player Sleeper returns (active and inactive, with an `active` flag) for 24 hours; only `get_free_agents` filters to active players, so rostered IR/retired players still resolve to names.
- Cache key format: `players:{sport}:v1`.
- Falls back to in-memory cache if the KV binding is unavailable.
- Gracefully degrades: if the player index fails, `get_transactions` still returns player IDs, `get_free_agents` returns an empty list, and `get_roster`/`get_matchups` return `{ id }`-only entries — every one of these now adds a top-level `warnings: string[]` explaining the degradation (see below) rather than degrading silently.

## Degradation Warnings

Every Sleeper tool that can partially degrade (an unavailable player index, or — for `get_transactions` — unavailable roster/owner data for `teams`) reports it the same way: a top-level `warnings: string[]`, present only when non-empty, naming each degraded piece (e.g. `PLAYER_ENRICHMENT_UNAVAILABLE`, `TEAMS_UNAVAILABLE`). `get_free_agents` is the one exception carrying published-client history: it keeps its legacy singular `warning: string` field (never removed) and additionally emits the same message in `warnings: [warning]` so callers can rely on the array form across every Sleeper tool without special-casing free agents.

## Sleeper API Notes

- **Public API**: No authentication is required. All endpoints are open (no API key, no OAuth).
- **No standings endpoint**: Sleeper does not expose a dedicated standings endpoint. Standings are computed from each roster's `settings` (wins, losses, ties, fpts) which Sleeper keeps current.
- **Matchup pairing**: Matchup results are returned as a flat list; opponents are paired by matching `matchup_id` values.
- **Username-based onboarding**: Users connect via Sleeper username. The worker resolves the username to a numeric `sleeper_user_id` via `GET /user/{username}`.
- **Historical season discovery**: Onboarding discovers up to 5 years of past leagues via the Sleeper user leagues endpoint.
- **Base URL**: `https://api.sleeper.app/v1`

## Development

```bash
# Run locally from the repository root (port 8792)
corepack pnpm --dir workers/sleeper-client run dev

# Or directly
corepack pnpm --dir workers/sleeper-client exec wrangler dev --env dev --port 8792

# Run tests
corepack pnpm --dir workers/sleeper-client run test

# Type check
corepack pnpm --dir workers/sleeper-client run type-check
```

## Related

- [`fantasy-mcp`](../fantasy-mcp/) — Unified MCP gateway that calls this worker
- [`auth-worker`](../auth-worker/) — Provides user identity lookup (Sleeper connections stored here)
- [`espn-client`](../espn-client/) — Parallel ESPN client worker
- [`yahoo-client`](../yahoo-client/) — Parallel Yahoo client worker
