# Database Schema (Supabase)

This is a lightweight map of the current Supabase tables used by Flaim. The authoritative SQL migrations live in the private `flaim-docs` repository under `migrations/` (numbered `*.sql` files), not in this repo.

## Core Tables

### espn_credentials
Stores ESPN session cookies for a Clerk user.

| Column | Type | Notes |
|---|---|---|
| clerk_user_id | text | Unique per user (upsert conflict key) |
| swid | text | ESPN SWID cookie (encrypted at rest by Supabase) |
| s2 | text | ESPN espn_s2 cookie (encrypted at rest by Supabase) |
| email | text | Optional ESPN account email |
| updated_at | timestamptz | Last credential update |

Notes:
- Additional metadata columns may exist in the live schema (e.g., `id`, `created_at`).

### espn_leagues
One row per user + league + sport + season.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key (used internally for deletes) |
| clerk_user_id | text | User owner |
| league_id | text | ESPN league ID |
| sport | text | football/baseball/basketball/hockey |
| team_id | text | User's team ID in league (optional) |
| team_name | text | User's team name (optional) |
| league_name | text | League name (optional) |
| season_year | int | Season year (optional for legacy rows) |

Constraints/Indexes:
- Unique per season: `idx_espn_leagues_user_league_sport_season_unique`.

### yahoo_leagues
One row per user + league + sport + season (same structure as espn_leagues).

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| clerk_user_id | text | User owner |
| league_key | text | Yahoo league key |
| sport | text | football/baseball/basketball/hockey |
| season_year | int | Season year |
| league_name | text | League name |
| team_id | text | User's team ID |
| team_key | text | Yahoo team key |
| team_name | text | User's team name |

### yahoo_credentials
Stores Yahoo OAuth credentials for a Clerk user.

| Column | Type | Notes |
|---|---|---|
| clerk_user_id | text | Primary key (one Yahoo account per user) |
| access_token | text | Yahoo OAuth access token |
| refresh_token | text | Yahoo OAuth refresh token |
| expires_at | timestamptz | Access token expiry |
| yahoo_guid | text | Optional Yahoo user GUID |
| refresh_lease_owner | text | Short-lived owner ID for single-writer token refresh; `cooldown:*` marks a short shared backoff after Yahoo rate-limit-like refresh failures |
| refresh_lease_expires_at | timestamptz | Expiry for the active refresh lease or cooldown marker |
| created_at | timestamptz | Created timestamp |
| updated_at | timestamptz | Updated timestamp |

### sleeper_connections
Stores a Sleeper username association for a Clerk user (Sleeper has no OAuth — identity is username-based).

| Column | Type | Notes |
|---|---|---|
| clerk_user_id | text | Primary key (one Sleeper account per user) |
| sleeper_user_id | text | Sleeper numeric user ID (looked up from username) |
| sleeper_username | text | Sleeper username |
| created_at | timestamptz | Created timestamp |
| updated_at | timestamptz | Updated timestamp |

### sleeper_leagues
One row per user + league + sport + season.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| clerk_user_id | text | User owner |
| league_id | text | Sleeper league ID |
| sport | text | football/basketball |
| season_year | int | Season year |
| league_name | text | League name (optional) |
| roster_id | integer | User's roster ID in this league (optional, found during discovery) |
| recurring_league_id | text | Stable recurring root ID derived from Sleeper's `previous_league_id` chain (optional on legacy rows) |
| sleeper_user_id | text | Sleeper user ID (not null) |

Constraints/Indexes:
- Unique per season: unique on `(clerk_user_id, league_id, season_year)`.
- Index on `clerk_user_id` for fast user lookups.

Notes:
- New discovery writes persist `recurring_league_id` when the column is available and the full Sleeper history chain resolves successfully.
- During rollout, auth-worker retries writes without `recurring_league_id` if the live schema does not have the column yet; those legacy or unresolved rows still rely on read-time fallback until they are rediscovered.

