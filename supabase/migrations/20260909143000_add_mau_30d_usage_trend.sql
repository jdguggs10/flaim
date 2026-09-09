-- FLA-357: expose a rolling 30-day distinct-user trend (`mau_30d`) on each
-- `usage_trend` day of the analytics dashboard payload.
--
-- MAU already exists in the payload, but only as the scalar
-- `rolling.mau` (a trailing-720h count taken at snapshot time), so the
-- dashboard can chart a WAU trend and cannot chart a MAU one. The permanent
-- ET-day user history that `wau_7d` is computed from
-- (`history_user_days`: `public.mcp_user_daily_et` through the close marker,
-- plus raw `public.mcp_tool_events` strictly after it) already contains
-- everything a 30-day window needs; this migration only reads it.
--
-- This is a full CREATE OR REPLACE of the current
-- `analytics.dashboard_payload_history(boolean)` body, copied verbatim from
-- 20260906104125_add_analytics_history_payload.sql. That file is still the
-- latest definition in the migration path, and on 2026-09-09 its function body
-- hashed identically to the live hosted `prosrc` (md5
-- 5f6984848912f524f0c445ed88a00958, 26429 bytes), so nothing landed
-- out-of-band that this replace would clobber.
--
-- Two additive keys per `usage_trend` row, and nothing else:
--   * `mau_30d`          distinct users over `(et_day - 29 .. et_day]`
--   * `mau_30d_partial`  true while that window reaches back before
--                        history_start_et_day (the authoritative tracking-
--                        start day from analytics.history_rollup_state,
--                        already read into a local variable above — NOT a
--                        bounds.lo-style MIN over rows present in
--                        history_user_days, which would understate coverage
--                        on a zero-activity day at the very start of
--                        tracking; caught in cross-model review)
--
-- Every other key, window, source, and failure mode is unchanged. The scalar
-- `rolling.mau` is deliberately untouched: it is a different measurement
-- (trailing 720 hours at snapshot time, not 30 complete ET days), and the
-- dashboard still headlines it.
--
-- Consumers are additive-tolerant (the payload is jsonb and older snapshots
-- already omit newer keys), so a snapshot refreshed before this migration
-- simply has no `mau_30d` and the tile falls back to its chartless rendering.
--
-- Hosted application and any snapshot refresh remain separate approval gates.

create or replace function analytics.dashboard_payload_history(
  include_internal boolean
)
returns jsonb
language plpgsql
stable
security invoker
set search_path to ''
as $function$
declare
  history_start_et_day date;
  history_marker_et_day date;
