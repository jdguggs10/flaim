-- Behavioral proof for FLA-388's self-healing UTC rollup schedule.
-- Run only against a reset local database. All fixtures roll back.

begin;

-- Prove date boundaries do not inherit the caller's session timezone.
set local timezone to 'America/Los_Angeles';

do $proof$
declare
  v_today_utc constant date := (now() at time zone 'UTC')::date;
  v_first_repair_day constant date := v_today_utc - 7;
  v_last_repair_day constant date := v_today_utc - 1;
  v_empty_repair_day constant date := v_today_utc - 3;
  v_outside_day constant date := v_today_utc - 8;
  v_first jsonb;
  v_second jsonb;
begin
  delete from public.mcp_tool_events
  where user_id like 'rollup-catchup-%';

  insert into public.mcp_tool_events (
    ts, env, user_id, auth_type, client_name, tool_name,
    platform, sport, status, latency_ms
  ) values
    ((v_first_repair_day::timestamp at time zone 'UTC') + interval '15 minutes',
      'prod', 'rollup-catchup-proof', 'oauth', 'proof-client',
      'rollup_catchup_proof', null, null, 'ok', 10),
    (((v_first_repair_day + 1)::timestamp at time zone 'UTC') - interval '15 minutes',
      'prod', 'rollup-catchup-proof', 'oauth', 'proof-client',
      'rollup_catchup_proof', null, null, 'ok', 30),
    ((v_last_repair_day::timestamp at time zone 'UTC') + interval '15 minutes',
      'prod', 'rollup-catchup-proof', 'oauth', 'proof-client',
      'rollup_catchup_proof', null, null, 'ok', 40),
    ((v_today_utc::timestamp at time zone 'UTC') + interval '15 minutes',
      'prod', 'rollup-catchup-proof', 'oauth', 'proof-client',
      'rollup_catchup_proof', null, null, 'ok', 50);

  -- Simulate a missed or incomplete historical rollup. Replaying the trailing
  -- window must replace it from raw events.
  insert into public.mcp_user_daily (
    day, env, user_id, auth_type, client_name, call_count
  ) values (
    v_first_repair_day, 'prod', 'rollup-catchup-proof', 'oauth', 'proof-client', 99
  ), (
    v_last_repair_day, 'prod', 'rollup-catchup-proof', 'oauth', 'proof-client', 99
  ), (
    v_outside_day, 'prod', 'rollup-catchup-proof', 'oauth', 'proof-client', 77
  )
  on conflict (day, env, user_id, auth_type, client_name)
  do update set call_count = excluded.call_count;

  insert into public.mcp_user_daily (
    day, env, user_id, auth_type, client_name, call_count
  ) values (
    v_empty_repair_day, 'prod', 'rollup-catchup-empty', 'oauth', 'proof-client', 88
  )
  on conflict (day, env, user_id, auth_type, client_name)
  do update set call_count = excluded.call_count;

  insert into public.mcp_tool_daily (
    day, env, auth_type, tool_name, platform, sport, status,
    call_count, p50_ms, p95_ms
  ) values (
    v_outside_day, 'prod', 'oauth', 'rollup_catchup_proof', '', '', 'ok',
    77, 77, 77
  ), (
    v_empty_repair_day, 'prod', 'oauth', 'rollup_catchup_empty', '', '', 'ok',
    88, 88, 88
  )
  on conflict (day, env, auth_type, tool_name, platform, sport, status)
  do update set call_count = excluded.call_count,
                p50_ms = excluded.p50_ms,
                p95_ms = excluded.p95_ms;

  perform public.rollup_mcp_usage(d::date)
  from generate_series(
    v_today_utc - 7,
    v_today_utc - 1,
    interval '1 day'
  ) as completed_days(d);

  if exists (
    select expected.day, expected.call_count
    from (values
      (v_first_repair_day, 2),
      (v_last_repair_day, 1),
      (v_outside_day, 77)
    ) as expected(day, call_count)
    except
    select day, call_count
    from public.mcp_user_daily
    where env = 'prod'
      and user_id = 'rollup-catchup-proof'
      and auth_type = 'oauth'
      and client_name = 'proof-client'
  ) then
    raise exception 'seven-day replay did not repair only the bounded user aggregates';
  end if;

  if not exists (
    select 1
    from public.mcp_tool_daily
    where day = v_first_repair_day
      and env = 'prod'
      and auth_type = 'oauth'
      and tool_name = 'rollup_catchup_proof'
      and platform = ''
      and sport = ''
      and status = 'ok'
      and call_count = 2
      and p50_ms = 20
      and p95_ms = 29
  ) then
    raise exception 'seven-day replay did not repair the tool aggregate';
  end if;

  if not exists (
    select 1
    from public.mcp_tool_daily
    where day = v_last_repair_day
      and env = 'prod'
      and auth_type = 'oauth'
      and tool_name = 'rollup_catchup_proof'
      and platform = ''
      and sport = ''
      and status = 'ok'
      and call_count = 1
      and p50_ms = 40
      and p95_ms = 40
  ) or not exists (
    select 1
    from public.mcp_tool_daily
    where day = v_outside_day
      and env = 'prod'
      and auth_type = 'oauth'
      and tool_name = 'rollup_catchup_proof'
      and platform = ''
      and sport = ''
      and status = 'ok'
      and call_count = 77
      and p50_ms = 77
      and p95_ms = 77
  ) then
    raise exception 'seven-day replay missed the last day or changed an outside day';
  end if;

  if exists (
    select 1
    from public.mcp_user_daily
    where day = v_empty_repair_day and user_id = 'rollup-catchup-empty'
  ) or exists (
    select 1
    from public.mcp_tool_daily
    where day = v_empty_repair_day and tool_name = 'rollup_catchup_empty'
  ) then
    raise exception 'seven-day replay did not clear stale rows for an empty day';
  end if;

  if exists (
    select 1
    from public.mcp_user_daily
    where day = v_today_utc and user_id = 'rollup-catchup-proof'
  ) or exists (
    select 1
    from public.mcp_tool_daily
    where day = v_today_utc and tool_name = 'rollup_catchup_proof'
  ) then
    raise exception 'seven-day replay touched the open UTC day';
  end if;

  select jsonb_build_object(
    'users', (
      select jsonb_agg(to_jsonb(u) order by day, env, user_id, auth_type, client_name)
      from public.mcp_user_daily as u
      where user_id = 'rollup-catchup-proof'
    ),
    'tools', (
      select jsonb_agg(to_jsonb(t) order by day, env, auth_type, tool_name, platform, sport, status)
      from public.mcp_tool_daily as t
      where tool_name = 'rollup_catchup_proof'
    )
  ) into v_first;

  perform public.rollup_mcp_usage(d::date)
  from generate_series(
    v_today_utc - 7,
    v_today_utc - 1,
    interval '1 day'
  ) as completed_days(d);

  select jsonb_build_object(
    'users', (
      select jsonb_agg(to_jsonb(u) order by day, env, user_id, auth_type, client_name)
      from public.mcp_user_daily as u
      where user_id = 'rollup-catchup-proof'
    ),
    'tools', (
      select jsonb_agg(to_jsonb(t) order by day, env, auth_type, tool_name, platform, sport, status)
      from public.mcp_tool_daily as t
      where tool_name = 'rollup_catchup_proof'
    )
  ) into v_second;

  if v_first is distinct from v_second then
    raise exception 'seven-day replay is not idempotent';
  end if;
end;
$proof$;

rollback;

select 'mcp rollup catch-up proof passed' as result;
