# Database Schema (Supabase)

This is a lightweight map of the current Supabase tables used by Flaim. The authoritative source of truth is the migrations in `docs/migrations/`.

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
| sleeper_user_id | text | Sleeper user ID (not null) |

Constraints/Indexes:
- Unique per season: unique on `(clerk_user_id, league_id, season_year)`.
- Index on `clerk_user_id` for fast user lookups.

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
| code | text | Unique auth code |
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
| refresh_token | text | Optional refresh token |
| refresh_token_expires_at | timestamptz | Refresh token expiry |
| created_at | timestamptz | Created timestamp |

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

### public_chat_runs
Server-owned log for the public `/chat` demo. Used for per-visitor concurrency control and lightweight operational visibility.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| visitor_key | text | SHA-256 hash of the visitor IP with a server-side salt |
| preset_id | text | Public preset identifier (`show-leagues`, etc.) |
| model | text | OpenAI model used for the run |
| status | text | `running`, `completed`, `error`, `aborted`, `rate_limited`, or `concurrency_rejected` |
| error_code | text | Short internal failure code for troubleshooting |
| duration_ms | int | Run duration when known |
| started_at | timestamptz | Run start time |
| completed_at | timestamptz | Run end time |
| created_at | timestamptz | Created timestamp |
| updated_at | timestamptz | Updated timestamp |

### public_chat_context_cache
Server-owned cache for public `/chat` warm context. Used to avoid rebuilding the same demo session context and sports-news pulse on every visitor request.

| Column | Type | Notes |
|---|---|---|
| cache_key | text | Primary key (`gerry_session_v1`, `sports_today_v1`, etc.) |
| context_text | text | Cached developer-context text injected into the public demo route |
| expires_at | timestamptz | Freshness boundary for the cached entry |
| created_at | timestamptz | Created timestamp |
| updated_at | timestamptz | Updated timestamp |

## Legacy/Deprecated Tables

### rate_limits (inert)
Formerly used for per-user daily request counters. Replaced by Cloudflare Workers native `rate_limits` bindings (March 2026). Table and `increment_rate_limit` RPC remain in Supabase but nothing reads or writes to them. Safe to drop in a future cleanup.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| user_id | text | Clerk user ID |
| window_date | date | Daily window (UTC) |
| request_count | int | Requests in window |
| created_at | timestamptz | Created timestamp |
| updated_at | timestamptz | Updated timestamp |

### extension_pairing_codes (deprecated)
Used by pre‑v1.3.0 extension pairing flow (replaced by Clerk Sync Host).

### extension_tokens (deprecated)
Used by pre‑v1.3.0 extension auth tokens (replaced by Clerk JWT).

These tables remain for historical data but are no longer used in current flows.

## Notes
- Supabase service role is used in workers; RLS is enabled on all public tables but bypassed by service role. No RLS policies are needed since there is no direct client access — all queries go through workers using the service role key.
- ESPN credentials are encrypted at rest by Supabase.
- Migrations live in `docs/migrations/` and should be treated as the canonical schema reference.
