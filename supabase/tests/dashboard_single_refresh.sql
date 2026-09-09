-- Behavioral proof for the FLA-264 single inclusive dashboard refresh.
-- Run only against a reset local database. Every row it writes is synthetic,
-- and the transaction rolls back.

begin;

do $proof$
declare
  frozen constant timestamptz := timestamptz '2020-01-01 00:00:00+00';
  id1_before analytics.dashboard_snapshot%rowtype;
  id1_after analytics.dashboard_snapshot%rowtype;
  id2_after analytics.dashboard_snapshot%rowtype;
  id2_before_explicit_refresh analytics.dashboard_snapshot%rowtype;
  id2_after_explicit_refresh analytics.dashboard_snapshot%rowtype;
  flags_before jsonb;
  flags_after jsonb;
  expected_inclusive jsonb;
  expected_external jsonb;
  refresh_definition text;
  today_et constant date := (now() at time zone 'America/New_York')::date;
  funnel_recorded jsonb;
  funnel_expected jsonb;
  funnel_rows_before bigint;
  funnel_rows_after bigint;
  funnel_history_before jsonb;
  funnel_history_after jsonb;
begin
  select pg_get_functiondef(
    'analytics.refresh_dashboard_snapshot()'::regprocedure
  ) into refresh_definition;

  if regexp_count(
       refresh_definition,
       'analytics\.dashboard_payload\(true\)'
     ) <> 1
     or refresh_definition ~ 'analytics\.dashboard_payload\(false\)' then
    raise exception 'no-argument refresh does not compute exactly one inclusive payload';
  end if;

  select * into strict id1_before
  from analytics.dashboard_snapshot
  where id = 1;

  select jsonb_agg(to_jsonb(p) order by p.id) into flags_before
  from analytics.provider_flags_snapshot p;

  insert into analytics.internal_users (user_id, note)
  values (
    'synthetic-single-dashboard-refresh-user',
    'rolled back by dashboard_single_refresh.sql'
  );

  update analytics.dashboard_snapshot
  set computed_at = frozen
  where id = 2;

  expected_inclusive := analytics.dashboard_payload(true);
  perform analytics.refresh_dashboard_snapshot();

  select * into strict id1_after
  from analytics.dashboard_snapshot
  where id = 1;

  select * into strict id2_after
  from analytics.dashboard_snapshot
  where id = 2;

  select jsonb_agg(to_jsonb(p) order by p.id) into flags_after
  from analytics.provider_flags_snapshot p;

  if id1_after is distinct from id1_before then
    raise exception 'no-argument refresh changed external dashboard row id=1';
  end if;

  if id2_after.payload is distinct from expected_inclusive
     or id2_after.computed_at = frozen then
    raise exception 'no-argument refresh did not rebuild inclusive dashboard row id=2';
  end if;

  if flags_after is distinct from flags_before then
    raise exception 'dashboard refresh changed provider flags rows';
  end if;

  -- FLA-358: the scheduled path also records today's ET funnel row per stage,
  -- taken from the payload it just stored rather than recomputed.
  select jsonb_agg(to_jsonb(d) order by d.sort_order) into funnel_recorded
  from (
    select stage, sort_order, users
    from analytics.funnel_daily
    where et_day = today_et
  ) as d;

  select jsonb_agg(
           jsonb_build_object(
             'stage', f.value ->> 'stage',
             'sort_order', (f.value ->> 'sort_order')::integer,
             'users', (f.value ->> 'users')::integer
           )
           order by (f.value ->> 'sort_order')::integer
         ) into funnel_expected
  from jsonb_array_elements(id2_after.payload -> 'funnel') as f(value);

  if funnel_recorded is distinct from funnel_expected then
    raise exception 'funnel_daily does not match the stored inclusive funnel';
  end if;

  -- A five-minute cadence writes the same ET day many times. The day is a
  -- natural key, so repeating the refresh must update in place, never append.
  select count(*) into funnel_rows_before
  from analytics.funnel_daily
  where et_day = today_et;

  if funnel_rows_before
       <> jsonb_array_length(id2_after.payload -> 'funnel') then
    raise exception 'funnel_daily does not hold exactly one row per funnel stage';
  end if;

  perform analytics.refresh_dashboard_snapshot();

  select count(*) into funnel_rows_after
  from analytics.funnel_daily
  where et_day = today_et;

  if funnel_rows_after <> funnel_rows_before then
    raise exception 'repeating the scheduled refresh appended funnel_daily rows';
  end if;

  -- That repeat rewrote row id=2, so re-read it before the checks below use it
  -- as the "unchanged by the boolean path" baseline.
  select * into strict id2_after
  from analytics.dashboard_snapshot
  where id = 2;

  select jsonb_agg(to_jsonb(d) order by d.et_day, d.stage)
    into funnel_history_before
  from analytics.funnel_daily as d;

  -- The boolean overload remains the explicit comparison/manual-repair path.
  -- Prove it still rebuilds id=1 without changing the inclusive row.
  id2_before_explicit_refresh := id2_after;
  update analytics.dashboard_snapshot
  set computed_at = frozen
  where id = 1;

  expected_external := analytics.dashboard_payload(false);
  perform analytics.refresh_dashboard_snapshot(false);

  select * into strict id1_after
  from analytics.dashboard_snapshot
  where id = 1;

  select * into strict id2_after_explicit_refresh
  from analytics.dashboard_snapshot
  where id = 2;

  if id1_after.payload is distinct from expected_external
     or id1_after.computed_at = frozen then
    raise exception 'boolean refresh path did not rebuild dashboard row id=1';
  end if;

  if id2_after_explicit_refresh is distinct from id2_before_explicit_refresh then
    raise exception 'boolean refresh path changed dashboard row id=2';
  end if;

  -- FLA-358: the boolean overload can rebuild the external row id=1, whose
  -- funnel excludes internal users. It must never write funnel history, or one
  -- (et_day, stage) key would mix two different populations.
  select jsonb_agg(to_jsonb(d) order by d.et_day, d.stage)
    into funnel_history_after
  from analytics.funnel_daily as d;

  if funnel_history_after is distinct from funnel_history_before then
    raise exception 'boolean refresh path wrote funnel_daily history';
  end if;

  -- FLA-358: a stage renamed or removed from the payload's funnel array must
  -- never leave a stale row frozen under today's et_day. The real payload's
  -- stages are hardcoded, so a stage cannot actually vanish from the live
  -- computation here; instead prove the DELETE directly by inserting a
  -- synthetic stage that will never appear in a real payload and confirming
  -- the next scheduled refresh removes it while every real stage stays
  -- correct. A second synthetic row planted on a different, past et_day
  -- proves the `where et_day = today` scoping actually works and not just
  -- that some deletion happens: past days are frozen observations and must
  -- never be retroactively edited.
  insert into analytics.funnel_daily (et_day, stage, sort_order, users, computed_at)
  values (today_et, 'history-proof-ghost-stage', 999, 0, now());

  insert into analytics.funnel_daily (et_day, stage, sort_order, users, computed_at)
  values (today_et - 1, 'history-proof-ghost-stage', 999, 0, now());

  perform analytics.refresh_dashboard_snapshot();

  select * into strict id2_after
  from analytics.dashboard_snapshot
  where id = 2;

  if exists (
    select 1
    from analytics.funnel_daily
    where et_day = today_et
      and stage = 'history-proof-ghost-stage'
  ) then
    raise exception 'stale ghost stage for today survived the scheduled refresh';
  end if;

  if not exists (
    select 1
    from analytics.funnel_daily
    where et_day = today_et - 1
      and stage = 'history-proof-ghost-stage'
  ) then
    raise exception 'refresh deleted a past-day row; the today-only scoping is broken';
  end if;

  select jsonb_agg(to_jsonb(d) order by d.sort_order) into funnel_recorded
  from (
    select stage, sort_order, users
    from analytics.funnel_daily
    where et_day = today_et
  ) as d;

  select jsonb_agg(
           jsonb_build_object(
             'stage', f.value ->> 'stage',
             'sort_order', (f.value ->> 'sort_order')::integer,
             'users', (f.value ->> 'users')::integer
           )
           order by (f.value ->> 'sort_order')::integer
         ) into funnel_expected
  from jsonb_array_elements(id2_after.payload -> 'funnel') as f(value);

  if funnel_recorded is distinct from funnel_expected then
    raise exception 'real funnel stages were altered by the stale-stage cleanup delete';
  end if;
end;
$proof$;

rollback;

select 'single inclusive dashboard refresh and funnel history verified' as result;
