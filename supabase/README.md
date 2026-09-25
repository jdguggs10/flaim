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

The current forward contract has 27 public tables and 78 public indexes. Its
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
docker cp supabase/tests/signup_log.sql supabase_db_flaim:/tmp/signup_log.sql
docker exec supabase_db_flaim psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/signup_log.sql
bash supabase/tests/signup_log_concurrency.sh
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
events. Its 60-day stale guard deliberately fails while the 90-day raw source
still leaves roughly 30 days to recover. If the daily close stalls, inspect the
failed `mcp-et-history-close` run, resolve its cause, then call
`public.close_mcp_user_daily_et()` as `postgres`; the initialized function
resumes at the day after the marker and catches up through yesterday. Confirm
the marker advanced before refreshing or trusting the dashboard again.
Existing raw recent-use windows, UTC `client_mix`, seven-day health,
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

The FLA-357 migration adds two keys to each `usage_trend` day and changes
nothing else: `mau_30d`, a rolling 30-day distinct-user count computed from the
same `history_user_days` set and the same correlated-subquery shape as the
existing `wau_7d`, and `mau_30d_partial`, true while that 30-day window reaches
back before the first day of available history. The flag follows
`retention_weekly`'s `week_partial_start` contract: the value stays a real
distinct count over the days that exist, and the flag discloses that the window
is shorter than 30 days rather than nulling or hiding the row. The scalar
`rolling.mau` is deliberately unchanged — it measures a trailing 720 hours at
snapshot time, not 30 complete ET days, and remains the payload's current-value
MAU.

History-job monitoring must be independent of dashboard refresh success. The
raw bridge intentionally tolerates missed closes, so a fresh snapshot alone
does not prove preservation is running. Failed jobs and a marker that has not
advanced by the next scheduled close require timely operator notification.
Activating a job and inspecting one successful run is not ongoing monitoring.

The production `mcp-rollup` job reprocesses the trailing seven completed UTC
days on every 05:15 run. `public.rollup_mcp_usage(date)` replaces one day's
aggregate in the same transaction, and its raw-event bounds are explicitly
UTC. This bounded replay repairs a short missed run before raw-event pruning
without changing completed-day results. It is scheduled fifteen minutes before
the 05:30 prune job; a longer outage needs explicit operator recovery.

The FLA-378 optimization keeps this payload contract unchanged while removing
two growth-sensitive query shapes. Raw rows after the close marker are selected
with an indexed `ts` lower bound derived from the next America/New_York
midnight, rather than applying an ET-date expression to every retained event.
User concentration computes each user's call-weighted client mode in one
grouped pass, rather than rescanning materialized history once per user. The
call-count descending and client-name lexical tie-break remains unchanged, and
NULL clients remain excluded from mode selection.

The FLA-412 optimization likewise keeps the payload's keys, value types,
values, rounding, windows, and ordering expressions unchanged while
consolidating raw-event reads. The order of tool rows tied on `calls` was
unspecified before and remains unspecified. `rolling` reads the trailing 30
days once, grouped by user, instead of scanning every retained event four
times; a user counts toward a trailing window exactly when that user's latest
event falls inside it, and its `user_id is not null` filters defensively
mirror the predecessor's `count(distinct user_id)`. The four raw health keys
share one `grouping sets ((tool_name), ())` pass over the 30-day window, with
seven-day values as filtered aggregates of the same rows; `tool_health_7d`
still lists only tools with a seven-day call. The migration refuses to run
unless the digest of the exact deployed function body is the reviewed FLA-378
body with the 60-day stale guard,
`md5(prosrc) = '3bf5ed96d09f081c91ac4d42e96b3301'`, and refuses to commit
unless the body it installed has
`md5(prosrc) = 'b022a8d9c651d372e6ef9be8b5192bc2'`.

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

`cron/production.sql` runs `dashboard-snapshot` at `*/15` and keeps
`provider-flags-snapshot` at `*/5`. The human dashboard can therefore be up to
fifteen minutes behind live activity. The provider consumer receives its rows
and freshness timestamp only from `provider_flags_snapshot`; the dashboard is
not an alerting fallback and its slower cadence does not delay provider-health
signals.

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

## Funnel day history

`20260909180000_add_funnel_daily_history.sql` adds `analytics.funnel_daily`,
one row per America/New_York day and funnel stage, and makes the existing
no-argument `analytics.refresh_dashboard_snapshot()` upsert today's rows from
the payload it just stored. The funnel was previously current-state only: the
`analytics.funnel_snapshot` view and the payload's `funnel` key are both
recomputed from live tables on every read, so no stage had a trend.

