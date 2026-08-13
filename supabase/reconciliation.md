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

The table above records the baseline before-state. The FLA-247 forward
migration `20260805112500_add_platform_to_demo_tables.sql` raises the current
contract to 23 public tables and 71 public indexes. The FLA-264 forward
migration `20260813012740_split_analytics_snapshot_cadence.sql` raises it to 3
analytics tables, 3 analytics indexes, and 5 analytics functions, and adds a
sixth separately controlled cron job. Every other count is unchanged.

All public tables — the 22 baseline tables and the forward-added
`demo_target_state` — have RLS enabled and no policies. The two public views
use `security_invoker`. The analytics schema has three tables without RLS
because it is outside the Data API and is read through the direct
`analytics_readonly` database role.

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
`demo_refresh_runs`, `demo_target_state` (added by the FLA-247 forward
migration), `espn_credentials`, `espn_leagues`, `mcp_tool_daily`,
`mcp_tool_events`, `mcp_user_daily`, `oauth_codes`, `oauth_states`,
`oauth_tokens`, `platform_oauth_states`, `provider_sync_state`,
`sleeper_connections`, `sleeper_leagues`, `user_preferences`,
`yahoo_credentials`, and `yahoo_leagues`. The same forward migration adds a
`platform` column to `demo_answer_cache`, `demo_antigravity_cache`,
`demo_refresh_runs`, and `demo_refresh_attempts`.

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

`dashboard_snapshot` and `internal_users`, plus `provider_flags_snapshot`
added by the FLA-264 forward migration.

Views:

`client_mix`, `funnel_snapshot`, `health_summary`, `health_summary_7d`,
`platform_overlap`, `platform_summary`, `sport_summary`, `tool_health`,
`tool_health_7d`, `usage_daily`, `usage_rolling`, `usage_totals`,
`usage_trend`, and `user_concentration`.

Functions:

`dashboard_payload` and `refresh_dashboard_snapshot`, plus the FLA-264
forward-added `provider_flags_payload(boolean)`,
`refresh_provider_flags_snapshot()`, and the
`refresh_dashboard_snapshot(boolean)` overload.

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
| `provider-flags-snapshot` | `*/5 * * * *` | `analytics.refresh_provider_flags_snapshot()` |

That table is the phase 1 posture defined by `cron/production.sql`. The FLA-264
phase 2 cutover — `dashboard-snapshot` hourly against
`analytics.refresh_dashboard_snapshot(false)` plus a nightly
`dashboard-snapshot-internal` — is defined separately in
`cron/production-cadence-cutover.sql` and is gated on consumer verification.

## Intentional and environment-managed differences

The live catalog includes `public.cleanup_expired_extension_codes()`, but the
table it references no longer exists. No current consumer or cron job was found
for the function. The greenfield baseline therefore omits that orphan instead
of recreating a routine that fails when called.

The omission is an intended-schema decision only. It does not drop or alter the
live production function, and the baseline does not rewrite production
migration history.

The legacy `public.extension_pairing_codes` and
`public.extension_tokens` tables named in superseded documentation were absent
from the refreshed live production catalog, and no current consumer was found
for either table. They are therefore intentionally excluded from the 22-table
greenfield baseline.

## Forward contract changes after the baseline

Production migration 048 later added a `sync_recent` key to the private
analytics dashboard payload for provider-outcome monitoring. The reviewed
public counterpart is
`20260802131749_add_sync_recent_dashboard_payload.sql`. It replaces only
`analytics.dashboard_payload(boolean)` and refreshes the existing snapshot
rows; it adds no relation, grant, policy, index, extension, or scheduled job.

The FLA-247 forward migration
`20260805112500_add_platform_to_demo_tables.sql` makes the homepage-demo
contract multi-platform. It adds a `platform` column
(`not null default 'espn'`) to the four demo tables, four query-derived
composite indexes, and the service-role-only `demo_target_state` gate table
(RLS enabled, no policies), and replaces
`demo_refresh_attempt_scorecard_7d` to group by platform with `platform`
appended as the final output column. It drops nothing and leaves every
existing index — including the intentional duplicate pair on
`demo_refresh_runs` — untouched.

The FLA-264 forward migration
`20260813012740_split_analytics_snapshot_cadence.sql` splits the analytics
refresh cadence. It adds the `analytics.provider_flags_snapshot` relation with
the same id=1/id=2 variant contract as `dashboard_snapshot` and its own
`computed_at`, the `analytics.provider_flags_payload(boolean)` and
`analytics.refresh_provider_flags_snapshot()` functions, and a
`analytics.refresh_dashboard_snapshot(boolean)` overload that refreshes a
single dashboard variant. The no-argument `refresh_dashboard_snapshot()` is
restated as a wrapper over that overload and still refreshes both variants.
`analytics.dashboard_payload(boolean)` is untouched, including its
`sync_recent` key, which remains as a consumer fallback during rollout.

The new relation grants `SELECT` to `analytics_readonly` and to nothing else;
the new functions are security invokers with a fixed empty search path and no
non-owner `EXECUTE` grants. The migration adds no policy, index outside the new
primary key, extension, or scheduled job. Its cron activation is the two-phase
operation described in `README.md`.

The hosted-preview and production migration ledgers remain environment state,
not repository truth. Applying this or any later migration to a hosted database
requires its own approval and verification.

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
