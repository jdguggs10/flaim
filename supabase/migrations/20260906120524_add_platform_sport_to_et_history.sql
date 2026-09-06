-- FLA-265 follow-up: preserve nullable platform and sport dimensions in the
-- permanent ET-day user aggregate. This migration is deliberately limited to
-- an empty, uninitialized history lane. It does not backfill, reset, activate,
-- or switch any reader.
--
-- The CLI does not wrap this migration in a transaction. Keep every operation
-- inside one DO statement so PostgreSQL supplies a single statement-level
-- transaction: failure rolls back all DDL, and both locks remain held through
-- the function replacement. Lock state first to match the close function's
-- access order. Do not run the initial close concurrently with this migration:
-- a call that already compiled the old function body may retain that body
-- while waiting for a relation lock. Start backfill only after commit.
do $migration$
begin
  execute 'lock table analytics.history_rollup_state in access exclusive mode';
  execute 'lock table public.mcp_user_daily_et in access exclusive mode';

  if not exists (
    select 1
    from analytics.history_rollup_state as s
    where s.id = true
      and s.initial_history_start_et_day is null
      and s.last_closed_et_day is null
  ) then
    raise exception using
      errcode = '55000',
      message = 'platform/sport history migration requires an uninitialized analytics history';
  end if;

  if exists (select 1 from public.mcp_user_daily_et) then
    raise exception using
      errcode = '55000',
      message = 'platform/sport history migration requires an empty ET aggregate';
  end if;

  execute $ddl$
    alter table public.mcp_user_daily_et
      add column platform text,
      add column sport text
  $ddl$;

  execute $ddl$
    alter table public.mcp_user_daily_et
      drop constraint mcp_user_daily_et_grain
  $ddl$;

  execute $ddl$
    alter table public.mcp_user_daily_et
      add constraint mcp_user_daily_et_grain unique nulls not distinct (
        et_day,
        env,
        user_id,
        auth_type,
        client_name,
        platform,
        sport
      )
  $ddl$;

  execute $ddl$
    comment on table public.mcp_user_daily_et is
      'Permanent MCP call counts at America/New_York day, user, platform, and sport grain.'
  $ddl$;

-- Keep the established close contract unchanged except for persisting and
-- grouping by the two new nullable dimensions. In particular, its owner-only
-- ACL, security-invoker posture, empty search path, state-row serialization,
-- open-day rejection, raw-window checks, and old-transaction fence remain.
  execute $ddl$
create or replace function public.close_mcp_user_daily_et(
  through_et_day date default null,
  initial_history_start_et_day date default null
)
returns void
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  state_initial_et_day date;
  state_last_closed_et_day date;
  effective_through_et_day date := coalesce(
    through_et_day,
    (now() at time zone 'America/New_York')::date - 1
  );
  latest_closed_et_day date :=
    (now() at time zone 'America/New_York')::date - 1;
  requested_initial_et_day date := initial_history_start_et_day;
  range_start_et_day date;
  range_start_at timestamptz;
  range_end_at timestamptz;
  earliest_raw_et_day date;
begin
  -- This row is migration-owned integrity state. Do not silently recreate it:
  -- a missing row must stop both the close and the history payload.
  select s.initial_history_start_et_day, s.last_closed_et_day
  into state_initial_et_day, state_last_closed_et_day
  from analytics.history_rollup_state as s
  where s.id = true
  for update;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'analytics history rollup state is missing';
  end if;

  if effective_through_et_day > latest_closed_et_day then
    raise exception using
      errcode = '22023',
      message = 'through_et_day must be a fully closed America/New_York day';
  end if;

  if state_last_closed_et_day is null then
    if requested_initial_et_day is null then
      raise exception using
        errcode = '22023',
        message = 'initial_history_start_et_day is required for the first analytics history close';
    end if;

    if requested_initial_et_day > effective_through_et_day then
      raise exception using
        errcode = '22023',
        message = 'initial_history_start_et_day must not be after through_et_day';
    end if;

    select min((e.ts at time zone 'America/New_York')::date)
    into earliest_raw_et_day
    from public.mcp_tool_events as e;

    if earliest_raw_et_day is not null
      and requested_initial_et_day > earliest_raw_et_day
    then
      raise exception using
        errcode = '22023',
        message = 'initial_history_start_et_day must not omit available raw event history';
    end if;

    range_start_et_day := requested_initial_et_day;
  else
    if requested_initial_et_day is not null
      and requested_initial_et_day <> state_initial_et_day
    then
      raise exception using
        errcode = '22023',
        message = 'initial_history_start_et_day does not match the initialized analytics history';
    end if;

    -- A repeated or older request is already satisfied. Preserve the original
    -- marker timestamp so replay is a true no-op.
    if effective_through_et_day <= state_last_closed_et_day then
      return;
    end if;

    range_start_et_day := state_last_closed_et_day + 1;
  end if;

  range_start_at := range_start_et_day::timestamp
    at time zone 'America/New_York';
  range_end_at := (effective_through_et_day + 1)::timestamp
    at time zone 'America/New_York';

  -- public.prune_mcp_events() may legally have removed anything older than
  -- now()-90 days. Even if an older row happens to remain, it cannot prove the
  -- requested ET day is complete, so reject rather than preserve partial data.
  if range_start_at < now() - interval '90 days' then
    raise exception using
      errcode = '22023',
      message = 'analytics history close starts before the fully available 90-day raw window';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_stat_activity as a
    where a.datname = pg_catalog.current_database()
      and a.pid <> pg_catalog.pg_backend_pid()
      and a.xact_start is not null
      and a.xact_start < range_end_at
  ) then
    raise exception using
      errcode = '55000',
      message = 'analytics history close blocked by a transaction that predates the close boundary';
  end if;

  -- Replace the whole range inside this transaction. The state marker advances
  -- only after the insert succeeds.
  delete from public.mcp_user_daily_et as d
  where d.et_day >= range_start_et_day
    and d.et_day <= effective_through_et_day;

  insert into public.mcp_user_daily_et (
    et_day,
    env,
    user_id,
    auth_type,
    client_name,
    platform,
    sport,
    call_count
  )
  select
    (e.ts at time zone 'America/New_York')::date,
    e.env,
    e.user_id,
    e.auth_type,
    e.client_name,
    e.platform,
    e.sport,
    count(*)
  from public.mcp_tool_events as e
  where e.ts >= range_start_at
    and e.ts < range_end_at
  group by
    (e.ts at time zone 'America/New_York')::date,
    e.env,
    e.user_id,
    e.auth_type,
    e.client_name,
    e.platform,
    e.sport;

  update analytics.history_rollup_state as s
  set initial_history_start_et_day = coalesce(
        state_initial_et_day,
        requested_initial_et_day
      ),
      last_closed_et_day = effective_through_et_day,
      updated_at = now()
  where s.id = true;
end;
$function$
  $ddl$;

  execute $ddl$
    alter function public.close_mcp_user_daily_et(date, date) owner to postgres
  $ddl$;

  execute $ddl$
    revoke all privileges on function public.close_mcp_user_daily_et(date, date)
    from public, anon, authenticated, service_role, analytics_readonly
  $ddl$;

  execute $ddl$
    grant execute on function public.close_mcp_user_daily_et(date, date) to postgres
  $ddl$;
end;
$migration$;