### archived_leagues
Manual league suppression (FLA-124; three-state model FLA-150). One row per suppressed recurring league, across ESPN, Yahoo, and Sleeper. The `mode` column places a league in one of two suppressed states; both remain visible and restorable in `/leagues`:
- `historical` (Archive) — hidden from `get_user_session` but browsable in `get_ancient_history`.
- `hidden` (Hide) — hidden from both AI tools.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| clerk_user_id | text | User owner |
| platform | text | `espn`, `yahoo`, or `sleeper` |
| sport | text | football/baseball/basketball/hockey |
| recurring_league_id | text | Stable recurring-league identity (ESPN: `league_id`; Sleeper: `recurring_league_id ?? league_id`; Yahoo: `recurring_league_id ?? league_key`) |
| league_name | text | Denormalized name for the UI list (optional) |
| archived_at | timestamptz | When the league was suppressed |
| mode | text | `historical` or `hidden` (default `historical`; migration 025 backfilled existing rows to `hidden`). NOT part of the unique key. |

Constraints/Indexes:
- Unique per league: `(clerk_user_id, platform, sport, recurring_league_id)` — `mode` is a mutable attribute, so re-archiving overwrites it (moves the league between Archived/Hidden).
- Index on `clerk_user_id`.

Notes:
- Keyed on a recurring identity (not a season-scoped row) so suppression survives annual re-syncs — discovery upserts new season rows without touching this table.
- Read paths: internal/AI-facing reads take a tri-state filter — `exclude-archived` (both modes, for `get_user_session`) or `exclude-hidden` (drops only `hidden`, for `get_ancient_history`); fail-closed on a lookup error. Public/UI reads annotate `archived` + `archiveMode`. The read tolerates a pre-migration schema (treats rows as `hidden` if `mode` is absent).

### platform_oauth_states
Short-lived OAuth state values for platform-connect flows (separate from MCP OAuth state table).

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| state | text | Unique state value |
| platform | text | Platform key (`yahoo`, `sleeper`, `cbs`) |
| clerk_user_id | text | Clerk user ID |
| redirect_after | text | Optional post-connect redirect path |
| expires_at | timestamptz | State expiry |
| created_at | timestamptz | Created timestamp |

### user_preferences
Per-user preferences including default leagues (one per sport).

| Column | Type | Notes |
|---|---|---|
| clerk_user_id | text | Primary key |
| default_sport | text | Preferred sport (football/baseball/etc.) |
| default_football | jsonb | `{ platform, leagueId, seasonYear }` or null |
| default_baseball | jsonb | `{ platform, leagueId, seasonYear }` or null |
| default_basketball | jsonb | `{ platform, leagueId, seasonYear }` or null |
| default_hockey | jsonb | `{ platform, leagueId, seasonYear }` or null |
| created_at | timestamptz | Created timestamp |
| updated_at | timestamptz | Updated timestamp |

Notes:
- Per-sport defaults are JSONB with `{ platform: "espn"|"yahoo"|"sleeper", leagueId: string, seasonYear: number }`.
- Cross-platform exclusivity is automatic (one column per sport = one default).

### oauth_codes
Short-lived authorization codes for OAuth 2.1.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| code | text | Unique auth code; confidential-client codes encode a signed client binding |
| user_id | text | Clerk user ID |
| redirect_uri | text | OAuth redirect URI |
| code_challenge | text | PKCE challenge |
| code_challenge_method | text | `S256` or `plain` |
| scope | text | Default `mcp:read` |
| resource | text | RFC 8707 resource indicator |
| expires_at | timestamptz | Code expiry |
| used_at | timestamptz | Set on use |
| created_at | timestamptz | Created timestamp |