The write reuses the payload returned by the snapshot upsert instead of calling
`analytics.dashboard_payload(...)` a second time, so the recorded stages cannot
drift from the ones the dashboard displays and the payload is still computed
once per run. Because the snapshot job runs every five minutes, the ET day is
the natural key: an open day tracks intraday and a completed day holds the value
observed at its final refresh of that day, which is a periodic snapshot rather
than a midnight-exact close. No close step is needed, because nothing this table
reads is pruned.

Only the scheduled no-argument path writes history. The
`analytics.refresh_dashboard_snapshot(boolean)` overload can rebuild the
external row id=1, whose funnel excludes internal users, and must not mix that
population into the same key. The write shares the refresh transaction with no
exception handler on purpose: its only realistic failures are operator-visible
schema or grant changes, and suppressing them would silently produce the gapped
history the table exists to prevent.

The table is created empty and is never backfilled. `espn_leagues`,
`yahoo_leagues`, `sleeper_leagues`, and `sleeper_connections` are hard-deleted
on disconnect and by `public.purge_account_data()`, so reconstructing past days
from `created_at` would undercount every one of them by everyone who has since
disconnected. History begins at the first scheduled refresh after the migration
lands.

`analytics_readonly` receives `SELECT` and nothing else, matching
`provider_flags_snapshot` rather than the owner-only `public.mcp_user_daily_et`:
this relation lives in the schema that is outside the Data API, holds only
aggregate stage counts that role can already read at current value, and carries
no user identifiers. RLS stays off deliberately — with no policies it would hide
every row from that role.

`supabase/tests/dashboard_single_refresh.sql` proves the recorded rows equal the
stored inclusive funnel, that repeating the refresh updates in place instead of
appending, and that the boolean overload writes no history.
`supabase/tests/reproducibility.sql` proves the ACL, the absence of RLS, and
that the seed's own refresh is what populates the single seeded day.

## ESPN connection creation time

`20260909210000_add_espn_credentials_created_at.sql` adds
`created_at timestamptz not null default now()` to `public.espn_credentials`.
That table carried only `updated_at`, making it the one connection-owning table
with no creation timestamp: `yahoo_credentials` and `sleeper_connections` both
carry `created_at`, as does `espn_leagues`. Because `updated_at` moves on every
credential re-sync, nothing recorded when an ESPN connection was first
established, so ESPN was absent from any tenure or cohort question the other
two platforms answer trivially.

`not null` is deliberately stricter than the sibling tables, whose `created_at`
is nullable: a nullable creation timestamp would leave the same "we cannot tell
when" gap open. Nothing writes the column. `EspnSupabaseStorage.setCredentials`
is the only writer of the table, and it inserts only when no row exists and
otherwise UPDATEs an explicit column list that omits `created_at`, so the
default stamps first connection and nothing moves it afterwards. A disconnect
hard-deletes the row, so a later reconnect correctly stamps a new time.

Rows that exist when the migration runs receive the migration's own run time,
not their true creation time, and there is no honest way to recover it:
`updated_at` has already moved for anyone who re-synced, and
`espn_leagues.created_at` was itself reset by manual league replacement until
the same change fixed it. Following the no-backfill principle of the funnel
history above, ESPN connection history is honest from this migration forward,
and readers must treat earlier rows as censored at that timestamp rather than
as same-day connections. The column carries a `COMMENT` saying so.

The migration adds no index, constraint, trigger, or grant. Table privileges
already cover new columns, so `reproducibility.sql`'s relation, index, and
grant assertions are unchanged; only the runtime-computed column hash moves,
and it moves identically across both resets.

`ADD COLUMN` is metadata-only here — `now()` is STABLE, so Postgres evaluates it
once and stores it as a table-level default instead of rewriting the table — but
it still takes an `ACCESS EXCLUSIVE` lock for the moment it runs, and it queues
every other reader and writer behind it while it waits for that lock. The
migration therefore sets `lock_timeout = '5s'` for its own transaction, so a
long-running transaction holding a conflicting lock fails the migration fast
instead of stalling the ESPN credential path for as long as that transaction
lives.

## Signup log

`20260915120000_add_signup_log.sql` adds `public.signup_log`, the
`public.record_signup(...)` write RPC, and three aggregate `analytics` views,
and adds one redaction statement to `public.purge_account_data(text)`.
`20260924200000_add_signups_hourly_paths.sql` (FLA-413) adds a fourth
aggregate view, `analytics.signups_hourly_paths`, and nothing else.

