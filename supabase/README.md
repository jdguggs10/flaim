# Flaim Supabase contract

This directory is the reviewed, secret-free database contract for Flaim. It is
intended to create a new environment from scratch; it does not copy or repair
the hosted production project's historical migration ledger.

The initial migration deliberately reproduces the observed database
**before-state**, including broad Data API grants and the known exact duplicate
index. Keeping those properties in the baseline lets later hardening and
maintenance changes remain small, forward-only, independently reviewable
migrations.

The [reconciliation manifest](./reconciliation.md) records the live objects
represented by this baseline and its one intentional omission.

The current forward contract has 26 public tables and 78 public indexes. Its
FLA-308 migration adds service-role-only `espn_history_jobs` and the
`advance_espn_history_job(...)`, `finish_espn_history_job(...)`, and
`persist_espn_league_with_lease(...)` RPCs. The FLA-311 migration adds the
service-role-only `account_deletions` tombstone, the `purge_account_data(...)`
RPC, and a shared advisory-lock guard trigger bound to every user-keyed table.
`supabase/tests/account_deletions.sql` proves the ACLs, the purge, all 13
guard-trigger rejections, and idempotent replay inside a rolled-back
transaction. `supabase/tests/account_deletions_concurrency.sh` independently
races two live database sessions and requires the per-user advisory lock to
genuinely serialize a concurrent writer against a concurrent purge in both
directions (writer commits first and is still cleaned up by the purge;
purge commits first and the writer is rejected once the tombstone lands). Those security-invoker RPCs use an
empty search path. History progress and success/partial repair markers preserve
the job's credential and lease fences, while request-time league writes require
the exact live ESPN lease owner.
The local proof covers this behavior, but hosted preview or production rollout
remains a separate approval and verification boundary.

## Safety boundary

- The repository contains no database passwords, tokens, connection strings, or
  production rows.
- `analytics_readonly` is created as `NOLOGIN`. Any credential provisioning is
  an out-of-band, environment-specific operation.
- `supabase_admin` remains platform-owned. Its default ACLs are verified during
  reset proof rather than changed by application migrations.
- `analytics` is not exposed through the Data API configuration.
- The six production cron jobs are defined in
  `cron/production.sql`, outside the migration path. Local resets and preview
  databases therefore do not activate background jobs.
- Never run `supabase db reset --linked` or use a production database URL for a
  reset. Linking, hosted preview creation, migration-history changes, and
  production DDL require separate approval.

## Tooling

Running the checks locally needs Docker (the CLI starts a local Postgres
container) and `ripgrep` on `PATH`. `scripts/check-supabase.sh` greps its
source and cron-artifact guards with `rg` and exits early if it is absent,
because a missing binary would otherwise make those guards pass by never
running.

Use Node.js 24 and the exact Supabase CLI version pinned in the root
`package.json` and lockfile:

```sh
corepack pnpm exec supabase --version
```

Run the complete two-reset proof locally with:

```sh
bash scripts/check-supabase.sh
```

The same local-only command runs in GitHub Actions for database-contract,
toolchain, or workflow changes. It never links to or contacts a hosted
Supabase project.

The database-contract verification flow is:

```sh
corepack pnpm exec supabase db start
corepack pnpm exec supabase db reset --local
docker cp supabase/tests/reproducibility.sql supabase_db_flaim:/tmp/reproducibility.sql
docker exec supabase_db_flaim psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/reproducibility.sql
docker cp supabase/tests/token_rpc.sql supabase_db_flaim:/tmp/token_rpc.sql
docker exec supabase_db_flaim psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/token_rpc.sql
docker cp supabase/tests/provider_flags.sql supabase_db_flaim:/tmp/provider_flags.sql
docker exec supabase_db_flaim psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/provider_flags.sql
docker cp supabase/tests/dashboard_single_refresh.sql supabase_db_flaim:/tmp/dashboard_single_refresh.sql
docker exec supabase_db_flaim psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/dashboard_single_refresh.sql
docker cp supabase/tests/espn_history_jobs.sql supabase_db_flaim:/tmp/espn_history_jobs.sql
docker exec supabase_db_flaim psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/espn_history_jobs.sql
corepack pnpm exec supabase db lint --local --schema public,analytics --level warning --fail-on error
corepack pnpm exec supabase db advisors --local --type security --level warn --fail-on error
corepack pnpm exec supabase db diff --local --schema public,analytics
```

`db reset --local` recreates the local Postgres container, applies timestamped
files in `supabase/migrations`, then applies `seed.sql`. The seed contains only
fixed synthetic identifiers and deliberately invalid credential-shaped values.

On 2026-07-27, two clean local resets produced identical reviewed catalog,
privilege, extension, role, policy, migration, cron-absence, and seed-summary
hashes. Both lint runs found no schema errors, and the final local schema diff
was empty. Local advisors reported no errors and one expected warning for the
exact duplicate before-state index. That proof satisfied the reproducibility
gate for creating the dedicated hosted preview database, which is now the
synthetic-data rehearsal lane. It does not prove that hosted preview has every
later migration applied, or authorize a hosted preview migration, production
change, or production-data copy; each remains a separate approval gate.

