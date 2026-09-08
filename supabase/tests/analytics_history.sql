-- Behavioral proof for FLA-265's durable ET-day usage history.
--
-- Run only against a reset local database. The proof deliberately uses a
-- transaction and rolls every synthetic fixture back:
--   docker cp supabase/migrations/20260802131749_add_sync_recent_dashboard_payload.sql \
--     supabase_db_flaim:/tmp/analytics_dashboard_raw_reference.sql
--   docker cp supabase/tests/analytics_history.sql supabase_db_flaim:/tmp/analytics_history.sql
--   docker exec supabase_db_flaim psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/analytics_history.sql
--
-- The separate analytics_history_concurrency.sh proof exercises the singleton
-- state-row lock with two real sessions. A single transaction cannot prove
-- blocking or serialization.

begin;

-- Restore the last raw-only dashboard reader inside this rollback-only
-- transaction. Without this independent reference, comparing the canonical
-- wrapper to dashboard_payload_history() would only compare the function to
-- itself and could not prove pre-prune metric parity. The included historical
-- migration also refreshes snapshots, but both changes roll back below.
\i /tmp/analytics_dashboard_raw_reference.sql

-- Keep today's synthetic seed events for raw-after-marker parity after the
-- controlled oldest-row boundary fixture has been removed.
create temp table history_seed_events as select * from public.mcp_tool_events;

-- Existing concentration rank ties have no secondary ORDER BY. Compare the
-- complete tied-row multiset, while checking rank/cumulative math separately.
create function pg_temp.history_comparable_payload(payload jsonb)
returns jsonb language sql as $$
  select (payload - 'health_summary' - 'tool_health' - 'health_window_days' - 'user_concentration')
    || jsonb_build_object('user_concentration', (
      select coalesce(jsonb_agg(row_data order by row_data::text), '[]'::jsonb)
      from (
        select value - 'rank' - 'cumulative_pct' as row_data
        from jsonb_array_elements(payload -> 'user_concentration')
      ) rows
    ));
$$;

create function pg_temp.history_preserved_payload(payload jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
    'usage_trend', payload -> 'usage_trend',
    'retention_weekly', payload -> 'retention_weekly',
    'totals', payload -> 'totals',
    'funnel', payload -> 'funnel',
    'user_concentration', pg_temp.history_comparable_payload(payload) -> 'user_concentration',
    'cumulative_users', payload -> 'rolling' -> 'cumulative_users'
  );
$$;

do $proof$
declare
  v_today_et constant date := (now() at time zone 'America/New_York')::date;
  v_yesterday_et constant date := v_today_et - 1;
  v_start_et constant date := v_today_et - 6;
  v_marker date;
  v_rows_before bigint;
  v_rows_after bigint;
  v_partial_boundary_ts timestamptz;
  v_partial_et_day date;
  v_raw jsonb;
  v_history jsonb;
  v_external_before jsonb;
  v_external_after jsonb;
  v_internal_before jsonb;
  v_internal_after jsonb;