`signup_log` holds exactly four columns — `clerk_user_id` (the natural key and
the only dedupe that matters), `created_at` (Clerk's own signup instant, never
the observation time), nullable `first_touch`, and a `source` constrained to
`webhook` or `backfill`. There is no email column here or in any view over it,
and no index on `created_at`: the table holds roughly one row per account ever
created and every view over it scans it whole.

The grants are the boundary. Both baseline default-privilege traps apply and
`GRANT` is additive, so the migration revokes the table and the function from
`public`, `anon`, `authenticated`, and `service_role` before granting
`service_role` `INSERT`, `UPDATE (first_touch)`, and
`SELECT (clerk_user_id, first_touch)` on the table and `EXECUTE` on the RPC.
`select *` by `service_role` therefore fails. RLS is enabled with no policies
as a second layer; it blocks the browser roles and does not bind
`service_role`, which carries `BYPASSRLS`. The four `analytics` views are
owned by `postgres` and so bypass the table's RLS by design, exactly as
`analytics.funnel_snapshot` does; their boundary is the explicit view ACL plus
`analytics` not being exposed on the Data API.

`record_signup` is a contract and a place for the conflict logic, not a
privilege boundary: it is `security invoker` with an empty search path, like
`purge_account_data`. It validates its arguments, takes the same per-user
advisory lock through `account_deletion_lock_key(text)`, and performs one
upsert. `created_at` and `source` are never overwritten; `first_touch` is
fill-if-null, so a later delivery can supply attribution an earlier one lacked
but nothing replaces attribution already captured. When a tombstone exists,
`first_touch` is written as NULL on both the insert and the conflict path and
nothing is raised — the signup fact is still recorded, so counts stay right.
The anti-resurrection guard trigger is deliberately not attached, because a
late `user.created` retry would otherwise raise and burn every webhook retry on
an event that is correct to record.

`analytics.signups_daily` is one row per Eastern calendar day with `signups`
(deleted accounts excluded) and `signups_including_deleted`.
`analytics.signup_rollups` is a single row of the seven window counts, the live
total, and the `now_at` they were all computed from, so a reader samples one
clock with the data. `analytics.signup_sources_daily` is one row per ET day and
bounded first-touch dimension, lower-cased in SQL, with a `has_campaign_fields`
flag; it exposes attributed, non-deleted rows only. None of the three exposes
`clerk_user_id`, raw `first_touch` jsonb, or `landing_path`, and
`analytics_readonly` receives `SELECT` on them and nothing else.

`analytics.signups_hourly_paths` serves an internal hourly acquisition monitor.
It is zero-filled: exactly one row per America/New_York wall-clock hour for the
trailing 21 days plus the open current hour (505 rows), so an hour with no
signups is a real row of zeros rather than a missing key. `hour_et` is a local
`timestamp`, so the same hour on an earlier day is plain wall-clock
subtraction; at the autumn DST change the local 01:00 bucket holds two real
hours, and at the spring change the local 02:00 bucket is always empty. Each
row carries `total` and five path counts: `card_flow` (attributed, no referrer
host, first landing on the OAuth consent page — the connector install flow),
`ref_chatgpt`, `ref_google`, `ref_claude`, and `noref_site` (attributed, no
referrer host, any other landing). Referrer hosts are lower-cased and a NULL or
empty host counts as none; the categories are not exhaustive, so another
referrer counts toward `total` only. Deleted accounts are excluded with the
same `account_deletions` anti-join the daily views use. Hourly buckets are
finer-grained than the daily views but remain identifier-free aggregates: the
landing path is read only inside a predicate, and no identifier, raw jsonb, or
free-text referrer column is exposed. It has the same owner and exact ACL as
the other three.

`purge_account_data` gains one statement — set `first_touch` to NULL for that
identifier — placed after the tombstone insert and inside the lock. The table
is deliberately not added to the delete list: the row survives and only the
attribution goes, which is what the published retention promise requires. The
statement reads `clerk_user_id`, so the column-scoped `SELECT` grant is
load-bearing for the entire purge transaction.

`supabase/tests/signup_log.sql` proves every grant by execution rather than by
inspecting an ACL, plus replay, fill-if-null, update-before-create,
tombstone-before-write, write-before-purge, a full purge run, and the view
semantics including ET-versus-UTC day placement. For the hourly view it also
pins the exact column list and proves the 505-row zero-filled span, ET-hour
placement, each path classification, deleted-account exclusion, and the scan
bound, with fixtures placed relative to the transaction's fixed `now()`.
`supabase/tests/signup_log_concurrency.sh` races two live sessions in both
orders and requires the advisory lock to serialize them, with the
tombstone-aware result in each case and no deadlock.

