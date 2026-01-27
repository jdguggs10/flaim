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
- Per-sport defaults are JSONB with `{ platform: "espn"|"yahoo", leagueId: string, seasonYear: number }`.
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

### rate_limits
Per-user daily request counters (UTC).

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| user_id | text | Clerk user ID |
| window_date | date | Daily window (UTC) |
| request_count | int | Requests in window |
| created_at | timestamptz | Created timestamp |
| updated_at | timestamptz | Updated timestamp |

## Legacy/Deprecated Tables

### extension_pairing_codes (deprecated)
Used by pre‑v1.3.0 extension pairing flow (replaced by Clerk Sync Host).

### extension_tokens (deprecated)
Used by pre‑v1.3.0 extension auth tokens (replaced by Clerk JWT).

These tables remain for historical data but are no longer used in current flows.

## Notes
- Supabase service role is used in workers; RLS is enabled for OAuth and rate limit tables but bypassed by service role.
- ESPN credentials are encrypted at rest by Supabase.
- Migrations live in `docs/migrations/` and should be treated as the canonical schema reference.