begin
  select
    s.initial_history_start_et_day,
    s.last_closed_et_day
  into history_start_et_day, history_marker_et_day
  from analytics.history_rollup_state as s
  where s.id = true;

  if not found
    or history_start_et_day is null
    or history_marker_et_day is null
  then
    raise exception using
      errcode = '55000',
      message = 'analytics history is not initialized; run the initial close before reading the history payload';
  end if;

  -- The raw side of the marker must still be wholly recoverable. Refuse to
  -- return a plausible-looking partial history if close/backfill has missed the
  -- 90-day retention window.
  if (history_marker_et_day + 1)::timestamp
      at time zone 'America/New_York' < now() - interval '90 days'
  then
    raise exception using
      errcode = '55000',
      message = 'analytics history rollup is stale beyond the 90-day raw window';
  end if;

  return (
    with excluded as (
      -- Empty when include_internal=true: NOT IN (empty set) passes every row.
      select user_id
      from analytics.internal_users
      where not include_internal
    ),
    history_calls as (
      -- Closed days come only from the permanent aggregate.
      select
        d.et_day,
        d.user_id,
        d.client_name,
        d.call_count
      from public.mcp_user_daily_et as d
      where d.env = 'prod'
        and d.auth_type = 'oauth'
        and d.et_day >= history_start_et_day
        and d.et_day <= history_marker_et_day
        and d.user_id not in (select user_id from excluded)

      union all

      -- The raw side begins strictly after the marker. This includes missed
      -- closed days plus the naturally open current ET day, without overlap.
      select
        (e.ts at time zone 'America/New_York')::date as et_day,
        e.user_id,
        e.client_name,
        count(*) as call_count
      from public.mcp_tool_events as e
      where e.env = 'prod'
        and e.auth_type = 'oauth'
        and e.user_id is not null
        and (e.ts at time zone 'America/New_York')::date
          > history_marker_et_day
        and e.user_id not in (select user_id from excluded)
      group by
        (e.ts at time zone 'America/New_York')::date,
        e.user_id,
        e.client_name
    ),
    history_user_days as (
      select distinct h.et_day, h.user_id
      from history_calls as h
    )
    select jsonb_build_object(

      -- usage_trend (038), now preserved at ET-day user grain.
      'usage_trend', (
        select coalesce(jsonb_agg(u order by u.et_day), '[]'::jsonb)
        from (
          with firsts as (
            select user_id, min(et_day) as first_day
            from history_user_days
            group by user_id
          ),
          daily as (
            select et_day, count(*) as dau
            from history_user_days
            group by et_day
          ),
          newd as (
            select first_day as et_day, count(*) as new_users
            from firsts
            group by first_day
          ),
          bounds as (
            select min(et_day) as lo, max(et_day) as hi
            from history_user_days
          ),
          days as (
            select generate_series(lo, hi, '1 day')::date as et_day
            from bounds
            where lo is not null
          )
          select
            d.et_day::text as et_day,
            coalesce(da.dau, 0)::int as dau,
            (
              select count(distinct e.user_id)::int
              from history_user_days as e
              where e.et_day > d.et_day - 7
                and e.et_day <= d.et_day
            ) as wau_7d,
            -- FLA-357: the 30-day sibling of wau_7d, same correlated-subquery
            -- shape over the same history_user_days set, so a MAU trend line
            -- reads off exactly the source WAU's already does.
            (
              select count(distinct e.user_id)::int
              from history_user_days as e
              where e.et_day > d.et_day - 30
                and e.et_day <= d.et_day
            ) as mau_30d,
            -- Left-truncation disclosure, same contract as retention_weekly's
            -- week_partial_start: the window is 30 calendar days wide, but
            -- history only starts at history_start_et_day, so any day within
            -- the first 29 covers fewer than 30 real days and is NOT
            -- comparable to a later one. The value stays real (it is a true
            -- distinct count over the days that exist); the flag says the
            -- window is short.
            --
            -- Deliberately history_start_et_day (the plpgsql variable read
            -- from analytics.history_rollup_state above), NOT bounds.lo:
            -- bounds.lo is min(et_day) over ROWS PRESENT in
            -- history_user_days, which understates true coverage on any
            -- zero-activity day at the very start of tracking (a real,
            -- covered day with no rows is invisible to a row-presence MIN).
            -- history_start_et_day is the authoritative day tracking began,
            -- regardless of whether that day happened to have any calls.
            (d.et_day - 29 < history_start_et_day) as mau_30d_partial,
            coalesce(nw.new_users, 0)::int as new_users,
            (coalesce(da.dau, 0) - coalesce(nw.new_users, 0))::int
              as returning_users
          from days as d
          left join daily as da on da.et_day = d.et_day
          left join newd as nw on nw.et_day = d.et_day
        ) as u
      ),

      -- retention_weekly (047 / FLA-165): same ET weekly cohort contract.
      'retention_weekly', (
        select coalesce(jsonb_agg(rw order by rw.week_start), '[]'::jsonb)
        from (
          with ev as (
            select distinct
              user_id,
              date_trunc('week', et_day)::date as wk
            from history_user_days
          ),
          this_wk as (
            select date_trunc(
              'week',
              now() at time zone 'America/New_York'
            )::date as wk
          ),
          bounds as (
            select
              min(et_day) as first_day,
              date_trunc('week', min(et_day))::date as first_wk
            from history_user_days
          ),
          weeks as (
            select generate_series(
              first_wk,
              (select wk from this_wk),
              '7 days'
            )::date as wk
            from bounds
            where first_wk is not null
          ),
          cohorts as (
            select wk, count(*) as queriers
            from ev
            group by wk
          ),
          returns as (
            select e.wk, count(*) as returned
            from ev as e
            where exists (
              select 1
              from ev as n
              where n.user_id = e.user_id
                and n.wk = e.wk + 7
            )
            group by e.wk
          )
          select
            w.wk::text as week_start,
            coalesce(c.queriers, 0)::int as queriers,
            case
              when w.wk >= t.wk then null
              else coalesce(r.returned, 0)::int
            end as returned_next,
            case
              when w.wk >= t.wk then null
              else round(
                100.0 * coalesce(r.returned, 0) / nullif(c.queriers, 0),
                1
              )
            end as return_pct,
            (w.wk < (select first_day from bounds)) as week_partial_start,
            (w.wk >= t.wk) as week_open,
            (w.wk < t.wk and w.wk + 7 >= t.wk) as next_week_open
          from weeks as w
          cross join this_wk as t
          left join cohorts as c on c.wk = w.wk
          left join returns as r on r.wk = w.wk
        ) as rw
      ),

      -- usage_totals (037), with calls summed from permanent history.
      'totals', (
        select to_jsonb(t)
        from (
          select
            count(distinct user_id) filter (
              where et_day >= date_trunc(
                'year',
                now() at time zone 'America/New_York'
              )::date
            )::int as ytd_users,
            count(distinct user_id)::int as alltime_users,
            coalesce(sum(call_count) filter (
              where et_day >= date_trunc(
                'year',
                now() at time zone 'America/New_York'
              )::date
            ), 0)::int as ytd_calls,
            coalesce(sum(call_count), 0)::int as alltime_calls
          from history_calls
        ) as t
      ),

      -- funnel_snapshot (037). A deleted account retained only in aggregate
      -- history still counts in queried_ever and therefore total_known.
      'funnel', (
        select coalesce(jsonb_agg(f order by f.sort_order), '[]'::jsonb)
        from (
          with oauth as (
            select distinct user_id as uid
            from public.oauth_tokens
            where user_id is not null
              and user_id not in (select user_id from excluded)
          ),
          creds as (
            select uid
            from (
              select clerk_user_id as uid
              from public.espn_credentials
              where clerk_user_id is not null
              union
              select clerk_user_id
              from public.yahoo_credentials
              where clerk_user_id is not null
              union
              select clerk_user_id
              from public.sleeper_connections
              where clerk_user_id is not null
            ) as c
            where uid not in (select user_id from excluded)
          ),
          leagues as (
            select uid
            from (
              select clerk_user_id as uid
              from public.espn_leagues
              where clerk_user_id is not null
              union
              select clerk_user_id
              from public.yahoo_leagues
              where clerk_user_id is not null
              union
              select clerk_user_id
              from public.sleeper_leagues
              where clerk_user_id is not null
            ) as l
            where uid not in (select user_id from excluded)
          ),
          queried as (
            select distinct user_id as uid
            from history_calls
          ),
          known as (
            select uid from oauth
            union
            select uid from creds
            union
            select uid from leagues
            union
            select uid from queried
          )
          select
            1 as sort_order,
            'total_known' as stage,
            (select count(*) from known)::int as users
          union all
          select 2, 'authorized_connector', (select count(*) from oauth)::int
          union all
          select 3, 'captured_creds', (select count(*) from creds)::int
          union all
          select 4, 'connected_league', (select count(*) from leagues)::int
          union all
          select 5, 'queried_ever', (select count(*) from queried)::int
          union all
          select
            6,
            'both_connector_and_league',
            (
              select count(*)
              from oauth as o
              where exists (select 1 from leagues as l where l.uid = o.uid)
            )::int
          union all
          select
            7,
            'leak_connector_no_league',
            (
              select count(*)
              from oauth as o
              where not exists (
                select 1 from leagues as l where l.uid = o.uid
              )
            )::int
          union all
          select
            8,
            'leak_league_no_connector',
            (
              select count(*)
              from leagues as l
              where not exists (select 1 from oauth as o where o.uid = l.uid)
            )::int
          union all
          select
            9,
            'leak_creds_no_league',
            (
              select count(*)
              from creds as c
              where not exists (
                select 1 from leagues as l where l.uid = c.uid
              )
            )::int
        ) as f
      ),

      -- usage_rolling (040). Exact trailing 1/7/30-day metrics stay raw;
      -- cumulative_users is the all-history distinct-user count.
      'rolling', (
        select to_jsonb(r)
        from (
          with recent_ev as (
            select e.user_id, e.ts
            from public.mcp_tool_events as e
            where e.env = 'prod'
              and e.auth_type = 'oauth'
              and e.user_id not in (select user_id from excluded)
          )
          select
            (
              select count(distinct user_id)
              from recent_ev
              where ts >= now() - interval '7 days'
            )::int as wau,
            (
              select count(distinct user_id)
              from recent_ev
              where ts >= now() - interval '30 days'
            )::int as mau,
            (select count(distinct user_id) from history_calls)::int
              as cumulative_users,
            (
              select count(*)
              from recent_ev
              where ts >= now() - interval '7 days'
            )::int as calls_7d,
            (
              select count(distinct user_id)
              from recent_ev
              where ts >= now() - interval '1 day'
            )::int as dau
        ) as r
      ),

      -- health_summary keeps its consumer-facing key but is now explicitly a
      -- trailing 30-day raw-event measure so latency percentiles remain exact.
      'health_summary', (
        select to_jsonb(h)
        from (
          select
            count(*)::int as calls,
            count(*) filter (where status <> 'ok')::int as error_calls,
            round(
              100.0 * count(*) filter (where status <> 'ok')::numeric
                / nullif(count(*), 0),
              1
            ) as error_pct,
            percentile_cont(0.5) within group (
              order by latency_ms::float8
            )::int as p50_ms,
            percentile_cont(0.95) within group (
              order by latency_ms::float8
            )::int as p95_ms
          from public.mcp_tool_events
          where env = 'prod'
            and auth_type = 'oauth'
            and ts >= now() - interval '30 days'
            and user_id not in (select user_id from excluded)
        ) as h
      ),

      -- Explicit disclosure for the renamed meaning of the historical health
      -- keys; 7-day keys keep their existing self-describing suffix.
      'health_window_days', 30,

      -- health_summary_7d (042), unchanged and raw.
      'health_summary_7d', (
        select to_jsonb(h7)
        from (
          select
            count(*)::int as calls,
            count(*) filter (where status <> 'ok')::int as error_calls,
            round(
              100.0 * count(*) filter (where status <> 'ok')::numeric
                / nullif(count(*), 0),
              1
            ) as error_pct,
            percentile_cont(0.5) within group (
              order by latency_ms::float8
            )::int as p50_ms,
            percentile_cont(0.95) within group (
              order by latency_ms::float8
            )::int as p95_ms
          from public.mcp_tool_events
          where env = 'prod'
            and auth_type = 'oauth'
            and ts >= now() - interval '7 days'
            and user_id not in (select user_id from excluded)
        ) as h7
      ),

      -- client_mix (037) deliberately keeps the existing UTC daily source and
      -- semantics. It is not part of the ET-history migration.
      'client_mix', (
        select coalesce(jsonb_agg(c order by c.calls desc), '[]'::jsonb)
        from (
          with per_user as (
            select client_name, user_id, sum(call_count) as calls
            from public.mcp_user_daily
            where env = 'prod'
              and auth_type = 'oauth'
              and user_id not in (select user_id from excluded)
            group by client_name, user_id
          )
          select
            coalesce(client_name, '(none)') as ai_client,
            count(*)::int as users,
            sum(calls)::int as calls,
            round(sum(calls)::numeric / nullif(count(*), 0), 1)
              as calls_per_user,
            round(
              percentile_cont(0.5) within group (order by calls)::numeric,
              1
            ) as median_per_user
          from per_user
          group by client_name
        ) as c
      ),

      -- tool_health (037), now the same explicit 30-day raw window as the
      -- historical health_summary key.
      'tool_health', (
        select coalesce(jsonb_agg(th order by th.calls desc), '[]'::jsonb)
        from (
          select
            tool_name,
            count(*)::int as calls,
            count(*) filter (where status <> 'ok')::int as error_calls,
            round(
              100.0 * count(*) filter (where status <> 'ok')::numeric
                / count(*)::numeric,
              1
            ) as error_pct,
            percentile_cont(0.5) within group (
              order by latency_ms::float8
            )::int as p50_ms,
            percentile_cont(0.95) within group (
              order by latency_ms::float8
            )::int as p95_ms
          from public.mcp_tool_events
          where env = 'prod'
            and auth_type = 'oauth'
            and ts >= now() - interval '30 days'
            and user_id not in (select user_id from excluded)
          group by tool_name
        ) as th
      ),

      -- tool_health_7d (042), unchanged and raw.
      'tool_health_7d', (
        select coalesce(jsonb_agg(t7 order by t7.calls desc), '[]'::jsonb)
        from (
          select
            tool_name,
            count(*)::int as calls,
            count(*) filter (where status <> 'ok')::int as error_calls,
            round(
              100.0 * count(*) filter (where status <> 'ok')::numeric
                / count(*)::numeric,
              1
            ) as error_pct,
            percentile_cont(0.5) within group (
              order by latency_ms::float8
            )::int as p50_ms,
            percentile_cont(0.95) within group (
              order by latency_ms::float8
            )::int as p95_ms
          from public.mcp_tool_events
          where env = 'prod'
            and auth_type = 'oauth'
            and ts >= now() - interval '7 days'
            and user_id not in (select user_id from excluded)
          group by tool_name
        ) as t7
      ),

      -- platform_summary (037), unchanged operational source.
      'platform_summary', (
        select coalesce(jsonb_agg(p order by p.users desc), '[]'::jsonb)
        from (
          with conn as (
            select clerk_user_id as uid, 'espn'::text as platform, season_year
            from public.espn_leagues
            union all
            select clerk_user_id, 'yahoo', season_year
            from public.yahoo_leagues
            union all
            select clerk_user_id, 'sleeper', season_year
            from public.sleeper_leagues
          )
          select
            platform,
            count(distinct uid)::int as users,
            count(*) filter (where season_year = 2026)::int as leagues_current,
            count(*)::int as leagues_total
          from conn
          where uid not in (select user_id from excluded)
          group by platform
        ) as p
      ),

      -- platform_overlap (039), unchanged operational source.
      'platform_overlap', (
        select coalesce(jsonb_agg(o order by o.platform_count), '[]'::jsonb)
        from (
          with peruser as (
            select uid, count(*) as platforms
            from (
              select distinct clerk_user_id as uid
              from public.espn_leagues
              where clerk_user_id is not null
              union all
              select distinct clerk_user_id
              from public.yahoo_leagues
              where clerk_user_id is not null
              union all
              select distinct clerk_user_id
              from public.sleeper_leagues
              where clerk_user_id is not null
            ) as x
            where uid not in (select user_id from excluded)
            group by uid
          )
          select platforms::int as platform_count, count(*)::int as users
          from peruser
          group by platforms
        ) as o
      ),

      -- sport_summary (037), unchanged operational source.
      'sport_summary', (
        select coalesce(jsonb_agg(s order by s.users desc), '[]'::jsonb)
        from (
          with conn as (
            select clerk_user_id as uid, sport, season_year
            from public.espn_leagues
            union all
            select clerk_user_id, sport, season_year
            from public.yahoo_leagues
            union all
            select clerk_user_id, sport, season_year
            from public.sleeper_leagues
          )
          select
            coalesce(sport, '(none)') as sport,
            count(distinct uid)::int as users,
            count(*)::int as leagues,
            count(*) filter (where season_year = 2026)::int as leagues_2026,
            count(*) filter (where season_year = 2025)::int as leagues_2025
          from conn
          where uid not in (select user_id from excluded)
          group by sport
        ) as s
      ),

      -- user_concentration (041), preserved from call-count history. Client is
      -- the non-NULL call-weighted mode; equal weights break lexically.
      'user_concentration', (
        select coalesce(jsonb_agg(uc order by uc.rank), '[]'::jsonb)
        from (
          with per_user as (
            select
              h.user_id,
              sum(h.call_count) as calls,
              min(h.et_day) as first_et_day,
              (
                select c.client_name
                from history_calls as c
                where c.user_id = h.user_id
                  and c.client_name is not null
                group by c.client_name
                order by sum(c.call_count) desc, c.client_name
                limit 1
              ) as client
            from history_calls as h
            group by h.user_id
          ),
          ranked as (
            select
              row_number() over (order by calls desc) as rank,
              calls,
              client,
              first_et_day,
              sum(calls) over () as total
            from per_user
          )
          select
            rank::int as rank,
            calls::int as calls,
            round(100.0 * calls::numeric / total, 1) as pct_of_calls,
            round(
              100.0 * sum(calls) over (order by rank) / total,
              1
            ) as cumulative_pct,
            client,
            to_char(first_et_day, 'Mon DD') as first_seen
          from ranked
          order by rank
          limit 15
        ) as uc
      ),

      -- connector_health (046 / FLA-167), unchanged operational source.
      'connector_health', (
        select jsonb_build_object(
          'yahoo', (
            select to_jsonb(y)
            from (
              select
                count(*)::int as users,
                count(*) filter (where expires_at > now())::int as token_fresh,
                count(*) filter (
                  where updated_at >= now() - interval '7 days'
                )::int as rotated_7d,
                count(*) filter (
                  where refresh_lease_owner is not null
                    and refresh_lease_owner not like 'cooldown:%'
                    and refresh_lease_expires_at > now()
                )::int as live_refresh_leases,
                count(app_fingerprint)::int as fingerprint_stamped,
                count(distinct app_fingerprint)::int as fingerprint_variants
              from public.yahoo_credentials
              where clerk_user_id not in (select user_id from excluded)
            ) as y
          ),
          'espn', (
            select to_jsonb(e)
            from (
              select
                count(*)::int as users,
                count(*) filter (
                  where updated_at >= now() - interval '90 days'
                )::int as updated_90d,
                count(*) filter (
                  where updated_at < now() - interval '300 days'
                )::int as aging_300d
              from public.espn_credentials
              where clerk_user_id not in (select user_id from excluded)
            ) as e
          ),
          'sleeper', (
            select to_jsonb(sl)
            from (
              select count(*)::int as users
              from public.sleeper_connections
              where clerk_user_id not in (select user_id from excluded)
            ) as sl
          ),
          'mcp', (
            select to_jsonb(m)
            from (
              with latest as (
                select distinct on (user_id)
                  user_id,
                  revoked_at,
                  refresh_token_expires_at
                from public.oauth_tokens
                where user_id is not null
                  and user_id not in (select user_id from excluded)
                order by user_id, created_at desc
              )
              select
                count(*)::int as users,
                count(*) filter (
                  where revoked_at is null
                    and (
                      refresh_token_expires_at is null
                      or refresh_token_expires_at > now()
                    )
                )::int as active,
                count(*) filter (
                  where revoked_at is not null
                    or refresh_token_expires_at <= now()
                )::int as reconnect_needed
              from latest
            ) as m
          ),
          'sync_7d', (
            select coalesce(jsonb_agg(sy order by sy.provider), '[]'::jsonb)
            from (
              select
                provider,
                count(*)::int as users_attempted,
                count(*) filter (
                  where last_success_at >= now() - interval '7 days'
                )::int as succeeded_7d,
                count(*) filter (
                  where last_failure_at >= now() - interval '7 days'
                )::int as failed_7d,
                coalesce(array_agg(distinct last_error_code) filter (
                  where last_error_code is not null
                    and last_failure_at >= now() - interval '7 days'
                ), '{}') as recent_error_codes
              from public.provider_sync_state
              where clerk_user_id not in (select user_id from excluded)
              group by provider
            ) as sy
          )
        )
      ),

      -- sync_recent (048 / FLA-175), unchanged provider-outcome fallback.
      'sync_recent', (
        select coalesce(jsonb_agg(sr order by sr.provider), '[]'::jsonb)
        from (
          select
            provider,
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
        ) as sr
      ),

      -- FLA-174: keep the existing dynamic internal-account count.
      'internal_user_count', (
        select count(*)::int from analytics.internal_users
      )
    )
  );
end;
$function$;

alter function analytics.dashboard_payload_history(boolean) owner to postgres;

-- This is an owner-only parity surface. analytics_readonly continues to read
-- materialized snapshot rows and gets no direct function or aggregate access.
revoke all privileges on function analytics.dashboard_payload_history(boolean)
from public, anon, authenticated, service_role, analytics_readonly;

grant execute on function analytics.dashboard_payload_history(boolean)
to postgres;
