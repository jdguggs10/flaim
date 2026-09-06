-- FLA-265: preserve user-level analytics at America/New_York day grain before
-- the 90-day raw-event window is pruned. This migration only creates the
-- storage and owner-run close/backfill path. It does not schedule the function,
-- backfill any row, or switch the dashboard payload.
--
-- Hosted preview and production application, the one-time initial backfill,
-- and cron activation remain separate approval gates.

create table public.mcp_user_daily_et (
  et_day date not null,
  env text not null,
  user_id text not null,
  auth_type text not null,
  client_name text,
  call_count bigint not null,
  constraint mcp_user_daily_et_positive_calls check (call_count > 0),
  constraint mcp_user_daily_et_grain unique nulls not distinct (
    et_day,
    env,
    user_id,
    auth_type,
    client_name
  )
);

comment on table public.mcp_user_daily_et is
  'Permanent MCP call counts at America/New_York day and user grain.';

-- The row is deliberately inserted uninitialized. A nullable marker lets the
-- schema land without claiming that a historical backfill happened. The first
-- close must supply an explicit history start; later closes preserve it.
create table analytics.history_rollup_state (
  id boolean default true not null,
  initial_history_start_et_day date,
  last_closed_et_day date,
  updated_at timestamptz default now() not null,
  constraint history_rollup_state_pkey primary key (id),
  constraint history_rollup_state_singleton check (id),
  constraint history_rollup_state_dates_together check (
    (initial_history_start_et_day is null) = (last_closed_et_day is null)
  ),
  constraint history_rollup_state_order check (
    initial_history_start_et_day is null
    or initial_history_start_et_day <= last_closed_et_day
  )
);

insert into analytics.history_rollup_state (id) values (true);

-- Close every not-yet-preserved ET day through through_et_day. Passing NULL
-- closes through yesterday in ET. The first call is also the one-time backfill
-- and must declare initial_history_start_et_day explicitly; no minimum raw
-- timestamp is allowed to masquerade as proof that earlier data never existed.
--
-- The singleton row lock serializes close/backfill calls. The active-
-- transaction guard prevents an older transaction from committing an event
-- whose now()-based timestamp falls inside the range after that range closes.
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

  -- Replace the whole range inside this transaction. Deleting first makes a
  -- retry deterministic if an operator deliberately rebuilds an uninitialized
  -- range; the state marker advances only after the insert succeeds.
  delete from public.mcp_user_daily_et as d
  where d.et_day >= range_start_et_day
    and d.et_day <= effective_through_et_day;

  insert into public.mcp_user_daily_et (
    et_day,
    env,
    user_id,
    auth_type,
    client_name,
    call_count
  )
  select
    (e.ts at time zone 'America/New_York')::date,
    e.env,
    e.user_id,
    e.auth_type,
    e.client_name,
    count(*)
  from public.mcp_tool_events as e
  where e.ts >= range_start_at
    and e.ts < range_end_at
  group by
    (e.ts at time zone 'America/New_York')::date,
    e.env,
    e.user_id,
    e.auth_type,
    e.client_name;

  update analytics.history_rollup_state as s
  set initial_history_start_et_day = coalesce(
        state_initial_et_day,
        requested_initial_et_day
      ),
      last_closed_et_day = effective_through_et_day,
      updated_at = now()
  where s.id = true;
end;
$function$;

alter table public.mcp_user_daily_et owner to postgres;
alter table analytics.history_rollup_state owner to postgres;
alter function public.close_mcp_user_daily_et(date, date) owner to postgres;

-- public is an exposed schema. RLS is defense in depth, while explicit grants
-- decide whether a role can reach the table at all. The aggregate, private
-- state, and close function are owner-only; even service_role gets no access.
alter table public.mcp_user_daily_et enable row level security;
alter table analytics.history_rollup_state enable row level security;

revoke all privileges on table public.mcp_user_daily_et
from public, anon, authenticated, service_role, analytics_readonly;

revoke all privileges on table analytics.history_rollup_state
from public, anon, authenticated, service_role, analytics_readonly;

revoke all privileges on function public.close_mcp_user_daily_et(date, date)
from public, anon, authenticated, service_role, analytics_readonly;

grant all privileges on table public.mcp_user_daily_et to postgres;
grant all privileges on table analytics.history_rollup_state to postgres;
grant execute on function public.close_mcp_user_daily_et(date, date) to postgres;
