# Database contract

Flaim uses Supabase Postgres for connected-league credentials and preferences,
MCP OAuth state, operational caches, provider synchronization state, and usage
analytics.

The reviewed, secret-free deployable contract lives in [`supabase/`](../supabase):

- [`supabase/migrations/`](../supabase/migrations) contains the greenfield
  baseline and subsequent forward-only migrations.
- [`supabase/reconciliation.md`](../supabase/reconciliation.md) inventories the
  application-owned live objects represented by the baseline.
- [`supabase/README.md`](../supabase/README.md) defines local tooling and safety
  boundaries.

The greenfield baseline does not rewrite the hosted production project's
historical migration ledger. Production migration-history changes, hosted
preview creation, and production DDL require separate approval and verification.

## Access model

Cloudflare Workers and server-side web paths use the Data API as
`service_role`. Browser clients do not query Supabase directly.

All 25 public tables currently have RLS enabled and no policies. The baseline
also reproduces the existing broad object grants and future-object defaults so
permission hardening can be performed later as an isolated, reversible
forward-only migration. Those before-state grants are not the desired final
security posture.

The Data API exposes `public` and `graphql_public`. It does not expose
`analytics`.

The internal analytics dashboard connects directly to Postgres as
`analytics_readonly`. That role is `NOLOGIN` in source; its environment-specific
login credential is provisioned outside the repository. It has schema usage and
read-only access to the analytics tables and views.

## Application-owned data

Connected-provider state:

- ESPN: `espn_credentials`, `espn_leagues`, `espn_history_jobs`
- Yahoo: `yahoo_credentials`, `yahoo_leagues`,
  `platform_oauth_states`
- Sleeper: `sleeper_connections`, `sleeper_leagues`
- Shared: `archived_leagues`, `user_preferences`, `provider_sync_state`

MCP OAuth and telemetry:

- OAuth: `oauth_states`, `oauth_codes`, `oauth_tokens`
- Telemetry: `mcp_tool_events`, `mcp_user_daily`, `mcp_tool_daily`
- Compatibility view: `oauth_connections`

Public-demo operations:

- `chat_runs`
- `demo_context_cache`
- `demo_answer_cache`
- `demo_antigravity_cache`
- `demo_refresh_runs`
- `demo_refresh_attempts`
- `demo_target_state`
- `demo_refresh_attempt_scorecard_7d`

`demo_answer_cache`, `demo_antigravity_cache`, `demo_refresh_runs`, and
`demo_refresh_attempts` carry a `platform` column (`not null default 'espn'`)
so the demo contract supports multiple fantasy platforms, and the
`demo_refresh_attempt_scorecard_7d` view groups by platform with `platform` as
its final output column. `demo_target_state` is the per-platform, per-sport
public-enable gate with expected prompt/context version tags; it is
service-role-only.

`demo_antigravity_cache` is intentionally service-role-only in the reproduced
before-state; `anon` and `authenticated` do not have table privileges on it.

`espn_history_jobs` is also service-role-only. Its `advance_espn_history_job`,
`finish_espn_history_job`, and `persist_espn_league_with_lease` RPCs are
security invokers with an empty search path. The history RPCs lock the job
before its credential snapshot and history lease, and the success/partial
terminal marker requires both fences to remain valid. The league-write RPC
requires the request's exact live ESPN lease owner before changing any row.
This FLA-308 rollout boundary is repository contract only: applying the
migration to preview or production requires separate approval and verification.

Scheduled legacy repairs are distinguished by
`espn_history_jobs.trigger_source = 'scheduled_backfill'`. A partial unique
index permits only one queued or running scheduled job. The service-role-only
`claim_next_espn_history_backfill_job` RPC serializes candidate selection,
stale-job recovery, pacing, retry eligibility, nonempty league-root seeding,
provider-lease acquisition, and job insertion in one transaction. The public
roles cannot execute it. Its additive migration must be applied before the
default-off producer is enabled in a deployed auth worker.

## Account deletion

`account_deletions` is a permanent, service-role-only tombstone
(`clerk_user_id`, `deleted_at`) written once per deleted account by the
`purge_account_data(text)` RPC, which a dedicated auth-worker webhook calls
after verifying Clerk's `user.deleted` event. The RPC deletes every row for
that `clerk_user_id` (or `user_id`, for the two MCP OAuth tables) across all
13 connected-platform and league tables listed above, in one transaction, and
is safe to replay. `oauth_states` is excluded: it has no user column and
already expires on its own.

A generic `reject_write_after_account_deletion` trigger is bound to all 13
tables (`BEFORE INSERT OR UPDATE`) so a write for an already-deleted account
is rejected indefinitely, even years later. The trigger and the purge RPC
acquire the identical per-user advisory lock via the shared
`account_deletion_lock_key(text)` helper, which is what makes "delete this
account" and "write for this account" mutually exclusive. Usage-analytics
tables (`mcp_tool_events`, `mcp_user_daily`, `mcp_tool_daily`,
`analytics.internal_users`) are explicitly out of scope for this purge.

## Analytics

The `analytics` schema contains the `internal_users` exclusion list, two
materialized payload rows in `dashboard_snapshot`, and two provider-outcome
rows in `provider_flags_snapshot`, plus views that calculate usage, retention,
client mix, tool health, funnel, platform, sport, and user concentration
metrics.

Both snapshot relations carry the same two variants: id=1 excludes internal
accounts, id=2 includes them.

`analytics.refresh_dashboard_snapshot()` refreshes both dashboard variants;
`analytics.refresh_dashboard_snapshot(boolean)` refreshes one, so the two
variants can run on different cadences.
`analytics.refresh_provider_flags_snapshot()` refreshes the provider snapshot,
whose payload is the same provider-outcome data as the dashboard payload's
`sync_recent` key but with its own `computed_at`. Splitting it out lets the
signal that needs five-minute freshness keep it while the expensive dashboard
payload does not.

## Scheduled maintenance

The reviewed production schedule defines six database-native jobs:

- daily MCP rollup
- daily MCP raw-event pruning
- daily OAuth token cleanup
- daily ephemeral OAuth cleanup
- five-minute dashboard snapshot refresh
- five-minute provider flags snapshot refresh

Their definitions live in `supabase/cron/production.sql`, outside the
migration path. A local reset or preview database therefore does not activate
background work, and activating a job on a hosted database is a separate
approval gate from the migration that adds the function it calls.

Reducing the dashboard refresh cadence is a separate, gated second phase in
`supabase/cron/production-cadence-cutover.sql`; see `supabase/README.md` for
why the order matters and what the guard checks.

Exact columns, constraints, indexes, views, functions, and grants belong in the
SQL contract rather than a second prose copy here.