### oauth_tokens
Access and refresh tokens for MCP clients.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| access_token | text | Unique access token |
| user_id | text | Clerk user ID |
| scope | text | Default `mcp:read` |
| resource | text | RFC 8707 resource indicator |
| client_name | text | Derived from redirect URI (Claude, ChatGPT, etc.) |
| expires_at | timestamptz | Access token expiry |
| revoked_at | timestamptz | Revocation time |
| refresh_token | text | Optional refresh token; confidential-client refresh tokens encode a signed client binding |
| refresh_token_expires_at | timestamptz | MCP refresh-token inactivity expiry (1 year by default; `OAUTH_REFRESH_TOKEN_TTL_SECONDS`) |
| created_at | timestamptz | Created timestamp |
| grant_type | text | Mint path (migration 028): `authorization_code` (new connection) or `refresh_token` (keepalive); null for pre-migration rows |

When extending the MCP refresh-token inactivity window for an existing deployment, non-revoked rows with still-valid refresh tokens can be backfilled so current connectors inherit the longer window without reconnecting:

```sql
UPDATE oauth_tokens
SET refresh_token_expires_at = GREATEST(
  refresh_token_expires_at,
  now() + interval '1 year'
)
WHERE refresh_token IS NOT NULL
  AND revoked_at IS NULL
  AND refresh_token_expires_at > now();
```

### oauth_connections (view)
Connection-health view (migration 028, `security_invoker` so it inherits `oauth_tokens` RLS). One row per `(user_id, client_name)`: `connected` (a live, non-expired refresh token exists), `first_seen`, `last_refresh`, `token_rows`, and `auth_grants` (count of `authorization_code` mints). Use for connection status/health — distinct from the gateway engagement analytics (`mcp_tool_events`).

### oauth_states
Short-lived OAuth state values used for server-side validation.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| state | text | Unique state value |
| redirect_uri | text | Must match at `/oauth/code` |
| client_id | text | Optional client ID to bind state |
| expires_at | timestamptz | State expiry |
| created_at | timestamptz | Created timestamp |

### demo_context_cache
Server-owned cache for public `/chat` warm context. Used to avoid rebuilding the same demo session context on every visitor request.

| Column | Type | Notes |
|---|---|---|
| cache_key | text | Primary key (`gerry_session_v1`, etc.) |
| context_text | text | Cached developer-context text injected into the public demo route |
| expires_at | timestamptz | Freshness boundary for the cached entry |
| created_at | timestamptz | Created timestamp |
| updated_at | timestamptz | Updated timestamp |

### demo_answer_cache
Server-owned cache for homepage public-demo answers. Stores the most recent precomputed answer for a preset/sport/version combination so visitors can read cached demo output instead of triggering live provider inference. The production writer is the external private `flaim-demo` runner; the website remains read-only against this table.

| Column | Type | Notes |
|---|---|---|
| cache_key | text | Primary key (`public-demo-answer:<preset>:<sport>:<promptVersion>:<contextVersion>`) |
| preset_id | text | Public preset identifier (for example `hot-hands`, `this-matchup`, `wire-watch`; not exhaustive) |
| sport | text | Demo sport (`baseball` or `football`) |
| provider | text | Opaque provider key stored by the external writer. The website intentionally does not depend on the runner's provider choice; `gemini` is stored by the legacy rollback path. |
| provider_model | text | Model identifier used for the refresh |
| context_version | text | Session-context contract version |
| prompt_version | text | Prompt contract version |
| answer_text | text | Final cleaned cached answer shown to visitors |
| answer_word_count | int | Optional stored word count |
| generated_at | timestamptz | When the answer was generated |
| expires_at | timestamptz | Preferred refresh boundary |
| stale_after | timestamptz | Threshold for surfacing stale/degraded UI |
| status | text | `ready`, `refreshing`, `degraded`, `failed`, or `disabled` |
| generation_ms | int | Refresh duration when known |
| source_meta | jsonb | Provider-specific metadata, including refresh diagnostics like grounding flags and last failure summary |
| tool_trace_summary | jsonb | Optional compact trace summary for UI/debugging |
| created_at | timestamptz | Created timestamp |
| updated_at | timestamptz | Updated timestamp |