### Rollback artifacts

`supabase/rollback/` holds reviewed, shipped-but-not-applied reversal scripts.
Like `supabase/cron/`, it sits outside the migration path on purpose: a local
`supabase db reset` applies every timestamped file in `supabase/migrations`, so
a rollback stored there would undo its own migration on every reset. Applying
one is a separate, explicitly approved operation.

`supabase/rollback/20260915_rollback_signup_log.sql` reverses the signup log in
a fixed order — restore `purge_account_data` to its pre-FLA-396 definition
first, then drop the four views over the table, then the RPC, then the table.
The restored function body is reproduced verbatim rather than referenced.
Reversing that order would leave the live purge referencing a table that no
longer exists, and the next real account deletion would fail outright. The table
drop has no `CASCADE`, so any later view over `signup_log` must be added to the
view-drop step or the whole rollback fails.

`supabase/rollback/20260924_rollback_signups_hourly_paths.sql` drops only
`analytics.signups_hourly_paths`. It loses no data, since the view is computed
from `signup_log`. Pause the internal hourly acquisition monitor that reads it
first; otherwise the monitor sees repeated read failures and reports its data
source as unusable.

`supabase/rollback/20260924_rollback_consolidate_dashboard_raw_scans.sql`
restores `analytics.dashboard_payload_history(boolean)` to its pre-FLA-412
body, reproduced verbatim, with the same owner and ACL. It refuses to run
unless the digest of the exact live function body is the FLA-412 body,
`md5(prosrc) = 'b022a8d9c651d372e6ef9be8b5192bc2'`, and commits only if the
restored body's digest is the reviewed predecessor,
`md5(prosrc) = '3bf5ed96d09f081c91ac4d42e96b3301'`. The change was
performance-only, so rolling it back restores query cost, not payload values.

`supabase/rollback/20260925_rollback_drop_duplicate_demo_refresh_runs_index.sql`
recreates `public.idx_public_demo_refresh_runs_preset_sport_created` with its
exact baseline definition. It is the one rollback artifact without a
`begin`/`commit` wrapper: it uses `create index concurrently if not exists` so
the rebuild does not block writes to `demo_refresh_runs`, and `CONCURRENTLY`
cannot run inside a transaction block. A failed or cancelled concurrent build
leaves an invalid index under that name, which `if not exists` would then
silently skip, so drop the invalid index before retrying.

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

## Duplicate demo index removal

`20260925013000_drop_duplicate_demo_refresh_runs_index.sql` (FLA-231) drops
`public.idx_public_demo_refresh_runs_preset_sport_created`, the exact
duplicate that the baseline reproduces from the before-state. The survivor,
`public.public_demo_refresh_runs_preset_sport_created_at_idx`, has the same
`btree (preset_id, sport, created_at desc)` definition on
`public.demo_refresh_runs`. In production the dropped index had recorded no
scans since the last statistics reset while the survivor served the queries.
Nothing else changes: no table, grant, policy, or other index.

A `do` preflight raises unless both indexes exist on that table, the survivor
is valid, the two are structurally identical by the same `pg_index`
comparison the reproducibility proof used for the before-state (plus
uniqueness), and no constraint or dependency other than the index's automatic
dependency on its table references the candidate. The drop has no
`if exists`, so applying the migration twice, or to a database that never had
the duplicate, fails loudly instead of doing nothing. A postcheck refuses to
commit unless the candidate is gone and the survivor is still present and
valid.

It is a plain `drop index`, not `drop index concurrently`, because Supabase
runs each migration in a transaction, where `CONCURRENTLY` is not allowed. The
plain drop holds an `ACCESS EXCLUSIVE` lock on `demo_refresh_runs` only while
it removes a roughly 1 MB index, and `set local lock_timeout = '5s'` makes the
migration fail fast rather than queue demo traffic behind a long-running
transaction. The file has no `begin`/`commit` of its own: it relies on the
migration runner's transaction, which also covers the runner's ledger insert,
so the drop and its ledger row commit together, and which is what makes
`set local` apply. The CLI sends that transaction as one implicit batch rather
than an explicit `BEGIN`, so it prints a harmless 25P01 "SET LOCAL can only be
used in transaction blocks" warning; the timeout still applies. A manual test
apply must run as one transaction, for example `psql -1 -f`.
`supabase/tests/reproducibility.sql` now requires the candidate to be absent
and the survivor to keep its exact definition. The rollback artifact is
described under [Rollback artifacts](#rollback-artifacts). Applying this
migration to any hosted database remains a separate approval gate.

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
