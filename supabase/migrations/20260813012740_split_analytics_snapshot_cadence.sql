-- FLA-264: split the analytics snapshot refresh cadence.
--
-- analytics.refresh_dashboard_snapshot() computes the entire dashboard payload
-- twice on a five-minute timer. Nothing in that payload needs five-minute
-- freshness except sync_recent, the provider-outcome signal an internal
-- monitoring consumer polls to detect provider outages. That signal reads
-- public.provider_sync_state over a trailing six-hour window and touches none
-- of the event tables the rest of the payload scans.
--
-- This migration gives that signal its own small relation with its own
-- computed_at, and makes the dashboard refresh addressable per variant so a
-- scheduler can refresh the external row and the internal-inclusive row on
-- different cadences. It creates no cron job: hosted schedule activation stays
-- outside the migration path in supabase/cron/, and the cadence change is a
-- separate, gated two-phase operation described there.
--
-- analytics.dashboard_payload() is deliberately untouched, including its
-- sync_recent key, which remains as a consumer fallback during rollout.
--
-- Hosted preview and production application remain separate approval gates.

-- Provider-failure snapshot. Same two-variant contract as
-- analytics.dashboard_snapshot so ?internal=1 semantics carry over unchanged:
-- id=1 excludes internal accounts, id=2 includes them.
create table analytics.provider_flags_snapshot (
  id integer default 1 not null,
  providers jsonb not null,
  computed_at timestamptz default now() not null,
  constraint provider_flags_snapshot_pkey primary key (id),
  constraint provider_flags_snapshot_known_rows check (id = any (array[1, 2]))
);

-- Exactly the sync_recent computation from analytics.dashboard_payload():
-- trailing six-hour window, distinct failing and succeeding users, distinct
-- recent error codes, the same internal-user exclusion, and no row at all for
-- a provider with no sync state (never an invented zero row).
create or replace function analytics.provider_flags_payload(
  include_internal boolean
)
returns jsonb
language sql
stable
set search_path to ''
as $function$
with excluded as (
  -- Empty when include_internal=true: NOT IN (empty set) then passes every row.
  -- NOT IN against this set is only safe because internal_users.user_id is
  -- NOT NULL — a single NULL here would make the predicate exclude every row.
  select user_id from analytics.internal_users where not include_internal
)
select coalesce(jsonb_agg(sr order by sr.provider), '[]'::jsonb)
from (
  select provider,
    count(distinct clerk_user_id) filter (
      where last_failure_at > now() - interval '6 hours'
    )::int as users_failed_6h,
    count(distinct clerk_user_id) filter (
      where last_success_at > now() - interval '6 hours'
    )::int as users_succeeded_6h,
    coalesce(array_agg(distinct last_error_code) filter (
      where last_error_code is not null
        and last_failure_at > now() - interval '6 hours'
    ), '{}') as recent_error_codes
  from public.provider_sync_state
  where clerk_user_id not in (select user_id from excluded)
  group by provider
) sr
$function$;

-- One statement, one transaction: both variants are replaced together and
-- share the same transaction timestamp.
create or replace function analytics.refresh_provider_flags_snapshot()
returns void
language plpgsql
set search_path to ''
as $function$
begin
  insert into analytics.provider_flags_snapshot (id, providers, computed_at)
  values
    (1, analytics.provider_flags_payload(false), now()),
    (2, analytics.provider_flags_payload(true), now())
  on conflict (id) do update
  set providers = excluded.providers,
      computed_at = excluded.computed_at;
end;
$function$;

-- Refresh a single dashboard variant. This is what lets a scheduler run the
-- external row hourly and the internal-inclusive row nightly without paying
-- for both payload computations on every tick.
--
-- The upsert shape below is deliberately duplicated in the no-argument
-- function further down rather than shared; see the comment there for why.
-- Changing the target columns or the conflict clause means changing both.
create or replace function analytics.refresh_dashboard_snapshot(
  include_internal boolean
)
returns void
language plpgsql
set search_path to ''
as $function$
begin
  insert into analytics.dashboard_snapshot (id, payload, computed_at)
  values (
    case when include_internal then 2 else 1 end,
    analytics.dashboard_payload(include_internal),
    now()
  )
  on conflict (id) do update
  set payload = excluded.payload,
      computed_at = excluded.computed_at;
end;
$function$;

-- The no-argument function stays as the compatibility and local-seed entry
-- point, and keeps its original single-statement body rather than delegating
-- twice to the overload above. Under READ COMMITTED each statement takes its
-- own snapshot, so two PERFORM calls could compute id=1 and id=2 from
-- different database states while stamping them with the same transaction
-- timestamp. One multi-row INSERT computes both payloads under one statement
-- snapshot, which is what existing callers, seeds, and the pre-cutover cron
-- job already rely on.
--
-- The cost of that correctness is a second copy of the upsert. Any change to
-- the target columns or the conflict clause here must be mirrored in
-- analytics.refresh_dashboard_snapshot(boolean) above, and vice versa.
create or replace function analytics.refresh_dashboard_snapshot()
returns void
language plpgsql
set search_path to ''
as $function$
begin
  insert into analytics.dashboard_snapshot (id, payload, computed_at)
  values
    (1, analytics.dashboard_payload(false), now()),
    (2, analytics.dashboard_payload(true), now())
  on conflict (id) do update
  set payload = excluded.payload,
      computed_at = excluded.computed_at;
end;
$function$;

-- Match the private analytics posture: the schema stays outside the Data API,
-- and the internal read-only role is the only non-owner reader. anon,
-- authenticated, service_role, and PUBLIC get nothing.
revoke all privileges on table analytics.provider_flags_snapshot
from public, anon, authenticated, service_role, analytics_readonly;
grant select on table analytics.provider_flags_snapshot to analytics_readonly;

-- The refresh path is owner-only. These are security invokers with a fixed
-- empty search path, so nothing here relies on definer rights; the scheduled
-- job runs as the owning role.
revoke all privileges on function
  analytics.provider_flags_payload(boolean),
  analytics.refresh_provider_flags_snapshot(),
  analytics.refresh_dashboard_snapshot(boolean)
from public, anon, authenticated, service_role, analytics_readonly;

grant execute on function
  analytics.provider_flags_payload(boolean),
  analytics.refresh_provider_flags_snapshot(),
  analytics.refresh_dashboard_snapshot(boolean)
to postgres;

-- Populate immediately so the relation is usable before its schedule exists.
select analytics.refresh_provider_flags_snapshot();
