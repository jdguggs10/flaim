-- FLA-358: preserve the signup/connection funnel as daily history.
--
-- What exists today, verified against the live hosted database on 2026-09-09:
--
--   * The funnel is current-state only. `analytics.funnel_snapshot` is a VIEW
--     (baseline), not a stored snapshot, and the payload's `funnel` key is
--     recomputed from scratch on every refresh inside
--     `analytics.dashboard_payload_history(boolean)`. Neither one retains a
--     single historical value, so no stage has a trend.
--   * The live refresh is one cron job: `dashboard-snapshot`, `*/5 * * * *`,
--     running `select analytics.refresh_dashboard_snapshot();`. That
--     no-argument entry point computes only the internal-inclusive payload and
--     upserts `analytics.dashboard_snapshot` row id=2, which is the row the
--     internal dashboard actually reads. A five-minute cadence means a
--     permanent daily table must be keyed and upserted by day, never appended
--     per run.
--   * `analytics_readonly` does not, and cannot, execute the payload functions.
--     `dashboard_payload_history(boolean)` is `security invoker`, but its ACL
--     is `{postgres=X/postgres}` and `public.mcp_user_daily_et` is owner-only,
--     so an invoker call by the read role would be refused twice over. There is
--     no `security definer` bridge anywhere in that path. The read role reads
--     materialized relations the owner-run cron job writes: `dashboard_snapshot`,
--     `provider_flags_snapshot`, and every analytics view carry
--     `analytics_readonly=r/postgres`. The privilege boundary is the stored
--     relation, not the function.
--
-- Design decisions:
--
--   * `analytics.funnel_daily` holds one row per (et_day, stage). Every
--     five-minute refresh upserts today's ET row per stage, so an open day
--     tracks intraday and a completed day freezes at whatever its final refresh
--     of that day observed. This is a periodic snapshot, so no explicit "close"
--     step is needed the way FLA-265's raw-event history needed one: nothing
--     this table reads is ever pruned.
--   * The write is fed by the payload the same statement just stored
--     (`returning payload`), not by a second `analytics.dashboard_payload(...)`
--     call. The recorded funnel therefore cannot drift from the funnel the
--     dashboard displays, no stage SQL is duplicated here, and the expensive
--     payload is still computed exactly once per run.
--   * Only the no-argument scheduled path writes history. The
--     `analytics.refresh_dashboard_snapshot(boolean)` overload is the explicit
--     comparison and manual-repair path, and it can rebuild the *external* row
--     id=1, whose funnel excludes internal users. Letting it write would mix
--     two different populations into one (et_day, stage) key.
--   * The write deliberately shares the refresh transaction and has no
--     exception handler. It is a fixed-size insert into an owner-owned table
--     with no external dependency; the only realistic failures (table dropped,
--     grants revoked, payload shape changed) are conditions an operator must
--     see. Swallowing them would silently produce exactly the gap-riddled
--     history this table exists to prevent, while a hard failure stops
--     `dashboard_snapshot.computed_at` from advancing — the freshness signal
--     that is already monitored. Provider-outage alerting reads
--     `provider_flags_snapshot` from its own cron job and is unaffected either
--     way.
--   * No backfill, and no synthesis from `created_at`. `espn_leagues`,
--     `yahoo_leagues`, `sleeper_leagues`, and `sleeper_connections` are
--     hard-deleted on disconnect and by `public.purge_account_data()`, so a
--     created_at reconstruction would silently undercount every past day by
--     everyone who has since disconnected. The table starts empty and receives
--     its first rows on the next scheduled refresh after this migration lands.
--     Tracking starts the clock; it cannot look backward.
--
-- Additive only. `analytics.dashboard_payload()`,
-- `analytics.dashboard_payload_history()`, the payload's `funnel` key, the
-- `funnel_snapshot` view, the provider-flags path, and cron are all unchanged.
-- Hosted application remains a separate approval gate.

create table analytics.funnel_daily (
  et_day date not null,
  stage text not null,
  sort_order integer not null,
  users integer not null,
  computed_at timestamptz default now() not null,
  constraint funnel_daily_grain unique (et_day, stage),
  constraint funnel_daily_users_non_negative check (users >= 0)
);

comment on table analytics.funnel_daily is
  'Daily America/New_York history of the internal-inclusive dashboard funnel, one row per (et_day, stage). Rewritten by every five-minute snapshot refresh, so a completed day holds the value observed at that day''s final refresh rather than a midnight-exact close. Never backfilled: disconnects hard-delete their league and credential rows, so days before this table existed cannot be reconstructed honestly.';

-- `stage` and `sort_order` are copied from the payload rather than constrained
-- to a fixed list, so adding or reordering a funnel stage later stays a
-- payload-only change. `sort_order` records the display order as of that day.
comment on column analytics.funnel_daily.sort_order is
  'Funnel display order as recorded on that ET day; stage membership and order are the payload''s to define.';

alter table analytics.funnel_daily owner to postgres;

