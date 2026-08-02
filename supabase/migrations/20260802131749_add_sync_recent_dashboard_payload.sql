-- FLA-248: keep the public greenfield contract current with production
-- migration 048. This restates the private analytics payload function to add
-- the sync_recent monitoring key and refreshes the two existing snapshot rows.
-- It creates no tables, grants, policies, indexes, extensions, or cron jobs.
-- Hosted preview and production application remain separate approval gates.

CREATE OR REPLACE FUNCTION analytics.dashboard_payload(include_internal boolean)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = '' AS $$
WITH excluded AS (
  -- Empty when include_internal=true: NOT IN (empty set) then passes every row.
  SELECT user_id FROM analytics.internal_users WHERE NOT include_internal
)
SELECT jsonb_build_object(

  -- usage_trend (038)
  'usage_trend', (SELECT coalesce(jsonb_agg(u ORDER BY u.et_day), '[]'::jsonb) FROM (
    WITH ev AS (
      SELECT DISTINCT user_id AS uid, (ts AT TIME ZONE 'America/New_York')::date AS et_day
      FROM public.mcp_tool_events
      WHERE env='prod' AND auth_type='oauth' AND user_id IS NOT NULL
        AND user_id NOT IN (SELECT user_id FROM excluded)
    ),
    firsts AS (SELECT uid, min(et_day) AS first_day FROM ev GROUP BY uid),
    daily  AS (SELECT et_day, count(DISTINCT uid) AS dau FROM ev GROUP BY et_day),
    newd   AS (SELECT first_day AS et_day, count(*) AS new_users FROM firsts GROUP BY first_day),
    bounds AS (SELECT min(et_day) AS lo, max(et_day) AS hi FROM ev),
    days   AS (SELECT generate_series(lo, hi, '1 day')::date AS et_day FROM bounds WHERE lo IS NOT NULL)
    SELECT d.et_day::text AS et_day,
      coalesce(da.dau,0)::int AS dau,
      (SELECT count(DISTINCT e.uid)::int FROM ev e WHERE e.et_day > d.et_day-7 AND e.et_day <= d.et_day) AS wau_7d,
      coalesce(nw.new_users,0)::int AS new_users,
      (coalesce(da.dau,0) - coalesce(nw.new_users,0))::int AS returning_users
    FROM days d
    LEFT JOIN daily da ON da.et_day = d.et_day
    LEFT JOIN newd  nw ON nw.et_day = d.et_day
  ) u),

  -- retention_weekly (047 / FLA-165) — weekly cohort return rate: of each ISO
  -- week's (ET) distinct queriers, the share active again the following week.
  'retention_weekly', (SELECT coalesce(jsonb_agg(rw ORDER BY rw.week_start), '[]'::jsonb) FROM (
    WITH evd AS (
      SELECT DISTINCT user_id AS uid, (ts AT TIME ZONE 'America/New_York')::date AS et_day
      FROM public.mcp_tool_events
      WHERE env='prod' AND auth_type='oauth' AND user_id IS NOT NULL
        AND user_id NOT IN (SELECT user_id FROM excluded)
    ),
    ev AS (SELECT DISTINCT uid, date_trunc('week', et_day)::date AS wk FROM evd),
    this_wk AS (SELECT date_trunc('week', now() AT TIME ZONE 'America/New_York')::date AS wk),
    bounds AS (SELECT min(et_day) AS first_day, date_trunc('week', min(et_day))::date AS first_wk FROM evd),
    weeks AS (
      SELECT generate_series(first_wk, (SELECT wk FROM this_wk), '7 days')::date AS wk
      FROM bounds WHERE first_wk IS NOT NULL
    ),
    cohorts AS (SELECT wk, count(*) AS queriers FROM ev GROUP BY wk),
    returns AS (
      SELECT e.wk, count(*) AS returned FROM ev e
      WHERE EXISTS (SELECT 1 FROM ev n WHERE n.uid = e.uid AND n.wk = e.wk + 7)
      GROUP BY e.wk
    )
    SELECT w.wk::text AS week_start,
      coalesce(c.queriers,0)::int AS queriers,
      CASE WHEN w.wk >= t.wk THEN NULL ELSE coalesce(r.returned,0)::int END AS returned_next,
      CASE WHEN w.wk >= t.wk THEN NULL
           ELSE round(100.0 * coalesce(r.returned,0) / NULLIF(c.queriers,0), 1) END AS return_pct,
      (w.wk < (SELECT first_day FROM bounds)) AS week_partial_start,
      (w.wk >= t.wk) AS week_open,
      (w.wk < t.wk AND w.wk + 7 >= t.wk) AS next_week_open
    FROM weeks w
    CROSS JOIN this_wk t
    LEFT JOIN cohorts c ON c.wk = w.wk
    LEFT JOIN returns r ON r.wk = w.wk
  ) rw),

  -- usage_totals (037)
  'totals', (SELECT to_jsonb(t) FROM (
    SELECT
      count(DISTINCT user_id) FILTER (WHERE (ts AT TIME ZONE 'America/New_York') >= date_trunc('year', now() AT TIME ZONE 'America/New_York'))::int AS ytd_users,
      count(DISTINCT user_id)::int AS alltime_users,
      count(*) FILTER (WHERE (ts AT TIME ZONE 'America/New_York') >= date_trunc('year', now() AT TIME ZONE 'America/New_York'))::int AS ytd_calls,
      count(*)::int AS alltime_calls
    FROM public.mcp_tool_events
    WHERE env='prod' AND auth_type='oauth' AND user_id IS NOT NULL
      AND user_id NOT IN (SELECT user_id FROM excluded)
  ) t),

  -- funnel_snapshot (037)
  'funnel', (SELECT coalesce(jsonb_agg(f ORDER BY f.sort_order), '[]'::jsonb) FROM (
    WITH oauth AS (SELECT DISTINCT user_id AS uid FROM public.oauth_tokens
      WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT user_id FROM excluded)),
    creds AS (SELECT uid FROM (
        SELECT clerk_user_id AS uid FROM public.espn_credentials WHERE clerk_user_id IS NOT NULL
        UNION SELECT clerk_user_id FROM public.yahoo_credentials WHERE clerk_user_id IS NOT NULL
        UNION SELECT clerk_user_id FROM public.sleeper_connections WHERE clerk_user_id IS NOT NULL
      ) c WHERE uid NOT IN (SELECT user_id FROM excluded)),
    leagues AS (SELECT uid FROM (
        SELECT clerk_user_id AS uid FROM public.espn_leagues WHERE clerk_user_id IS NOT NULL
        UNION SELECT clerk_user_id FROM public.yahoo_leagues WHERE clerk_user_id IS NOT NULL
        UNION SELECT clerk_user_id FROM public.sleeper_leagues WHERE clerk_user_id IS NOT NULL
      ) l WHERE uid NOT IN (SELECT user_id FROM excluded)),
    queried AS (SELECT DISTINCT user_id AS uid FROM public.mcp_tool_events
        WHERE env='prod' AND auth_type='oauth' AND user_id IS NOT NULL AND user_id NOT IN (SELECT user_id FROM excluded)),
    known AS (SELECT uid FROM oauth UNION SELECT uid FROM creds UNION SELECT uid FROM leagues UNION SELECT uid FROM queried)
    SELECT 1 AS sort_order, 'total_known' AS stage, (SELECT count(*) FROM known)::int AS users
    UNION ALL SELECT 2, 'authorized_connector', (SELECT count(*) FROM oauth)::int
    UNION ALL SELECT 3, 'captured_creds', (SELECT count(*) FROM creds)::int
    UNION ALL SELECT 4, 'connected_league', (SELECT count(*) FROM leagues)::int
    UNION ALL SELECT 5, 'queried_ever', (SELECT count(*) FROM queried)::int
    UNION ALL SELECT 6, 'both_connector_and_league', (SELECT count(*) FROM oauth o WHERE EXISTS (SELECT 1 FROM leagues l WHERE l.uid=o.uid))::int
    UNION ALL SELECT 7, 'leak_connector_no_league', (SELECT count(*) FROM oauth o WHERE NOT EXISTS (SELECT 1 FROM leagues l WHERE l.uid=o.uid))::int
    UNION ALL SELECT 8, 'leak_league_no_connector', (SELECT count(*) FROM leagues l WHERE NOT EXISTS (SELECT 1 FROM oauth o WHERE o.uid=l.uid))::int
    UNION ALL SELECT 9, 'leak_creds_no_league', (SELECT count(*) FROM creds c WHERE NOT EXISTS (SELECT 1 FROM leagues l WHERE l.uid=c.uid))::int
  ) f),

  -- usage_rolling (040)
  'rolling', (SELECT to_jsonb(r) FROM (
    WITH ev AS (
      SELECT user_id, ts FROM public.mcp_tool_events
      WHERE env='prod' AND auth_type='oauth'
        AND user_id NOT IN (SELECT user_id FROM excluded)
    )
    SELECT (SELECT count(DISTINCT user_id) FROM ev WHERE ts >= now()-'7 days'::interval)::int  AS wau,
           (SELECT count(DISTINCT user_id) FROM ev WHERE ts >= now()-'30 days'::interval)::int AS mau,
           (SELECT count(DISTINCT user_id) FROM ev)::int                                        AS cumulative_users,
           (SELECT count(*) FROM ev WHERE ts >= now()-'7 days'::interval)::int                  AS calls_7d,
           (SELECT count(DISTINCT user_id) FROM ev WHERE ts >= now()-'1 day'::interval)::int    AS dau
  ) r),

  -- health_summary (040)
  'health_summary', (SELECT to_jsonb(h) FROM (
    SELECT count(*)::int AS calls,
      count(*) FILTER (WHERE status <> 'ok')::int AS error_calls,
      round(100.0 * count(*) FILTER (WHERE status <> 'ok')::numeric / NULLIF(count(*),0), 1) AS error_pct,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms::float8)::int AS p50_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms::float8)::int AS p95_ms
    FROM public.mcp_tool_events
    WHERE env='prod' AND auth_type='oauth'
      AND user_id NOT IN (SELECT user_id FROM excluded)
  ) h),

  -- health_summary_7d (042)
  'health_summary_7d', (SELECT to_jsonb(h7) FROM (
    SELECT count(*)::int AS calls,
      count(*) FILTER (WHERE status <> 'ok')::int AS error_calls,
      round(100.0 * count(*) FILTER (WHERE status <> 'ok')::numeric / NULLIF(count(*),0), 1) AS error_pct,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms::float8)::int AS p50_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms::float8)::int AS p95_ms
    FROM public.mcp_tool_events
    WHERE env='prod' AND auth_type='oauth'
      AND ts >= now() - interval '7 days'
      AND user_id NOT IN (SELECT user_id FROM excluded)
  ) h7),

  -- client_mix (037)
  'client_mix', (SELECT coalesce(jsonb_agg(c ORDER BY c.calls DESC), '[]'::jsonb) FROM (
    WITH per_user AS (
      SELECT client_name, user_id, sum(call_count) AS calls
      FROM public.mcp_user_daily
      WHERE env='prod' AND auth_type='oauth'
        AND user_id NOT IN (SELECT user_id FROM excluded)
      GROUP BY client_name, user_id
    )
    SELECT COALESCE(client_name,'(none)') AS ai_client,
      count(*)::int AS users,
      sum(calls)::int AS calls,
      round(sum(calls)::numeric / NULLIF(count(*),0), 1) AS calls_per_user,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY calls)::numeric, 1) AS median_per_user
    FROM per_user GROUP BY client_name
  ) c),

  -- tool_health (037)
  'tool_health', (SELECT coalesce(jsonb_agg(th ORDER BY th.calls DESC), '[]'::jsonb) FROM (
    SELECT tool_name, count(*)::int AS calls,
      count(*) FILTER (WHERE status <> 'ok')::int AS error_calls,
      round(100.0 * count(*) FILTER (WHERE status <> 'ok')::numeric / count(*)::numeric, 1) AS error_pct,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms::float8)::int AS p50_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms::float8)::int AS p95_ms
    FROM public.mcp_tool_events
    WHERE env='prod' AND auth_type='oauth'
      AND user_id NOT IN (SELECT user_id FROM excluded)
    GROUP BY tool_name
  ) th),

  -- tool_health_7d (042)
  'tool_health_7d', (SELECT coalesce(jsonb_agg(t7 ORDER BY t7.calls DESC), '[]'::jsonb) FROM (
    SELECT tool_name, count(*)::int AS calls,
      count(*) FILTER (WHERE status <> 'ok')::int AS error_calls,
      round(100.0 * count(*) FILTER (WHERE status <> 'ok')::numeric / count(*)::numeric, 1) AS error_pct,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms::float8)::int AS p50_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms::float8)::int AS p95_ms
    FROM public.mcp_tool_events
    WHERE env='prod' AND auth_type='oauth'
      AND ts >= now() - interval '7 days'
      AND user_id NOT IN (SELECT user_id FROM excluded)
    GROUP BY tool_name
  ) t7),

  -- platform_summary (037)
  'platform_summary', (SELECT coalesce(jsonb_agg(p ORDER BY p.users DESC), '[]'::jsonb) FROM (
    WITH conn AS (
      SELECT clerk_user_id AS uid, 'espn'::text AS platform, season_year FROM public.espn_leagues
      UNION ALL SELECT clerk_user_id, 'yahoo', season_year FROM public.yahoo_leagues
      UNION ALL SELECT clerk_user_id, 'sleeper', season_year FROM public.sleeper_leagues
    )
    SELECT platform,
      count(DISTINCT uid)::int AS users,
      count(*) FILTER (WHERE season_year = 2026)::int AS leagues_current,
      count(*)::int AS leagues_total
    FROM conn WHERE uid NOT IN (SELECT user_id FROM excluded)
    GROUP BY platform
  ) p),

  -- platform_overlap (039)
  'platform_overlap', (SELECT coalesce(jsonb_agg(o ORDER BY o.platform_count), '[]'::jsonb) FROM (
    WITH peruser AS (
      SELECT uid, count(*) AS platforms FROM (
        SELECT DISTINCT clerk_user_id AS uid FROM public.espn_leagues    WHERE clerk_user_id IS NOT NULL
        UNION ALL SELECT DISTINCT clerk_user_id FROM public.yahoo_leagues   WHERE clerk_user_id IS NOT NULL
        UNION ALL SELECT DISTINCT clerk_user_id FROM public.sleeper_leagues WHERE clerk_user_id IS NOT NULL
      ) x WHERE uid NOT IN (SELECT user_id FROM excluded)
      GROUP BY uid
    )
    SELECT platforms::int AS platform_count, count(*)::int AS users
    FROM peruser GROUP BY platforms
  ) o),

  -- sport_summary (037)
  'sport_summary', (SELECT coalesce(jsonb_agg(s ORDER BY s.users DESC), '[]'::jsonb) FROM (
    WITH conn AS (
      SELECT clerk_user_id AS uid, sport, season_year FROM public.espn_leagues
      UNION ALL SELECT clerk_user_id, sport, season_year FROM public.yahoo_leagues
      UNION ALL SELECT clerk_user_id, sport, season_year FROM public.sleeper_leagues
    )
    SELECT COALESCE(sport,'(none)') AS sport,
      count(DISTINCT uid)::int AS users,
      count(*)::int AS leagues,
      count(*) FILTER (WHERE season_year=2026)::int AS leagues_2026,
      count(*) FILTER (WHERE season_year=2025)::int AS leagues_2025
    FROM conn WHERE uid NOT IN (SELECT user_id FROM excluded)
    GROUP BY sport
  ) s),

  -- user_concentration (041)
  'user_concentration', (SELECT coalesce(jsonb_agg(uc ORDER BY uc.rank), '[]'::jsonb) FROM (
    WITH per_user AS (
      SELECT user_id,
             count(*) AS calls,
             mode() WITHIN GROUP (ORDER BY client_name) AS client,
             min(ts) AS first_ts
      FROM public.mcp_tool_events
      WHERE env = 'prod' AND auth_type = 'oauth'
        AND user_id NOT IN (SELECT user_id FROM excluded)
      GROUP BY user_id
    ), ranked AS (
      SELECT row_number() OVER (ORDER BY calls DESC) AS rank,
             calls, client, first_ts,
             sum(calls) OVER () AS total
      FROM per_user
    )
    SELECT rank::int AS rank,
           calls::int AS calls,
           round(100.0 * calls::numeric / total, 1) AS pct_of_calls,
           round(100.0 * sum(calls) OVER (ORDER BY rank) / total, 1) AS cumulative_pct,
           client,
           to_char(first_ts AT TIME ZONE 'America/New_York', 'Mon DD') AS first_seen
    FROM ranked ORDER BY rank LIMIT 15
  ) uc),

  -- connector_health (046 / FLA-167) — aggregate auth/token freshness per
  -- platform; reads the FLA-121 sync envelope and FLA-133 fingerprints.
  'connector_health', (SELECT jsonb_build_object(
    'yahoo', (SELECT to_jsonb(y) FROM (
      SELECT count(*)::int AS users,
        count(*) FILTER (WHERE expires_at > now())::int AS token_fresh,
        count(*) FILTER (WHERE updated_at >= now() - interval '7 days')::int AS rotated_7d,
        count(*) FILTER (WHERE refresh_lease_owner IS NOT NULL
          AND refresh_lease_owner NOT LIKE 'cooldown:%'
          AND refresh_lease_expires_at > now())::int AS live_refresh_leases,
        count(app_fingerprint)::int AS fingerprint_stamped,
        count(DISTINCT app_fingerprint)::int AS fingerprint_variants
      FROM public.yahoo_credentials
      WHERE clerk_user_id NOT IN (SELECT user_id FROM excluded)
    ) y),
    'espn', (SELECT to_jsonb(e) FROM (
      SELECT count(*)::int AS users,
        count(*) FILTER (WHERE updated_at >= now() - interval '90 days')::int AS updated_90d,
        count(*) FILTER (WHERE updated_at < now() - interval '300 days')::int AS aging_300d
      FROM public.espn_credentials
      WHERE clerk_user_id NOT IN (SELECT user_id FROM excluded)
    ) e),
    'sleeper', (SELECT to_jsonb(sl) FROM (
      SELECT count(*)::int AS users
      FROM public.sleeper_connections
      WHERE clerk_user_id NOT IN (SELECT user_id FROM excluded)
    ) sl),
    'mcp', (SELECT to_jsonb(m) FROM (
      WITH latest AS (
        SELECT DISTINCT ON (user_id) user_id, revoked_at, refresh_token_expires_at
        FROM public.oauth_tokens
        WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT user_id FROM excluded)
        ORDER BY user_id, created_at DESC
      )
      SELECT count(*)::int AS users,
        count(*) FILTER (WHERE revoked_at IS NULL
          AND (refresh_token_expires_at IS NULL OR refresh_token_expires_at > now()))::int AS active,
        count(*) FILTER (WHERE revoked_at IS NOT NULL
          OR refresh_token_expires_at <= now())::int AS reconnect_needed
      FROM latest
    ) m),
    'sync_7d', (SELECT coalesce(jsonb_agg(sy ORDER BY sy.provider), '[]'::jsonb) FROM (
      SELECT provider,
        count(*)::int AS users_attempted,
        count(*) FILTER (WHERE last_success_at >= now() - interval '7 days')::int AS succeeded_7d,
        count(*) FILTER (WHERE last_failure_at >= now() - interval '7 days')::int AS failed_7d,
        coalesce(array_agg(DISTINCT last_error_code) FILTER (
          WHERE last_error_code IS NOT NULL AND last_failure_at >= now() - interval '7 days'
        ), '{}') AS recent_error_codes
      FROM public.provider_sync_state
      WHERE clerk_user_id NOT IN (SELECT user_id FROM excluded)
      GROUP BY provider
    ) sy)
  )),

  -- sync_recent (048 / FLA-175) — fresh sync outcomes per provider over the
  -- trailing 6 hours.
  'sync_recent', (SELECT coalesce(jsonb_agg(sr ORDER BY sr.provider), '[]'::jsonb) FROM (
    SELECT provider,
      count(DISTINCT clerk_user_id) FILTER (WHERE last_failure_at > now() - interval '6 hours')::int AS users_failed_6h,
      count(DISTINCT clerk_user_id) FILTER (WHERE last_success_at > now() - interval '6 hours')::int AS users_succeeded_6h,
      coalesce(array_agg(DISTINCT last_error_code) FILTER (
        WHERE last_error_code IS NOT NULL AND last_failure_at > now() - interval '6 hours'
      ), '{}') AS recent_error_codes
    FROM public.provider_sync_state
    WHERE clerk_user_id NOT IN (SELECT user_id FROM excluded)
    GROUP BY provider
  ) sr),

  -- (FLA-174): so the UI never hardcodes the internal-account count.
  'internal_user_count', (SELECT count(*)::int FROM analytics.internal_users)
)
$$;

-- Refresh both snapshot rows immediately so the new key is live without
-- waiting for the next pg_cron tick.
SELECT analytics.refresh_dashboard_snapshot();
