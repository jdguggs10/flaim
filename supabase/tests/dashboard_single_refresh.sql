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
end;
$proof$;

rollback;

select 'single inclusive dashboard refresh verified' as result;
