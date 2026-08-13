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
bash supabase/tests/cutover_guard.sh
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
exact duplicate before-state index. This passes the local reproducibility gate
for considering a separate hosted preview database; it does not authorize
hosted infrastructure or production changes.

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

## Analytics snapshot cadence

The forward migration
`20260813012740_split_analytics_snapshot_cadence.sql` splits the analytics
refresh into two relations on independent cadences.

`analytics.refresh_dashboard_snapshot()` computes the whole dashboard payload
twice per run. Nothing in that payload needs five-minute freshness except
`sync_recent`, the provider-outcome signal an internal monitoring consumer
polls to detect provider outages. That key reads `public.provider_sync_state`
over a trailing six-hour window and touches none of the event tables the rest
of the payload scans.

The migration adds:

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
  dashboard variant, so a scheduler can run the external row and the
  internal-inclusive row on different cadences.

`analytics.dashboard_payload()` is unchanged, including its `sync_recent` key,
which stays as a consumer fallback while databases are still being migrated.
The no-argument `analytics.refresh_dashboard_snapshot()` is retained as a
compatibility and local-seed wrapper that refreshes both variants.

The new relation is granted `SELECT` to `analytics_readonly` and to nothing
else; the new functions are security invokers with a fixed empty search path
and no non-owner `EXECUTE` grants. The migration creates no cron job.

### Two-phase cron cutover

The consumer of this signal rejects a snapshot timestamp older than 30 minutes
and **fails open** when it does — no error, no alert. Reducing the dashboard
cadence before that consumer reads the dedicated snapshot would silently stop
provider-outage monitoring. The order is therefore load-bearing:

1. **Phase 1 — `cron/production.sql`.** Adds `provider-flags-snapshot` at
   `*/5` while `dashboard-snapshot` keeps its `*/5` cadence. Both signals stay
   fresh and no consumer changes behavior. This file remains safe to re-run.
2. **Phase 2 — `cron/production-cadence-cutover.sql`.** Moves the external
   dashboard row to hourly and the internal-inclusive row to nightly. The
   whole file is one transaction, so a failed precondition rolls the schedule
   changes back rather than merely printing an error — `psql` runs the
   statements after a failed one unless `ON_ERROR_STOP` is set, so a guard
   that only raises is not a guard. It requires the relation to exist, the
   phase 1 job to be active at `*/5` running exactly the expected command,
   that command to have succeeded at least twice in the last 20 minutes, both
   variants to be fresh, and an explicit in-session acknowledgement of the
   consumer verification it cannot check itself.

   The execution-history check matters because the phase 1 migration
   populates the relation itself: fresh rows prove nothing about whether the
   schedule is firing. It matches on the command as well as the job id,
   because `cron.schedule()` updates a job with an existing name in place and
   keeps its `jobid`, while `cron.job_run_details` records the command each
   historical run executed — so a job id alone lets successes from a previous,
   unrelated command vouch for a refresh that has never run.

`scripts/check-supabase.sh` asserts this posture. Statically: the canonical
schedule file stays in phase 1, the scheduled command and the guard's expected
command cannot drift apart, and the cutover file keeps its transaction and its
command-matched history check. Behaviorally, `tests/cutover_guard.sh` runs the
real artifact against the local scheduler and requires that it activates
nothing with preconditions unmet, activates nothing when the only successful
history belongs to a previous command, and activates exactly the two expected
schedules once every precondition genuinely holds. After phase 2 has been
applied and verified in production, update `cron/production.sql` and those
assertions together.

The internal-inclusive dashboard variant is not on the alerting path. Once
phase 2 is applied it ages to roughly 24 hours; the provider-flags variant of
that same distinction stays at five minutes.

`supabase/tests/provider_flags.sql` proves, in a rolled-back transaction, that
the dedicated payload equals the dashboard payload's `sync_recent` key for both
variants, that each refresh function stamps only its own relation's
`computed_at`, that the per-variant dashboard refresh rebuilds one row and
leaves the other alone, and that an empty or aged-out sync state yields empty
arrays rather than invented provider rows.

Applying this migration to any hosted database, and activating either cron
phase, remain separate approval gates.

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