begin
  -- Keep the fixture namespace narrow. The new aggregate and its singleton
  -- state are reset inside this rollback-only proof; production code never
  -- truncates either relation.
  -- This rollback-only proof needs a controlled oldest raw row for the
  -- partial-retention boundary case below. No caller-visible state survives
  -- the enclosing transaction.
  delete from public.mcp_tool_events;
  delete from public.account_deletions
  where clerk_user_id like 'history-proof-%';
  delete from analytics.internal_users
  where user_id like 'history-proof-%';
  truncate public.mcp_user_daily_et;
  update analytics.history_rollup_state
  set initial_history_start_et_day = null,
      last_closed_et_day = null,
      updated_at = now()
  where id;

  -- An uninitialized state is not a valid source of historical truth. The
  -- sibling payload must fail closed instead of quietly treating it as empty.
  begin
    perform analytics.dashboard_payload_history(false);
    raise exception 'uninitialized history payload unexpectedly succeeded';
  exception
    when others then
      if sqlerrm = 'uninitialized history payload unexpectedly succeeded' then
        raise;
      end if;
  end;

  -- Fixed dates outside the retention window cannot be handed to the close
  -- function, so assert the timezone arithmetic directly. These are the same
  -- date-boundary rules the close function must use, including DST and New
  -- Year transitions.
  if (timestamptz '2026-07-01 03:59:59+00' at time zone 'America/New_York')::date <> date '2026-06-30'
     or (timestamptz '2026-07-01 04:00:00+00' at time zone 'America/New_York')::date <> date '2026-07-01'
     or (timestamptz '2026-01-01 04:59:59+00' at time zone 'America/New_York')::date <> date '2025-12-31'
     or (timestamptz '2026-01-01 05:00:00+00' at time zone 'America/New_York')::date <> date '2026-01-01'
     or (timestamptz '2026-03-08 06:59:59+00' at time zone 'America/New_York')::date <> date '2026-03-08'
     or (timestamptz '2026-03-08 07:00:00+00' at time zone 'America/New_York')::date <> date '2026-03-08'
     or (timestamptz '2026-11-01 05:30:00+00' at time zone 'America/New_York')::date <> date '2026-11-01'
     or (timestamptz '2026-11-01 06:30:00+00' at time zone 'America/New_York')::date <> date '2026-11-01'
     or ((date '2026-03-08'::timestamp at time zone 'America/New_York')
         - (date '2026-03-09'::timestamp at time zone 'America/New_York')) <> interval '-23 hours'
     or ((date '2026-11-01'::timestamp at time zone 'America/New_York')
         - (date '2026-11-02'::timestamp at time zone 'America/New_York')) <> interval '-25 hours' then
    raise exception 'America/New_York day-boundary arithmetic is not DST/year safe';
  end if;

  -- A stale first range must be rejected before it can write a partially
  -- pruned aggregate or advance the marker.
  begin
    perform public.close_mcp_user_daily_et(v_yesterday_et, v_today_et - 91);
    raise exception 'stale initial history range unexpectedly succeeded';
  exception
    when others then
      if sqlerrm = 'stale initial history range unexpectedly succeeded' then
        raise;
      end if;
  end;

  if exists (
    select 1
    from analytics.history_rollup_state
    where id and (initial_history_start_et_day is not null or last_closed_et_day is not null)
  ) or exists (select 1 from public.mcp_user_daily_et) then
    raise exception 'stale initial-range rejection changed history state or data';
  end if;

  -- A row can still be physically present at the retention boundary while its
  -- ET day is incomplete. Its timestamp is just inside now()-90 days, but its
  -- ET midnight is earlier than that cutoff. Closing that day must fail; so
  -- must skipping it, because the raw minimum proves an omission. This is a
  -- deliberate fail-closed boundary, not a request to preserve a partial day.
  v_partial_boundary_ts := now() - interval '90 days' + interval '1 microsecond';
  v_partial_et_day := (v_partial_boundary_ts at time zone 'America/New_York')::date;
  if (v_partial_et_day::timestamp at time zone 'America/New_York') >= now() - interval '90 days' then
    raise exception 'partial-retention fixture did not land in a partially retained ET day';
  end if;
  insert into public.mcp_tool_events (
    ts, env, user_id, auth_type, client_name, tool_name, platform, sport,
    status, error_code, latency_ms, league_hash
  ) values (
    v_partial_boundary_ts,
    'prod', 'history-proof-partial-retention', 'oauth', 'Claude', 'get_roster',
    'espn', 'football', 'ok', null, 100, 'history-proof-league'
  );
  begin
    perform public.close_mcp_user_daily_et(v_yesterday_et, v_partial_et_day);
    raise exception 'partial-retention initial day unexpectedly succeeded';
  exception
    when others then
      if sqlerrm = 'partial-retention initial day unexpectedly succeeded' then
        raise;
      elsif sqlerrm <> 'analytics history close starts before the fully available 90-day raw window' then
        raise;
      end if;
  end;
  begin
    perform public.close_mcp_user_daily_et(v_yesterday_et, v_partial_et_day + 1);
    raise exception 'partial-retention omission unexpectedly succeeded';
  exception
    when others then
      if sqlerrm = 'partial-retention omission unexpectedly succeeded' then
        raise;
      elsif sqlerrm <> 'initial_history_start_et_day must not omit available raw event history' then
        raise;
      end if;
  end;
  if exists (
    select 1
    from analytics.history_rollup_state
    where id and (initial_history_start_et_day is not null or last_closed_et_day is not null)
  ) or exists (select 1 from public.mcp_user_daily_et) then
    raise exception 'partial-retention rejections changed history state or data';
  end if;
  delete from public.mcp_tool_events
  where user_id = 'history-proof-partial-retention';
  insert into public.mcp_tool_events overriding system value
  select * from pg_temp.history_seed_events;

  -- All fixture events land in the current fully retained interval. The raw
  -- writer owns `ts`; these explicit values model the rows it has already
  -- persisted, not a caller-controlled event-time API.
  insert into public.mcp_tool_events (
    ts, env, user_id, auth_type, client_name, tool_name, platform, sport,
    status, error_code, latency_ms, league_hash
  )
  select (v_start_et::timestamp + interval '12 hours') at time zone 'America/New_York',
         'prod', 'history-proof-external', 'oauth', 'Claude', 'get_roster',
         'espn', 'football', 'ok', null, 100, 'history-proof-league'
  from generate_series(1, 2);

  insert into public.mcp_tool_events (
    ts, env, user_id, auth_type, client_name, tool_name, platform, sport,
    status, error_code, latency_ms, league_hash
  ) values
    ((v_start_et::timestamp + interval '1 day 12 hours') at time zone 'America/New_York',
      'prod', 'history-proof-external', 'oauth', 'Claude', 'get_league_info', 'espn', 'football', 'ok', null, 120, 'history-proof-league'),
    ((v_start_et::timestamp + interval '3 days 12 hours') at time zone 'America/New_York',
      'prod', 'history-proof-external', 'oauth', 'ChatGPT', 'get_matchups', 'espn', 'football', 'error', 'SYNTHETIC', 180, 'history-proof-league'),
    ((v_start_et::timestamp + interval '3 days 13 hours') at time zone 'America/New_York',
      'prod', 'history-proof-external', 'oauth', 'ChatGPT', 'get_matchups', 'espn', 'football', 'ok', null, 110, 'history-proof-league'),
    ((v_start_et::timestamp + interval '3 days 14 hours') at time zone 'America/New_York',
      'prod', 'history-proof-external', 'oauth', 'ChatGPT', 'get_matchups', 'espn', 'football', 'ok', null, 105, 'history-proof-league'),
    ((v_start_et::timestamp + interval '2 days 12 hours') at time zone 'America/New_York',
      'prod', 'history-proof-external', 'oauth', 'Claude', 'get_standings', 'espn', 'football', 'ok', null, 100, 'history-proof-league'),
    ((v_start_et::timestamp + interval '4 days 12 hours') at time zone 'America/New_York',
      'prod', 'history-proof-tombstoned', 'oauth', 'Claude', 'get_standings', 'espn', 'football', 'ok', null, 90, 'history-proof-league'),
    ((v_start_et::timestamp + interval '4 days 13 hours') at time zone 'America/New_York',
      'prod', 'history-proof-reclassify', 'oauth', 'Claude', 'get_players', 'espn', 'football', 'ok', null, 95, 'history-proof-league'),
    ((v_start_et::timestamp + interval '4 days 14 hours') at time zone 'America/New_York',
      'prod', 'history-proof-reclassify', 'oauth', 'Claude', 'get_players', 'espn', 'football', 'ok', null, 96, 'history-proof-league'),
    ((v_start_et::timestamp + interval '5 days 12 hours') at time zone 'America/New_York',
      'prod', 'history-proof-null-mode', 'oauth', null, 'get_draft', 'espn', 'football', 'ok', null, 99, 'history-proof-league'),
    ((v_start_et::timestamp + interval '5 days 12 hours 1 minute') at time zone 'America/New_York',
      'prod', 'history-proof-null-mode', 'oauth', null, 'get_draft', 'espn', 'football', 'ok', null, 99, 'history-proof-league'),
    ((v_start_et::timestamp + interval '5 days 12 hours 2 minutes') at time zone 'America/New_York',
      'prod', 'history-proof-null-mode', 'oauth', null, 'get_draft', 'espn', 'football', 'ok', null, 99, 'history-proof-league'),
    ((v_start_et::timestamp + interval '5 days 12 hours 3 minutes') at time zone 'America/New_York',
      'prod', 'history-proof-null-mode', 'oauth', 'Beta', 'get_draft', 'espn', 'football', 'ok', null, 99, 'history-proof-league'),
    ((v_start_et::timestamp + interval '5 days 12 hours 4 minutes') at time zone 'America/New_York',
      'prod', 'history-proof-null-mode', 'oauth', 'Beta', 'get_draft', 'espn', 'football', 'ok', null, 99, 'history-proof-league'),
    ((v_start_et::timestamp + interval '5 days 12 hours 5 minutes') at time zone 'America/New_York',
      'prod', 'history-proof-empty-mode', 'oauth', '', 'get_draft', 'espn', 'football', 'ok', null, 99, 'history-proof-league'),
    ((v_start_et::timestamp + interval '5 days 12 hours 6 minutes') at time zone 'America/New_York',
      'prod', 'history-proof-empty-mode', 'oauth', '', 'get_draft', 'espn', 'football', 'ok', null, 99, 'history-proof-league'),
    ((v_start_et::timestamp + interval '5 days 12 hours 7 minutes') at time zone 'America/New_York',
      'prod', 'history-proof-empty-mode', 'oauth', '', 'get_draft', 'espn', 'football', 'ok', null, 99, 'history-proof-league'),
    ((v_start_et::timestamp + interval '5 days 12 hours 8 minutes') at time zone 'America/New_York',
      'prod', 'history-proof-empty-mode', 'oauth', 'Alpha', 'get_draft', 'espn', 'football', 'ok', null, 99, 'history-proof-league'),
    ((v_start_et::timestamp + interval '5 days 12 hours 9 minutes') at time zone 'America/New_York',
      'prod', 'history-proof-empty-mode', 'oauth', 'Alpha', 'get_draft', 'espn', 'football', 'ok', null, 99, 'history-proof-league'),
    ((v_start_et::timestamp + interval '5 days 12 hours 9 minutes 30 seconds') at time zone 'America/New_York',
      'prod', 'history-proof-empty-mode', 'oauth', '', 'get_draft', 'espn', 'football', 'ok', null, 99, 'history-proof-league'),
    ((v_start_et::timestamp + interval '5 days 12 hours 10 minutes') at time zone 'America/New_York',
      'prod', 'history-proof-tie-mode', 'oauth', 'Alpha', 'get_draft', 'espn', 'football', 'ok', null, 99, 'history-proof-league'),
    ((v_start_et::timestamp + interval '5 days 12 hours 11 minutes') at time zone 'America/New_York',
      'prod', 'history-proof-tie-mode', 'oauth', 'Alpha', 'get_draft', 'espn', 'football', 'ok', null, 99, 'history-proof-league'),
    ((v_start_et::timestamp + interval '5 days 12 hours 12 minutes') at time zone 'America/New_York',
      'prod', 'history-proof-tie-mode', 'oauth', 'Beta', 'get_draft', 'espn', 'football', 'ok', null, 99, 'history-proof-league'),
    ((v_start_et::timestamp + interval '5 days 12 hours 13 minutes') at time zone 'America/New_York',
      'prod', 'history-proof-tie-mode', 'oauth', 'Beta', 'get_draft', 'espn', 'football', 'ok', null, 99, 'history-proof-league'),
    ((v_start_et::timestamp + interval '5 days 15 hours') at time zone 'America/New_York',
      'prod', 'history-proof-internal', 'oauth', 'Claude', 'get_free_agents', 'espn', 'football', 'ok', null, 101, 'history-proof-league'),
    ((v_start_et::timestamp + interval '5 days 16 hours') at time zone 'America/New_York',
      'prod', 'history-proof-internal', 'oauth', 'Claude', 'get_free_agents', 'espn', 'football', 'ok', null, 101, 'history-proof-league'),
    -- The durable grain keeps platform and sport even when every preceding
    -- identity dimension is the same. NULL and literal-empty dimensions also
    -- stay distinct, so historical rows cannot silently merge two sources.
    ((v_start_et::timestamp + interval '16 hours') at time zone 'America/New_York',
      'prod', 'history-proof-dimensions', 'oauth', 'Dimensions', 'get_roster', 'espn', 'football', 'ok', null, 100, 'history-proof-league'),
    ((v_start_et::timestamp + interval '16 hours 1 minute') at time zone 'America/New_York',
      'prod', 'history-proof-dimensions', 'oauth', 'Dimensions', 'get_roster', 'espn', 'football', 'ok', null, 100, 'history-proof-league'),
    ((v_start_et::timestamp + interval '16 hours 2 minutes') at time zone 'America/New_York',
      'prod', 'history-proof-dimensions', 'oauth', 'Dimensions', 'get_roster', 'yahoo', 'baseball', 'ok', null, 100, 'history-proof-league'),
    ((v_start_et::timestamp + interval '16 hours 3 minutes') at time zone 'America/New_York',
      'prod', 'history-proof-dimensions', 'oauth', 'Dimensions', 'get_roster', 'yahoo', 'baseball', 'ok', null, 100, 'history-proof-league'),
    ((v_start_et::timestamp + interval '16 hours 4 minutes') at time zone 'America/New_York',
      'prod', 'history-proof-dimensions', 'oauth', 'Dimensions', 'get_roster', 'yahoo', 'baseball', 'ok', null, 100, 'history-proof-league'),
    ((v_start_et::timestamp + interval '16 hours 5 minutes') at time zone 'America/New_York',
      'prod', 'history-proof-dimensions', 'oauth', 'Dimensions', 'get_roster', null, null, 'ok', null, 100, 'history-proof-league'),
    ((v_start_et::timestamp + interval '16 hours 6 minutes') at time zone 'America/New_York',
      'prod', 'history-proof-dimensions', 'oauth', 'Dimensions', 'get_roster', null, null, 'ok', null, 100, 'history-proof-league'),
    ((v_start_et::timestamp + interval '16 hours 7 minutes') at time zone 'America/New_York',
      'prod', 'history-proof-dimensions', 'oauth', 'Dimensions', 'get_roster', null, null, 'ok', null, 100, 'history-proof-league'),
    ((v_start_et::timestamp + interval '16 hours 8 minutes') at time zone 'America/New_York',
      'prod', 'history-proof-dimensions', 'oauth', 'Dimensions', 'get_roster', null, null, 'ok', null, 100, 'history-proof-league'),
    ((v_start_et::timestamp + interval '16 hours 9 minutes') at time zone 'America/New_York',
      'prod', 'history-proof-dimensions', 'oauth', 'Dimensions', 'get_roster', null, '', 'ok', null, 100, 'history-proof-league'),
    ((v_start_et::timestamp + interval '16 hours 10 minutes') at time zone 'America/New_York',
      'prod', 'history-proof-dimensions', 'oauth', 'Dimensions', 'get_roster', '', null, 'ok', null, 100, 'history-proof-league'),
    ((v_start_et::timestamp + interval '16 hours 11 minutes') at time zone 'America/New_York',
      'prod', 'history-proof-dimensions', 'oauth', 'Dimensions', 'get_roster', '', '', 'ok', null, 100, 'history-proof-league'),
    ((v_start_et::timestamp + interval '16 hours 12 minutes') at time zone 'America/New_York',
      'prod', 'history-proof-dimensions', 'oauth', 'Dimensions', 'get_roster', '', '', 'ok', null, 100, 'history-proof-league'),
    ((v_start_et::timestamp + interval '4 days 17 hours') at time zone 'America/New_York',
      'preview', 'history-proof-nonprod', 'api_key', 'Preview Client', 'get_roster', 'espn', 'football', 'ok', null, 100, 'history-proof-league');

  insert into public.account_deletions (clerk_user_id)
  values ('history-proof-tombstoned');
  insert into analytics.internal_users (user_id, note)
  values ('history-proof-internal', 'rollback-only analytics history proof');

  -- A first run may name the retained start. It must build every closed ET day
  -- through yesterday. The sibling must preserve the existing payload except
  -- for intentionally redefined health windows/metadata and unspecified order
  -- among concentration rows with identical call counts.
  perform public.close_mcp_user_daily_et(v_yesterday_et, v_start_et);

  select last_closed_et_day into v_marker
  from analytics.history_rollup_state
  where id;
  if v_marker <> v_yesterday_et then
    raise exception 'first history close stored marker %, expected %', v_marker, v_yesterday_et;
  end if;

  if (
    select count(*)
    from public.mcp_user_daily_et
    where et_day = v_start_et
      and env = 'prod'
      and user_id = 'history-proof-dimensions'
      and auth_type = 'oauth'
      and client_name = 'Dimensions'
  ) <> 6 then
    raise exception 'platform/sport dimensions did not produce six distinct daily groups';
  end if;
  if exists (
    select 1
    from (values
      ('espn'::text, 'football'::text, 2::bigint),
      ('yahoo'::text, 'baseball'::text, 3::bigint),
      (null::text, null::text, 4::bigint),
      (null::text, ''::text, 1::bigint),
      (''::text, null::text, 1::bigint),
      (''::text, ''::text, 2::bigint)
    ) expected(platform, sport, call_count)
    left join public.mcp_user_daily_et as d
      on d.et_day = v_start_et
      and d.env = 'prod'
      and d.user_id = 'history-proof-dimensions'
      and d.auth_type = 'oauth'
      and d.client_name = 'Dimensions'
      and (d.platform, d.sport) is not distinct from (expected.platform, expected.sport)
    where d.call_count is distinct from expected.call_count
  ) then
    raise exception 'platform/sport daily grouping lost a NULL or empty dimension distinction';
  end if;
  begin
    insert into public.mcp_user_daily_et (
      et_day, env, user_id, auth_type, client_name, platform, sport, call_count
    ) values (
      v_start_et, 'prod', 'history-proof-dimensions', 'oauth', 'Dimensions', null, null, 1
    );
    raise exception 'daily grain accepted a duplicate all-NULL platform/sport key';
  exception
    when unique_violation then null;
  end;

  v_raw := analytics.dashboard_payload(false);
  v_history := analytics.dashboard_payload_history(false);
  if pg_temp.history_comparable_payload(v_raw)
       is distinct from pg_temp.history_comparable_payload(v_history) then
    raise exception 'external history payload diverges from raw payload before prune';
  end if;
  if (v_history ->> 'health_window_days')::int <> 30 then
    raise exception 'external history payload lacks health_window_days=30';
  end if;
  if (v_raw -> 'health_summary_7d') is distinct from (v_history -> 'health_summary_7d')
     or (v_raw -> 'tool_health_7d') is distinct from (v_history -> 'tool_health_7d') then
    raise exception 'external 7-day health contract changed while adding bounded all-time health';
  end if;

  v_raw := analytics.dashboard_payload(true);
  v_history := analytics.dashboard_payload_history(true);
  if pg_temp.history_comparable_payload(v_raw)
       is distinct from pg_temp.history_comparable_payload(v_history) then
    raise exception 'internal-inclusive history payload diverges from raw payload before prune: %',
      (select jsonb_object_agg(k, jsonb_build_object('raw', v_raw -> k, 'history', v_history -> k))
       from jsonb_object_keys(v_raw - 'health_summary' - 'tool_health') as keys(k)
       where (v_raw -> k) is distinct from (v_history -> k));
  end if;
  if exists (
    select 1 from (
      select value, ordinality,
        sum((value ->> 'calls')::numeric) over (order by ordinality) as cumulative_calls,
        sum((value ->> 'calls')::numeric) over () as total_calls,
        lag((value ->> 'calls')::bigint) over (order by ordinality) as previous_calls
      from jsonb_array_elements(v_history -> 'user_concentration') with ordinality
    ) ranked
    where (value ->> 'rank')::bigint <> ordinality
      or (value ->> 'calls')::bigint > previous_calls
      or (value ->> 'cumulative_pct')::numeric <> round(100 * cumulative_calls / total_calls, 1)
  ) then
    raise exception 'history concentration rank/cumulative math is incorrect';
  end if;
  if (v_history ->> 'health_window_days')::int <> 30 then
    raise exception 'internal-inclusive history payload lacks health_window_days=30';
  end if;
  if (v_raw -> 'health_summary_7d') is distinct from (v_history -> 'health_summary_7d')
     or (v_raw -> 'tool_health_7d') is distinct from (v_history -> 'tool_health_7d') then
    raise exception '7-day health contract changed while adding bounded all-time health';
  end if;

  -- The only intentional non-parity is all-time health becoming a 30-day raw
  -- window. A 31-day event remains visible to the old key but must not leak
  -- into the new health baseline; the seven-day key stays unchanged.
  insert into public.mcp_tool_events (
    ts, env, user_id, auth_type, client_name, tool_name, platform, sport,
    status, error_code, latency_ms, league_hash
  ) values (
    now() - interval '31 days',
    'prod', 'history-proof-health-old', 'oauth', 'Claude', 'get_roster',
    'espn', 'football', 'error', 'SYNTHETIC_OLD', 200, 'history-proof-league'
  );
  v_raw := analytics.dashboard_payload(false);
  v_history := analytics.dashboard_payload_history(false);
  if (v_raw -> 'health_summary' ->> 'calls')::int
       <> (v_history -> 'health_summary' ->> 'calls')::int + 1
     or (v_raw -> 'health_summary_7d') is distinct from (v_history -> 'health_summary_7d') then
    raise exception '30-day health-window exception is not isolated from 7-day health';
  end if;

  select count(*) into v_rows_before from public.mcp_user_daily_et;
  perform public.close_mcp_user_daily_et(v_yesterday_et, v_start_et);
  select count(*) into v_rows_after from public.mcp_user_daily_et;
  if v_rows_after <> v_rows_before then
    raise exception 'idempotent repeated history close changed row count (% -> %)', v_rows_before, v_rows_after;
  end if;

  -- An invalid catch-up argument is atomic: neither summary data nor its
  -- closed-through marker may move on the failed call.
  begin
    perform public.close_mcp_user_daily_et(v_today_et, null);
    raise exception 'future through date unexpectedly succeeded';
  exception
    when others then
      if sqlerrm = 'future through date unexpectedly succeeded' then
        raise;
      end if;
  end;
  if (select last_closed_et_day from analytics.history_rollup_state where id) <> v_yesterday_et
     or (select count(*) from public.mcp_user_daily_et) <> v_rows_before then
    raise exception 'failed history close changed marker or aggregate rows';
  end if;

  -- The raw records can now disappear without erasing the historical usage,
  -- funnel, first-use, or concentration information. This simulates the
  -- pruning boundary after parity has already passed.
  v_raw := analytics.dashboard_payload_history(false);
  v_history := analytics.dashboard_payload_history(true);
  delete from public.mcp_tool_events
  where user_id like 'history-proof-%';

  v_external_before := analytics.dashboard_payload_history(false);
  v_internal_before := analytics.dashboard_payload_history(true);
  if pg_temp.history_preserved_payload(v_raw)
       is distinct from pg_temp.history_preserved_payload(v_external_before)
     or pg_temp.history_preserved_payload(v_history)
       is distinct from pg_temp.history_preserved_payload(v_internal_before) then
    raise exception 'pruning changed a preserved historical metric';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_external_before -> 'usage_trend') as d
    where d ->> 'et_day' = v_start_et::text
      and (d ->> 'dau')::int >= 1
  ) then
    raise exception 'pruned raw history disappeared from ET usage trend';
  end if;
  if (v_external_before -> 'totals' ->> 'alltime_calls')::int < 20 then
    raise exception 'pruned raw history disappeared from all-time call totals';
  end if;
  if not exists (
    select 1 from public.mcp_user_daily_et
    where user_id = 'history-proof-tombstoned'
  ) then
    raise exception 'tombstoned user history was not retained in daily aggregate';
  end if;
  if not exists (
    select 1 from public.mcp_user_daily_et
    where user_id = 'history-proof-nonprod'
      and env = 'preview'
      and auth_type = 'api_key'
  ) then
    raise exception 'close omitted non-production/non-oauth raw history';
  end if;

  -- Null and literal-empty client names are semantically different. The raw
  -- mode ignores NULL values; a real empty string remains a real client value.
  if not exists (
    select 1 from jsonb_array_elements(v_external_before -> 'user_concentration') as c
    where (c ->> 'calls')::int = 5 and c ->> 'client' = 'Beta'
  ) then
    raise exception 'weighted mode did not ignore NULL client values';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_external_before -> 'user_concentration') as c
    where (c ->> 'calls')::int = 6 and c ->> 'client' = ''
  ) then
    raise exception 'literal empty client was not retained distinctly from NULL';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_external_before -> 'user_concentration') as c
    where (c ->> 'calls')::int = 4 and c ->> 'client' = 'Alpha'
  ) then
    raise exception 'weighted client-mode lexical tie break is not deterministic';
  end if;

  -- Internal classification remains a read-time decision. Reclassifying an
  -- already summarized user must remove their retained history from external
  -- figures while leaving the internal-inclusive variant unchanged.
  insert into analytics.internal_users (user_id, note)
  values ('history-proof-reclassify', 'rollback-only reclassification proof');
  v_external_after := analytics.dashboard_payload_history(false);
  v_internal_after := analytics.dashboard_payload_history(true);
  if (v_external_before -> 'totals' ->> 'alltime_calls')::int
       - (v_external_after -> 'totals' ->> 'alltime_calls')::int <> 2 then
    raise exception 'read-time internal reclassification did not remove two retained calls';
  end if;
  if (v_internal_after -> 'totals' ->> 'alltime_calls')::int
       <> (v_internal_before -> 'totals' ->> 'alltime_calls')::int then
    raise exception 'internal-inclusive history changed unexpectedly after reclassification';
  end if;

  -- The retention-aware aggregate, state, and mutation/read functions are all
  -- owner-only. RLS is defense in depth; ACLs must also deny every Data API
  -- role and the analytics dashboard role.
  if exists (
    select 1
    from unnest(array['anon', 'authenticated', 'service_role', 'analytics_readonly']) as r(role_name)
    where has_table_privilege(role_name, 'public.mcp_user_daily_et', 'select')
       or has_table_privilege(role_name, 'public.mcp_user_daily_et', 'insert')
       or has_table_privilege(role_name, 'public.mcp_user_daily_et', 'update')
       or has_table_privilege(role_name, 'public.mcp_user_daily_et', 'delete')
       or has_table_privilege(role_name, 'analytics.history_rollup_state', 'select')
       or has_table_privilege(role_name, 'analytics.history_rollup_state', 'insert')
       or has_table_privilege(role_name, 'analytics.history_rollup_state', 'update')
       or has_table_privilege(role_name, 'analytics.history_rollup_state', 'delete')
       or has_function_privilege(role_name, 'public.close_mcp_user_daily_et(date,date)', 'execute')
       or has_function_privilege(role_name, 'analytics.dashboard_payload_history(boolean)', 'execute')
  ) then
    raise exception 'non-owner retains a privilege on ET history data or functions';
  end if;
  if not has_function_privilege('postgres', 'public.close_mcp_user_daily_et(date,date)', 'execute')
     or not has_function_privilege('postgres', 'analytics.dashboard_payload_history(boolean)', 'execute') then
    raise exception 'history owner lacks function execution privilege';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.mcp_user_daily_et'::regclass)
     or exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mcp_user_daily_et')
     or not (select relrowsecurity from pg_class where oid = 'analytics.history_rollup_state'::regclass)
     or exists (select 1 from pg_policies where schemaname = 'analytics' and tablename = 'history_rollup_state') then
    raise exception 'ET history relations must use RLS with no public policies';
  end if;

  -- A normal missed nightly run is self-healing: the next invocation replaces
  -- every still-retained ET day between the marker and yesterday, including
  -- empty days, rather than permanently skipping the missed date.
  delete from public.mcp_tool_events
  where user_id like 'history-proof-catchup-%';
  truncate public.mcp_user_daily_et;
  update analytics.history_rollup_state
  set initial_history_start_et_day = null,
      last_closed_et_day = null,
      updated_at = now()
  where id;
  insert into public.mcp_tool_events (
    ts, env, user_id, auth_type, client_name, tool_name, platform, sport,
    status, error_code, latency_ms, league_hash
  ) values
    (((v_today_et - 4)::timestamp + interval '12 hours') at time zone 'America/New_York',
      'prod', 'history-proof-catchup-first', 'oauth', 'Claude', 'get_roster', 'espn', 'football', 'ok', null, 100, 'history-proof-league'),
    ((v_yesterday_et::timestamp + interval '12 hours') at time zone 'America/New_York',
      'prod', 'history-proof-catchup-last', 'oauth', 'Claude', 'get_roster', 'espn', 'football', 'ok', null, 100, 'history-proof-league');
  perform public.close_mcp_user_daily_et(v_today_et - 4, v_today_et - 4);
  perform public.close_mcp_user_daily_et(v_yesterday_et, null);
  if (select last_closed_et_day from analytics.history_rollup_state where id) <> v_yesterday_et
     or not exists (select 1 from public.mcp_user_daily_et where user_id = 'history-proof-catchup-first')
     or not exists (select 1 from public.mcp_user_daily_et where user_id = 'history-proof-catchup-last') then
    raise exception 'missed nightly history close did not catch up through yesterday';
  end if;
end;
$proof$;

rollback;

select 'analytics history behavior verified' as result;
