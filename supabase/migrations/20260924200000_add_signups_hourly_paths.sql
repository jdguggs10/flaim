-- FLA-413: hourly signup counts by acquisition path, for an internal hourly
-- acquisition monitor.
--
-- The FLA-396 views answer daily questions. A collapse or surge in the
-- connector-install signup path is visible within a few hours but invisible in
-- a daily series until the day is over, so this migration adds one more
-- aggregate view over public.signup_log at hour grain. It creates no table,
-- function, index, grant beyond the view's own, or cron job, and it changes
-- nothing the existing views return.
--
-- PRIVACY SHAPE
--
-- Hourly buckets are finer-grained than the existing daily analytics views,
-- but they remain identifier-free aggregates: every column is a count or the
-- bucket's hour. The view exposes no clerk_user_id, no raw first_touch jsonb,
-- and no landing_path column. first_touch ->> 'landingPath' is read only
-- inside a predicate, exactly as analytics.signup_sources_daily treats it, and
-- referrer hosts are collapsed into a fixed set of counted categories rather
-- than exposed as a free-text dimension. The boundary is the same as for the
-- FLA-396 views: the view is owned by postgres (so it bypasses the table's
-- RLS by design), its ACL below is explicit, and `analytics` is not exposed on
-- the Data API.
--
-- SHAPE AND CLOCK
--
--   * Zero-filled: one row per America/New_York wall-clock hour for the
--     trailing 21 days plus the open current hour, i.e. exactly 21 * 24 + 1 =
--     505 rows. An hour with no signups is a real row of zeros, never a
--     missing key, so a reader can tell "nothing happened" from "no data".
--   * hour_et is a local `timestamp` (no time zone), so "the same hour d days
--     earlier" is plain wall-clock subtraction for a reader. At the autumn DST
--     fall-back the local 01:00 bucket holds two real hours; at the spring
--     change the local 02:00 bucket is always empty. Both sit inside
--     01:00-03:00 ET.
--   * The clock is one now() reading, shared by the hour series and the scan
--     bound, so the series and the buckets cannot disagree.
--   * The scan is bounded to the trailing 22 days of created_at, a full day of
--     margin over the 21-day series in absolute time. Like the other signup
--     views it has no index to use and scans the table.
--
-- COLUMNS
--
--   total        every live signup in the hour, attributed or not.
--   card_flow    attributed signups with no referrer host (NULL or empty) whose
--                first landing was the OAuth consent page: the connector
--                install flow, which arrives without a referrer.
--   ref_chatgpt  referrer host chatgpt.com or chat.openai.com.
--   ref_google   referrer host google.<tld>, including subdomains.
--   ref_claude   referrer host claude.ai.
--   noref_site   attributed signups with no referrer host that did NOT land on
--                the consent page (direct visits to the site).
--
-- Referrer hosts are lower-cased in SQL, matching signup_sources_daily. The
-- categories are not exhaustive: an attributed signup from any other referrer
-- counts only toward total.
--
-- Deleted accounts are excluded with the same anti-join the FLA-396 views use
-- (left join public.account_deletions ... where d.clerk_user_id is null), so a
-- deletion removes that signup from every column here, as it does from
-- signups_daily.signups and signup_rollups.

create view analytics.signups_hourly_paths as
with clock as (
  select
    now() as now_at,
    date_trunc('hour', now() at time zone 'America/New_York') as current_hour_et
),
hours as (
  select gs.hour_et
  from clock c
  cross join lateral generate_series(
    c.current_hour_et - interval '21 days',
    c.current_hour_et,
    interval '1 hour'
  ) as gs(hour_et)
),
live_signups as (
  select
    date_trunc('hour', s.created_at at time zone 'America/New_York') as hour_et,
    s.first_touch is not null as attributed,
    nullif(lower(s.first_touch ->> 'referrerHost'), '') as referrer_host,
    coalesce(s.first_touch ->> 'landingPath', '') like '/oauth/consent%' as consent_landing
  from public.signup_log s
  cross join clock c
  left join public.account_deletions d on d.clerk_user_id = s.clerk_user_id
  where d.clerk_user_id is null
    and s.created_at >= c.now_at - interval '22 days'
),
buckets as (
  select
    l.hour_et,
    count(*) as total,
    count(*) filter (
      where l.attributed and l.referrer_host is null and l.consent_landing
    ) as card_flow,
    count(*) filter (
      where l.referrer_host in ('chatgpt.com', 'chat.openai.com')
    ) as ref_chatgpt,
    count(*) filter (
      where l.referrer_host ~ '(^|\.)google\.[a-z.]+$'
    ) as ref_google,
    count(*) filter (
      where l.referrer_host = 'claude.ai'
    ) as ref_claude,
    count(*) filter (
      where l.attributed and l.referrer_host is null and not l.consent_landing
    ) as noref_site
  from live_signups l
  group by l.hour_et
)
select
  h.hour_et,
  coalesce(b.total, 0) as total,
  coalesce(b.card_flow, 0) as card_flow,
  coalesce(b.ref_chatgpt, 0) as ref_chatgpt,
  coalesce(b.ref_google, 0) as ref_google,
  coalesce(b.ref_claude, 0) as ref_claude,
  coalesce(b.noref_site, 0) as noref_site
from hours h
left join buckets b on b.hour_et = h.hour_et;

alter view analytics.signups_hourly_paths owner to postgres;

-- The revoke is not redundant: `alter default privileges for role postgres in
-- schema analytics grant select on tables to analytics_readonly`
-- (20260727230606_baseline.sql:2137-2138) would otherwise decide this ACL
-- implicitly. State it instead, matching the FLA-396 signup views.
revoke all privileges on table analytics.signups_hourly_paths
from public, anon, authenticated, service_role, analytics_readonly;

grant select on table analytics.signups_hourly_paths to analytics_readonly;