-- Grant posture matches analytics.provider_flags_snapshot, not
-- public.mcp_user_daily_et. mcp_user_daily_et is owner-only because it lives in
-- the Data-API-exposed `public` schema and stores per-user rows; funnel_daily
-- lives in `analytics`, which is not exposed through the Data API, and holds
-- only aggregate stage counts that `analytics_readonly` can already read at
-- current value through the `funnel_snapshot` view and
-- `dashboard_snapshot.payload -> 'funnel'`. Withholding SELECT here would deny
-- the only role that will ever chart this history while protecting nothing new.
--
-- The revoke is not redundant: `alter default privileges for role postgres in
-- schema analytics grant select on tables to analytics_readonly` would
-- otherwise decide this table's ACL implicitly. State it instead.
--
-- RLS is deliberately not enabled. analytics_readonly has no BYPASSRLS, so RLS
-- with no policies would hide every row from the only reader, unlike the
-- owner-only analytics.history_rollup_state where it costs nothing.
revoke all privileges on table analytics.funnel_daily
from public, anon, authenticated, service_role, analytics_readonly;

grant select on table analytics.funnel_daily to analytics_readonly;

-- CREATE OR REPLACE of the scheduled refresh. On 2026-09-09 the live hosted
-- definition was byte-identical to
-- 20260909005730_compute_single_inclusive_dashboard_snapshot.sql
-- (pg_get_functiondef md5 fa0fb46f04e34d83ab6f87392bdc3293), so nothing landed
-- out-of-band that this replace would clobber. The single inclusive payload
-- call, the id=2-only upsert, the owner, the ACL, the empty search path, and
-- the invoker security are all preserved.
create or replace function analytics.refresh_dashboard_snapshot()
returns void
language plpgsql
set search_path to ''
as $function$
declare
  inclusive_payload jsonb;
begin
  insert into analytics.dashboard_snapshot (id, payload, computed_at)
  values (2, analytics.dashboard_payload(true), now())
  on conflict (id) do update
  set payload = excluded.payload,
      computed_at = excluded.computed_at
  returning payload into inclusive_payload;

  -- FLA-358. A missing key means the payload contract changed underneath this
  -- function; an empty array is just as dangerous even though the key is
  -- present, because the stale-stage cleanup delete below computes
  -- `stage not in (<today's funnel stages>)`, and `not in (<empty set>)` is
  -- true for every row — a transient upstream bug that empties the funnel
  -- array would wipe every already-recorded funnel_daily row for today, not
  -- just skip recording a new one. Fail loudly rather than record, or erase,
  -- an empty day.
  if inclusive_payload -> 'funnel' is null
     or jsonb_array_length(inclusive_payload -> 'funnel') = 0
  then
    raise exception using
      errcode = '55000',
      message = 'dashboard payload has no funnel key; funnel history cannot be recorded';
  end if;

  -- If dashboard_payload's funnel array ever contained the same stage twice
  -- (a hypothetical bug in that function, not this one — its stage list is
  -- hardcoded today), this ON CONFLICT DO UPDATE would hard-fail with
  -- Postgres's "ON CONFLICT DO UPDATE command cannot affect row a second
  -- time", aborting the whole refresh transaction. Accepted as-is: guarding
  -- against it would mean validating an unrelated function's output shape.
  insert into analytics.funnel_daily (
    et_day,
    stage,
    sort_order,
    users,
    computed_at
  )
  select
    (now() at time zone 'America/New_York')::date,
    f.value ->> 'stage',
    (f.value ->> 'sort_order')::integer,
    (f.value ->> 'users')::integer,
    now()
  from jsonb_array_elements(inclusive_payload -> 'funnel') as f(value)
  on conflict (et_day, stage) do update
  set sort_order = excluded.sort_order,
      users = excluded.users,
      computed_at = excluded.computed_at;

  -- A stage renamed or removed from the payload's funnel array (only
  -- possible through a future migration changing the funnel SQL; stage names
  -- are hardcoded, not user data) must not leave today's row for the old
  -- stage frozen forever at a stale value: that would silently corrupt
  -- exactly the historical accuracy this table exists to provide. Scope the
  -- delete to today's et_day only — past days are frozen, historically
  -- accurate observations of what was actually measured at the time, and
  -- must never be retroactively edited.
  --
  -- Relies on `stage text not null` above: `stage not in (subquery)` would
  -- silently match zero rows (NOT IN short-circuits to unknown) if the
  -- subquery ever produced a null stage, but the insert just above would
  -- already have aborted the whole transaction on that same null first. If a
  -- future refactor ever reorders these two statements, re-verify this still
  -- holds.
  delete from analytics.funnel_daily
  where et_day = (now() at time zone 'America/New_York')::date
    and stage not in (
      select f.value ->> 'stage'
      from jsonb_array_elements(inclusive_payload -> 'funnel') as f(value)
    );
end;
$function$;

-- Deliberately no refresh call here. Unlike the provider-flags migration, this
-- table has no consumer that needs a row before its schedule exists, and
-- invoking the refresh during DDL would recompute and rewrite the dashboard
-- snapshot as a side effect. The first rows arrive on the next scheduled run.
