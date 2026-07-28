# Baseline reconciliation manifest

Observed source catalog: hosted production, read-only inspection on
2026-07-27. Intended target: a greenfield, secret-free Flaim application
contract.

## Catalog represented by the baseline

| Kind | `public` | `analytics` | Baseline treatment |
|---|---:|---:|---|
| Tables | 22 | 2 | Reproduced |
| Views | 2 | 14 | Reproduced |
| Functions | 10 observed | 2 | 9 public and both analytics functions reproduced |
| Indexes | 66 | 2 | Reproduced, including constraint indexes |
| Sequences | 2 | 0 | Reproduced through identity columns |
| Non-internal triggers | 0 | 0 | None created |
| Cron jobs | 5 | — | Defined separately; not activated by migrations |

All 22 public tables have RLS enabled and no policies. The two public views use
`security_invoker`. The analytics schema has two tables without RLS because it
is outside the Data API and is read through the direct `analytics_readonly`
database role.

The Data API configuration exposes `public` and `graphql_public`; it does not
expose `analytics`. The baseline preserves `pg_graphql` and the observed broad
current-object and future-object grants as before-state behavior. Those are
hardening inputs, not claims that the final permissions are desirable.

## Reproducibility proof

On 2026-07-27, Supabase CLI 2.110.0 ran the baseline twice from clean local
Postgres 17.6 databases. Both resets produced identical hashes for relations,
logical columns, constraints, indexes, views, retained functions, current
object grants, schema grants, default ACLs, extensions, policies, role
attributes, and the migration ledger. Both lint runs reported no schema errors,
the final migration-to-local diff was empty, and the synthetic seed passed its
row, OAuth-invalidity, analytics, and cron-absence assertions. Local advisors
reported no errors and only the expected exact-duplicate-index warning.

A read-only production comparison matched relations, logical columns,
constraints, all 68 indexes, views, object/schema/default grants, policies, and
extension placement. The retained functions were token-equivalent after
normalizing SQL formatting, equivalent type aliases and interval syntax, one
local variable name, and redundant casts.

## Public objects

Tables:

`archived_leagues`, `chat_runs`, `demo_answer_cache`,
`demo_antigravity_cache`, `demo_context_cache`, `demo_refresh_attempts`,
`demo_refresh_runs`, `espn_credentials`, `espn_leagues`, `mcp_tool_daily`,
`mcp_tool_events`, `mcp_user_daily`, `oauth_codes`, `oauth_states`,
`oauth_tokens`, `platform_oauth_states`, `provider_sync_state`,
`sleeper_connections`, `sleeper_leagues`, `user_preferences`,
`yahoo_credentials`, and `yahoo_leagues`.

Views:

`demo_refresh_attempt_scorecard_7d` and `oauth_connections`.

Functions retained:

`acquire_public_chat_run`, `complete_public_chat_run`,
`cleanup_expired_oauth_codes`, `cleanup_expired_oauth_ephemeral`,
`cleanup_expired_oauth_states`, `cleanup_expired_oauth_tokens`,
`cleanup_expired_platform_oauth_states`, `prune_mcp_events`, and
`rollup_mcp_usage`.

## Analytics objects

Tables:

`dashboard_snapshot` and `internal_users`.

Views:

`client_mix`, `funnel_snapshot`, `health_summary`, `health_summary_7d`,
`platform_overlap`, `platform_summary`, `sport_summary`, `tool_health`,
`tool_health_7d`, `usage_daily`, `usage_rolling`, `usage_totals`,
`usage_trend`, and `user_concentration`.

Functions:

`dashboard_payload` and `refresh_dashboard_snapshot`.

## Extensions and scheduled work

The baseline enables `pg_cron`, `pg_graphql`, `pg_stat_statements`, `pgcrypto`,
`supabase_vault`, and `uuid-ossp` in their observed schemas. Extension versions
are intentionally not pinned in migration SQL because hosted Supabase is
retiring extension-version pinning.

The separately controlled production schedule defines:

| Job | Schedule | Function |
|---|---|---|
| `mcp-rollup` | `15 5 * * *` | `public.rollup_mcp_usage()` |
| `mcp-prune` | `30 5 * * *` | `public.prune_mcp_events()` |
| `oauth-tokens-cleanup` | `45 5 * * *` | `public.cleanup_expired_oauth_tokens()` |
| `oauth-ephemeral-cleanup` | `47 5 * * *` | `public.cleanup_expired_oauth_ephemeral()` |
| `dashboard-snapshot` | `*/5 * * * *` | `analytics.refresh_dashboard_snapshot()` |

## Intentional and environment-managed differences

The live catalog includes `public.cleanup_expired_extension_codes()`, but the
table it references no longer exists. No current consumer or cron job was found
for the function. The greenfield baseline therefore omits that orphan instead
of recreating a routine that fails when called.

The omission is an intended-schema decision only. It does not drop or alter the
live production function, and the baseline does not rewrite production
migration history.

Production's physical column numbers contain three gaps left by dropped columns
in `demo_answer_cache`, `demo_refresh_runs`, and `yahoo_leagues`. A greenfield
database intentionally creates the same logical columns without preserving
those storage-history gaps.

The local platform default supplied `pg_graphql` 1.6.1 while production still
reported 1.5.11. Extension names and schemas match; versions remain unpinned and
platform-managed.

The source contract creates `analytics_readonly` as `NOLOGIN`. Production
enables login and provisions its credential out of band. The role's remaining
attributes and grants match.