## Analytics monitoring payload

The forward migration
`20260802131749_add_sync_recent_dashboard_payload.sql` keeps the greenfield
contract current with the private analytics monitoring behavior introduced by
production migration 048. It restates `analytics.dashboard_payload(boolean)`
to add the `sync_recent` provider-outcome key and refreshes the two existing
dashboard snapshot rows. It creates no tables, grants, policies, indexes,
extensions, or cron jobs.

The reproducibility proof requires both synthetic snapshot rows to contain one
recent ESPN success and no recent failure. Applying this migration to any
hosted database remains a separate approval gate.

## ET-day analytics history

The additive FLA-265 migrations preserve user-level usage at
America/New_York day grain without changing the existing UTC rollups or the
90-day raw-event retention policy.

`public.mcp_user_daily_et` stores call counts by ET day, environment, user,
authentication type, nullable client name, platform, and sport. NULL and
literal empty values remain distinct in the unique grain. Platform and sport
are event attribution, not complete user/provider identity: setup and
cross-platform calls can lack them, and sport is not a league season year.
The current payload sums across these dimensions without adding new metrics.
The table has RLS enabled with no policies and is
owner-only, including no access for `service_role` or `analytics_readonly`.

`analytics.history_rollup_state` is an owner-only singleton recording the
explicit initial history date and the last fully closed ET day. The migration
lands it uninitialized; the synthetic seed initializes it through yesterday
before creating dashboard snapshots.
`public.close_mcp_user_daily_et(date, date)` performs the first backfill and
later catch-up closes under that row's lock, rejects open days or
ranges outside the fully available raw window, and advances the marker only
after the replacement succeeds. The first call must declare its history start
instead of inferring an all-time claim from the oldest raw row.

`analytics.dashboard_payload_history(boolean)` is the owner-only history
implementation behind the canonical `analytics.dashboard_payload(boolean)`
wrapper. Once history is initialized, it reads the
ET aggregate through the marker and raw ET days strictly after it. It fails
closed when history is uninitialized or too stale to bridge from retained raw
events. Existing raw recent-use windows, UTC `client_mix`, seven-day health,
provider state, connector state, and league summaries keep their current
sources. The historical `health_summary` and `tool_health` keys use exact
trailing 30-day raw data and add `health_window_days: 30` to disclose that
window. `user_concentration` keeps call-count ranking; equal-call user rank
order remains unspecified, while equal-weight client modes use a stable lexical
tie-break after ignoring NULL client names.

The additive table/function migrations do not backfill data, refresh a
snapshot, create a cron job, or activate a schedule. A later forward migration
makes the thin history wrapper canonical for fresh environments; the seed
initializes only synthetic local history. Hosted backfill, reader promotion,
and scheduling remain explicit operational changes.

The forward platform/sport refinement likewise performs no backfill or
activation. It locks the progress state and aggregate, and refuses initialized
history or any existing aggregate row before changing the grain. It must land
before the initial close. Never start that close concurrently with the
migration: relation locks do not replace a function body already compiled by
a waiting call. Start backfill only after the migration commits.
An already-populated environment needs a separately
reviewed rebuild while complete raw coverage is still available; clearing its
marker or labelling old rows with NULL dimensions is not a recovery procedure.

History-job monitoring must be independent of dashboard refresh success. The
raw bridge intentionally tolerates missed closes, so a fresh snapshot alone
does not prove preservation is running. Failed jobs and a marker that has not
advanced by the next scheduled close require timely operator notification.
Activating a job and inspecting one successful run is not ongoing monitoring.

The reviewed scheduling artifact lives outside the migration path:
`cron/analytics-history.sql` schedules history preservation only after an
explicit initial close/backfill has been verified. The one-time guarded
`cron/analytics-history-cutover.sql` artifact is retained as the production
rollout record, but fresh environments receive the reader through the forward
migration. Before using that historical artifact, capture the exact existing
`analytics.dashboard_payload(boolean)` definition as the rollback source.
Restoring that raw-only definition is history-safe only while raw events still
cover the full declared history; after pruning, it cannot reconstruct or serve
the preserved older days and must not be presented as a complete rollback.

## Analytics snapshot cadence

The forward migration
`20260813012740_split_analytics_snapshot_cadence.sql` splits the analytics
refresh into two independent relations. It adds:

- `analytics.provider_flags_snapshot`, with the same two-variant contract as
  `dashboard_snapshot` (id=1 external-only, id=2 internal-inclusive) and its
  own `computed_at`.
- `analytics.provider_flags_payload(boolean)`, which reproduces the existing
  `sync_recent` computation exactly — same window, same distinct failing and
  succeeding user counts, same distinct recent error codes, same internal-user
  exclusion, and no row for a provider with no sync state.
- `analytics.refresh_provider_flags_snapshot()`, which replaces both variants
  in one statement so they share a transaction timestamp.
