-- FLA-388: fail closed while the retained raw bridge still leaves a recovery
-- runway. Raw events remain available for 90 days; refusing a payload after
-- 60 days without a successful ET close leaves roughly 30 days to repair the
-- marker from source events before any required day can be pruned.
--
-- The history payload is intentionally large and has been refined by several
-- forward migrations. Replace only the reviewed stale-guard fragment, and
-- refuse any unexpected deployed definition rather than overwriting it with a
-- stale full-function copy. CREATE OR REPLACE preserves each function's
-- existing privileges; broader function-ACL cleanup remains a separate lane.

create or replace function public.rollup_mcp_usage(
  target_day date default ((now() at time zone 'UTC')::date - 1)
)
returns void
language plpgsql
set search_path to ''
as $function$
begin
  delete from public.mcp_user_daily
  where day = target_day;

  insert into public.mcp_user_daily (
    day,
    env,
    user_id,
    auth_type,
    client_name,
    call_count
  )
  select
    target_day,
    env,
    user_id,
    auth_type,
    coalesce(client_name, ''),
    count(*)
  from public.mcp_tool_events
  where ts >= (target_day::timestamp at time zone 'UTC')
    and ts < ((target_day + 1)::timestamp at time zone 'UTC')
  group by env, user_id, auth_type, coalesce(client_name, '');

  delete from public.mcp_tool_daily
  where day = target_day;

  insert into public.mcp_tool_daily (
    day,
    env,
    auth_type,
    tool_name,
    platform,
    sport,
    status,
    call_count,
    p50_ms,
    p95_ms
  )
  select
    target_day,
    env,
    auth_type,
    tool_name,
    coalesce(platform, ''),
    coalesce(sport, ''),
    status,
    count(*),
    percentile_cont(0.5) within group (order by latency_ms)::integer,
    percentile_cont(0.95) within group (order by latency_ms)::integer
  from public.mcp_tool_events
  where ts >= (target_day::timestamp at time zone 'UTC')
    and ts < ((target_day + 1)::timestamp at time zone 'UTC')
  group by
    env,
    auth_type,
    tool_name,
    coalesce(platform, ''),
    coalesce(sport, ''),
    status;
end;
$function$;

alter function public.rollup_mcp_usage(date) owner to postgres;

do $migration$
declare
  current_body text;
  updated_body text;
  old_guard constant text := $old$
  -- The raw side of the marker must still be wholly recoverable. Refuse to
  -- return a plausible-looking partial history if close/backfill has missed the
  -- 90-day retention window.
  if (history_marker_et_day + 1)::timestamp
      at time zone 'America/New_York' < now() - interval '90 days'
  then
    raise exception using
      errcode = '55000',
      message = 'analytics history rollup is stale beyond the 90-day raw window';
  end if;$old$;
  new_guard constant text := $new$
  -- Refuse a plausible-looking partial history while retained raw events still
  -- leave a recovery runway. The close function retains the authoritative
  -- 90-day availability check for any attempted repair.
  if (history_marker_et_day + 1)::timestamp
      at time zone 'America/New_York' < now() - interval '60 days'
  then
    raise exception using
      errcode = '55000',
      message = 'analytics history rollup is more than 60 days stale; repair it before the 90-day raw window closes';
  end if;$new$;
begin
  select p.prosrc
  into current_body
  from pg_catalog.pg_proc as p
  where p.oid = 'analytics.dashboard_payload_history(boolean)'::regprocedure;

  if current_body is null
    or pg_catalog.strpos(current_body, old_guard) = 0
    or pg_catalog.strpos(current_body, new_guard) > 0
    or pg_catalog.strpos(
      pg_catalog.substr(
        current_body,
        pg_catalog.strpos(current_body, old_guard) + pg_catalog.length(old_guard)
      ),
      old_guard
    ) > 0
  then
    raise exception using
      errcode = '55000',
      message = 'dashboard_payload_history stale guard does not match the reviewed predecessor';
  end if;

  updated_body := pg_catalog.replace(current_body, old_guard, new_guard);

  execute pg_catalog.format(
    $ddl$
      create or replace function analytics.dashboard_payload_history(
        include_internal boolean
      )
      returns jsonb
      language plpgsql
      stable
      security invoker
      set search_path to ''
      as %L
    $ddl$,
    updated_body
  );
end;
$migration$;

alter function analytics.dashboard_payload_history(boolean) owner to postgres;

revoke all privileges on function analytics.dashboard_payload_history(boolean)
  from public, anon, authenticated, service_role, analytics_readonly;
grant execute on function analytics.dashboard_payload_history(boolean)
  to postgres;