### demo_refresh_runs
Operational log for public-demo refresh attempts. Used to understand refresh cadence, provider failures, and degraded/stale periods during the cache-backed rollout.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| job_type | text | Refresh job category (`answer`, `news`, etc.) |
| preset_id | text | Optional preset identifier for answer jobs |
| sport | text | Optional sport for the refresh |
| provider_attempted | text | Provider used for the attempt |
| provider_model | text | Model identifier when known |
| status | text | `completed`, `failed`, `skipped`, etc. |
| error_code | text | Short internal failure code |
| error_message | text | Optional captured error message |
| started_at | timestamptz | Refresh start time |
| completed_at | timestamptz | Refresh completion time |
| duration_ms | int | Duration when known |
| source_meta | jsonb | Additional provider/runtime metadata |
| created_at | timestamptz | Created timestamp |

An external private demo runner writes one `completed`, `dry_run`, or `failed` row here for each attempted preset refresh.

Current read patterns:
- The external private runner queries recent rows by `sport` ordered by `created_at desc`
- `flaim/web` queries the latest row for a single `preset_id + sport` pair ordered by `created_at desc`

Recommended indexes:
- `demo_refresh_runs_sport_created_at_idx` on `(sport, created_at desc)` for runner health/scheduler reads
- `demo_refresh_runs_preset_sport_created_at_idx` on `(preset_id, sport, created_at desc)` for website latest-failure lookups

## Analytics Tables (MCP Usage)

Added by migration 026. The fantasy-mcp gateway writes one best-effort, fire-and-forget row to `mcp_tool_events` per MCP tool call (via the auth-worker `/internal/usage-event` endpoint). The two `*_daily` tables are permanent rollups populated by `pg_cron`, not written by the worker.

### mcp_tool_events
Raw per-tool-call event log. One row per MCP tool invocation, including scope-denied and error cases.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| ts | timestamptz | Event time; defaults to `now()` |
| env | text | Deployment environment (`prod`, `preview`, `dev`, or `unknown`) |
| user_id | text | Clerk user ID (rows with no user_id are not emitted) |
| auth_type | text | `clerk`, `oauth`, `eval-api-key`, `demo-api-key`, or `unknown` |
| client_name | text | MCP client name (e.g. Claude, ChatGPT); nullable |
| tool_name | text | MCP tool invoked (e.g. `get_standings`) |
| platform | text | Fantasy platform when present on the call; nullable |
| sport | text | Sport when present on the call; nullable |
| status | text | `ok`, `error`, or `denied` |
| error_code | text | Structured error code from the tool result when available; nullable |
| latency_ms | int | Tool-call duration; null on the scope-denied path (no handler run) |
| league_hash | text | SHA-256 of `<platform>:<league_id>` (pseudonymized league identity); nullable |

Notes:
- `correlation_id` is intentionally NOT stored here — events are aggregate analytics, not request traces.
- Raw events are pruned after 90 days via `pg_cron`; the rollup tables below retain the long-term history.

### mcp_user_daily
Permanent per-user daily rollup of MCP usage, populated by `pg_cron` from `mcp_tool_events`.

### mcp_tool_daily
Permanent per-tool daily rollup of MCP usage, populated by `pg_cron` from `mcp_tool_events`. Grain: `(day, env, auth_type, tool_name, platform, sport, status)` plus `call_count`, `p50_ms`, `p95_ms`. The `auth_type` dimension (added by migration 027) lets tool/platform trends filter to real users (`auth_type='oauth'`), excluding demo-runner and eval traffic — matching the separation `mcp_user_daily` already provides.

## Legacy/Deprecated Tables

### extension_pairing_codes (deprecated)
Used by pre‑v1.3.0 extension pairing flow (replaced by Clerk Sync Host).

### extension_tokens (deprecated)
Used by pre‑v1.3.0 extension auth tokens (replaced by Clerk JWT).

These tables remain for historical data but are no longer used in current flows.

## Notes
- Supabase service role is used in workers; RLS is enabled on all public tables but bypassed by service role. No RLS policies are needed since there is no direct client access — all queries go through workers using the service role key.
- ESPN credentials are encrypted at rest by Supabase.
- Run those migrations in order when provisioning or updating the database; they are the canonical schema reference.