- `analytics.refresh_dashboard_snapshot(boolean)`, which refreshes one
  dashboard variant explicitly.

`analytics.dashboard_payload()` remains the complete consumer contract,
including its `sync_recent` key, but now delegates to the history-backed
implementation.

The new relation is granted `SELECT` to `analytics_readonly` and to nothing
else; the new functions are security invokers with a fixed empty search path
and no non-owner `EXECUTE` grants. The migration creates no cron job.

`20260909005730_compute_single_inclusive_dashboard_snapshot.sql` then changes
the no-argument `analytics.refresh_dashboard_snapshot()` compatibility entry
point to compute the internal-inclusive human payload once and upsert only
dashboard row id=2. Row id=1 remains unchanged rather than being deleted; the
boolean overload can still rebuild either row explicitly for comparison or
rollback. The migration does not change function ownership, privileges, the
provider-flags path, or cron.

`cron/production.sql` keeps both `dashboard-snapshot` and
`provider-flags-snapshot` at `*/5`. The provider consumer receives its rows and
freshness timestamp only from `provider_flags_snapshot`; the dashboard is not
an alerting fallback.

`supabase/tests/provider_flags.sql` proves, in a rolled-back transaction, that
the dedicated payload equals the dashboard payload's `sync_recent` key for both
variants, that each refresh function stamps only its own relation's
`computed_at`, that the per-variant dashboard refresh rebuilds one row and
leaves the other alone, and that an empty or aged-out sync state yields empty
arrays rather than invented provider rows.
`supabase/tests/dashboard_single_refresh.sql` proves that the no-argument
refresh contains one inclusive payload call, leaves id=1 and provider flags
unchanged, rebuilds id=2 correctly, and preserves the boolean overload as the
explicit id=1 restoration path.

Applying either migration to any hosted database and activating cron remain
separate approval gates.

## Demo platform contract

The forward migration `20260805112500_add_platform_to_demo_tables.sql` makes
the homepage-demo contract multi-platform. It adds a `platform` column
(`not null default 'espn'`) to `demo_answer_cache`, `demo_antigravity_cache`,
`demo_refresh_runs`, and `demo_refresh_attempts`; adds four query-derived
composite indexes; replaces `demo_refresh_attempt_scorecard_7d` to group by
platform, appending `platform` as the final output column; and creates the
`demo_target_state` gate table recording the per-platform, per-sport
public-enable flag and expected prompt/context version tags.

Existing demo rows and single-platform writers keep working through the
column defaults, and no existing index is touched. `demo_target_state`
matches the `demo_antigravity_cache` posture: RLS enabled with no policies
and table privileges granted only to `service_role`. Applying this migration
to any hosted database remains a separate approval gate.

## Token-matching RPCs

The forward migration after the baseline moves MCP OAuth and Yahoo
credential-shaped comparisons into service-role-only Postgres functions.
Supabase RPC calls use their default `POST` behavior so function arguments are
carried in the JSON body rather than PostgREST filter URLs. The functions are
security invokers with an empty search path; `EXECUTE` is revoked from
`PUBLIC`, `anon`, and `authenticated`, and granted only to `service_role`.

Hosted databases are promoted separately from Worker code. Until a database
has this migration, the Worker recognizes only PostgREST's `PGRST202`
missing-function response and uses the pre-migration query path. Other RPC
errors fail normally. After the migration is present, the body-based path is
selected automatically. The compatibility path preserves the previous
non-atomic behavior; the new single-use and lease concurrency guarantees begin
only after the hosted database has the RPC migration.

`supabase/tests/token_rpc.sql` proves the function ACLs, state/code/refresh
single-use behavior, idempotent revocation, Yahoo lease exclusion, and guarded
credential recovery with synthetic rows inside a rolled-back transaction.
`supabase/tests/token_rpc_concurrency.sh` independently races two database
sessions and requires exactly one MCP refresh winner and one Yahoo lease
winner, then removes its synthetic fixtures.

Rollback is Worker-first: restore the previous Auth Worker version before
removing any function, so no deployed caller loses its database dependency.
The additive functions may safely remain unused during observation. If removal
is later required, drop only the nine signatures introduced by
`20260728210429_move_token_matching_to_rpc.sql` after the Worker rollback is
confirmed. Hosted preview application and every production promotion remain
separate approval gates.

```sql
begin;
drop function if exists public.create_mcp_oauth_state(text, text, text, timestamptz);
drop function if exists public.consume_mcp_oauth_state(text, text, text);
drop function if exists public.claim_mcp_oauth_code(text);
drop function if exists public.find_mcp_oauth_access_token(text);
drop function if exists public.claim_mcp_oauth_refresh_token(text);
drop function if exists public.revoke_mcp_oauth_access_token(text);
drop function if exists public.consume_yahoo_oauth_state(text);
drop function if exists public.acquire_yahoo_refresh_lease(text, text, timestamptz, text);
drop function if exists public.recover_yahoo_credentials(text, text, text, timestamptz, text, text);
commit;
```
