-- FLA-396: permanent signup log written from the Clerk user.created webhook.
--
-- The internal dashboard's signup figures are read live from Clerk on every
-- page load. That source is slow, fails visibly, has no export or analytics
-- API, and is survivorship-biased: a deleted account silently rewrites a past
-- week, because the history is reconstructed from the users who still exist.
-- This migration replaces it with a permanent log the webhook writes once per
-- account, plus three aggregate views the internal dashboard reads.
--
-- WHAT THE PRIVILEGE BOUNDARY ACTUALLY IS
--
--   * The GRANTS are the real boundary. Both baseline default-privilege traps
--     apply here (20260727230606_baseline.sql:2124 grants service_role ALL on
--     every new public table; :2128-2131 grants anon/authenticated/service_role
--     EXECUTE on every new public function), and GRANT is additive, so each
--     object below is explicitly revoked from public, anon, authenticated AND
--     service_role before anything is granted back. Without the function
--     revoke, POST /rest/v1/rpc/record_signup with the publishable key reaches
--     the function.
--   * RLS is the second layer, and it does NOT bind service_role. RLS is
--     enabled on public.signup_log with no policies, which blocks anon and
--     authenticated outright; service_role carries BYPASSRLS and is stopped
--     only by the column-scoped grants below. Do not read RLS here as
--     protection it does not provide.
--   * The three analytics views are owned by postgres, and a postgres-owned
--     view bypasses the underlying table's RLS by design -- that is how
--     analytics.funnel_snapshot reads public tables today. The views' boundary
--     is therefore the explicit view ACL below plus the fact that `analytics`
--     is not exposed on the Data API (supabase/config.toml), not RLS.
--
-- No per-user relation is exposed to analytics_readonly. That role can read no
-- user identifier today, and a per-user signup view would turn a leaked read
-- credential from "aggregate usage numbers" into a pseudonymous per-user
-- acquisition export. All three views are aggregates; none exposes
-- clerk_user_id, raw first_touch jsonb, or landing_path.
--
-- Deletion is derived, never stored. public.signup_log is deliberately NOT
-- added to purge_account_data's delete list -- a deleted user's signup is
-- still a signup that happened -- and the anti-resurrection guard trigger from
-- 20260829120000 is deliberately NOT attached: a user.created retry landing
-- after a purge would raise P0001, return 500, and burn all eight Svix
-- attempts on an event that is correct to record. The ordering race is solved
-- by the same advisory lock instead, in record_signup below.

-- ---------------------------------------------------------------------------
-- 1. The log
--
-- Exactly four columns. No email, here or in any view over this table. No
-- index on created_at: the table holds roughly one row per account ever
-- created, all three views scan it whole and aggregate, and an index at this
-- size buys a plan change nobody will measure.
-- ---------------------------------------------------------------------------
create table public.signup_log (
  clerk_user_id text primary key,
  created_at timestamptz not null,
  first_touch jsonb,
  source text not null,
  constraint signup_log_source_valid check (source in ('webhook', 'backfill'))
);

comment on table public.signup_log is
  'Permanent one-row-per-Clerk-account signup log, written by public.record_signup from the verified Clerk user.created/user.updated webhook. created_at is Clerk''s own signup instant, never the observation time. Rows for deleted accounts are retained (the signup still happened) with first_touch redacted to NULL by public.purge_account_data.';

comment on column public.signup_log.first_touch is
  'Validated, bounded first-touch acquisition object captured once at write time, never the raw client-supplied metadata. Fill-if-null: a later webhook can supply attribution a first one lacked, but nothing replaces attribution already captured. Set to NULL permanently by public.purge_account_data.';

comment on column public.signup_log.source is
  'Which writer first recorded this signup: ''webhook'' (live Clerk delivery) or ''backfill'' (one-time historical import). Never overwritten after the first write.';

alter table public.signup_log enable row level security;

revoke all privileges on table public.signup_log
from public, anon, authenticated, service_role;

-- record_signup and purge_account_data are both `security invoker`, so they
-- execute with service_role's real privileges, not the owner's. The upsert's
-- conflict expression reads signup_log.first_touch and the purge's redaction
-- reads clerk_user_id in its WHERE clause, so SELECT is required on exactly
-- those two columns -- a missing SELECT would make every webhook replay raise
-- 42501, and, far worse, would abort the entire purge transaction that deletes
-- credentials. Column-scoped SELECT is enough, so `select *` by service_role
-- still fails. UPDATE is scoped to first_touch: created_at and source are
-- never rewritten by anyone.
grant insert on table public.signup_log to service_role;
grant update (first_touch) on table public.signup_log to service_role;
grant select (clerk_user_id, first_touch) on table public.signup_log to service_role;

-- ---------------------------------------------------------------------------
-- 2. The write RPC
--
-- This function is a CONTRACT and a place to put the conflict logic. It is
-- NOT a privilege boundary: it is `security invoker`, exactly like
-- public.purge_account_data, so it runs with the caller's own privileges and
-- the table grants above are what actually constrain it. Saying so plainly
-- here prevents a later reader mistaking it for isolation it does not provide.
--
-- Conflict rules:
--   * created_at and source are NEVER overwritten. The first observation of a
--     signup instant is the signup instant, and a live webhook write outranks
--     a later backfill write for the same user.
--   * first_touch is fill-if-null. A later user.updated can supply attribution
--     the user.created payload lacked; nothing can replace attribution already
--     captured. This is why a plain `on conflict do nothing` cannot serve.
--   * When a tombstone exists, first_touch is written as NULL on both the
--     insert and the conflict path, and nothing is raised. The signup fact is
--     still recorded so counts stay right; the attribution is simply never
--     written, and no Svix attempt is burned.
--
-- The advisory lock is the same per-user key public.purge_account_data takes,
-- through the same shared helper, which is what makes "record this signup" and
-- "erase this account's attribution" mutually exclusive rather than racing.
-- ---------------------------------------------------------------------------
create function public.record_signup(
  p_clerk_user_id text,
  p_created_at timestamptz,
  p_first_touch jsonb,
  p_source text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account_deleted boolean;
begin
  if p_clerk_user_id is null or btrim(p_clerk_user_id) = '' then
    raise exception 'record_signup requires a non-empty clerk_user_id';
  end if;

  if p_created_at is null then
    raise exception 'record_signup requires a non-null created_at';
  end if;

  if p_source is null or p_source not in ('webhook', 'backfill') then
    raise exception 'record_signup requires source to be webhook or backfill';
  end if;

  perform pg_advisory_xact_lock(public.account_deletion_lock_key(p_clerk_user_id));

  select exists (
    select 1
    from public.account_deletions
    where clerk_user_id = p_clerk_user_id
  ) into v_account_deleted;

  insert into public.signup_log (clerk_user_id, created_at, first_touch, source)
  values (
    p_clerk_user_id,
    p_created_at,
    case when v_account_deleted then null else p_first_touch end,
    p_source
  )
  on conflict (clerk_user_id) do update
  set first_touch = case
        when v_account_deleted then null
        else coalesce(signup_log.first_touch, excluded.first_touch)
      end;
end;
$$;

revoke all privileges on function public.record_signup(text, timestamptz, jsonb, text)
from public, anon, authenticated, service_role;
grant execute on function public.record_signup(text, timestamptz, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Aggregate views for the internal dashboard
--
-- Naming follows the existing analytics convention, which uses no suffix
-- (usage_daily, funnel_snapshot, funnel_daily). The ET-day idiom is the house
-- one: (ts at time zone 'America/New_York')::date.
-- ---------------------------------------------------------------------------

-- One row per Eastern calendar day. `signups` excludes deleted accounts, which
-- is what the weekly series shows today; `signups_including_deleted` sits
-- beside it so "signups ever" is one predicate away whenever it is worth
-- asking for, instead of being unrecoverable.
create view analytics.signups_daily as
select
  (s.created_at at time zone 'America/New_York')::date as et_day,
  count(*) filter (where d.clerk_user_id is null) as signups,
  count(*) as signups_including_deleted
from public.signup_log s
left join public.account_deletions d on d.clerk_user_id = s.clerk_user_id
group by (s.created_at at time zone 'America/New_York')::date;

-- A single row of the seven window counts plus the live total. A daily grain
-- cannot reproduce these: today/yesterday/yesterday_prev are ET calendar days,
-- d7/d7_prev/d30 are rolling offsets from one clock reading, and ytd runs from
-- Jan 1 ET. Computing all eight from ONE now() preserves the
-- single-reading-of-now property the TypeScript reader documents today, and
-- preserves it more strongly, because the reading is now the database's.
-- `now_at` is exposed so a reader can sample that clock with the data rather
-- than taking a second, disagreeing reading of its own.
--
-- d7_prev is half-open, [now - 14 days, now - 7 days), so it cannot overlap d7
-- at the boundary instant.
--
-- Deleted accounts are excluded from every figure, matching the total the
-- dashboard shows today (Clerk simply stops returning them).
create view analytics.signup_rollups as
with clock as (
  select now() as now_at
),
bounds as (
  select
    c.now_at,
    (c.now_at at time zone 'America/New_York')::date as et_today,
    (c.now_at at time zone 'America/New_York')::date - 1 as et_yesterday,
    (c.now_at at time zone 'America/New_York')::date - 2 as et_yesterday_prev,
    date_trunc('year', c.now_at at time zone 'America/New_York')::date as et_year_start
  from clock c
),
live_signups as (
  select
    s.created_at,
    (s.created_at at time zone 'America/New_York')::date as et_day
  from public.signup_log s
  left join public.account_deletions d on d.clerk_user_id = s.clerk_user_id
  where d.clerk_user_id is null
)
select
  b.now_at,
  (select count(*) from live_signups) as total,
  (select count(*) from live_signups l where l.et_day = b.et_today) as today,
  (select count(*) from live_signups l where l.et_day = b.et_yesterday) as yesterday,
  (select count(*) from live_signups l where l.et_day = b.et_yesterday_prev) as yesterday_prev,
  (
    select count(*) from live_signups l
    where l.created_at >= b.now_at - interval '7 days'
  ) as d7,
  (
    select count(*) from live_signups l
    where l.created_at >= b.now_at - interval '14 days'
      and l.created_at < b.now_at - interval '7 days'
  ) as d7_prev,
  (
    select count(*) from live_signups l
    where l.created_at >= b.now_at - interval '30 days'
  ) as d30,
  (select count(*) from live_signups l where l.et_day >= b.et_year_start) as ytd
from bounds b;

-- One row per ET day and bounded first-touch dimension. The dimensions are
-- exactly what the dashboard's acquisition summariser groups on and nothing
-- else. Case folding happens here, in SQL, matching the summariser's own
-- lower-casing. landing_path is a validity precondition, not a grouping input,
-- and is deliberately not exposed; neither is clerk_user_id or the raw jsonb.
-- Only attributed, non-deleted rows appear: after a purge the attribution is
-- physically NULL, so deleted accounts leave this view the same way they leave
-- the dashboard's mix today.
create view analytics.signup_sources_daily as
select
  (s.created_at at time zone 'America/New_York')::date as et_day,
  lower(s.first_touch ->> 'utmSource') as utm_source,
  lower(s.first_touch ->> 'ref') as ref,
  lower(s.first_touch ->> 'referrerHost') as referrer_host,
  (
    coalesce(s.first_touch ->> 'utmMedium', '') <> ''
    or coalesce(s.first_touch ->> 'utmCampaign', '') <> ''
    or coalesce(s.first_touch ->> 'utmTerm', '') <> ''
    or coalesce(s.first_touch ->> 'utmContent', '') <> ''
  ) as has_campaign_fields,
  count(*) as signups
from public.signup_log s
left join public.account_deletions d on d.clerk_user_id = s.clerk_user_id
where s.first_touch is not null
  and d.clerk_user_id is null
group by
  (s.created_at at time zone 'America/New_York')::date,
  lower(s.first_touch ->> 'utmSource'),
  lower(s.first_touch ->> 'ref'),
  lower(s.first_touch ->> 'referrerHost'),
  (
    coalesce(s.first_touch ->> 'utmMedium', '') <> ''
    or coalesce(s.first_touch ->> 'utmCampaign', '') <> ''
    or coalesce(s.first_touch ->> 'utmTerm', '') <> ''
    or coalesce(s.first_touch ->> 'utmContent', '') <> ''
  );

alter view analytics.signups_daily owner to postgres;
alter view analytics.signup_rollups owner to postgres;
alter view analytics.signup_sources_daily owner to postgres;

-- The revoke is not redundant: `alter default privileges for role postgres in
-- schema analytics grant select on tables to analytics_readonly`
-- (20260727230606_baseline.sql:2137-2138) would otherwise decide these ACLs
-- implicitly. State them instead, matching analytics.funnel_daily.
revoke all privileges on table
  analytics.signups_daily,
  analytics.signup_rollups,
  analytics.signup_sources_daily
from public, anon, authenticated, service_role, analytics_readonly;

grant select on table
  analytics.signups_daily,
  analytics.signup_rollups,
  analytics.signup_sources_daily
to analytics_readonly;

-- ---------------------------------------------------------------------------
-- 4. Physical redaction inside the existing purge
--
-- The published privacy commitment says the first-touch record "is retained
-- with the Clerk account until the account is deleted". Today that is true by
-- construction, because the record lives in Clerk metadata and dies with the
-- Clerk user. Copying it here turns a free property into a promise we have to
-- keep, and read-side masking alone does not keep it: hiding a deleted user's
-- attribution in the views is visibility, not retention, and the bytes would
-- still be readable by the owner and by anything holding the service key.
--
-- public.purge_account_data already runs exactly once per verified deletion,
-- already holds the per-user advisory lock, and already describes itself as
-- the only place data is permanently removed. One statement there honours the
-- sentence with no new schedule, no new endpoint, and no webhook change. It is
-- an UPDATE, not a DELETE, which is why signup_log still does not belong on
-- the delete list: the row survives, only the attribution goes.
--
-- CREATE OR REPLACE of a live function. On 2026-09-15 the hosted production
-- definition of public.purge_account_data(text) was byte-identical to
-- 20260829120000_add_account_deletions.sql: pg_get_functiondef md5
-- 7ac8659da4f5e701067d43d4606e1ab8 on production, and the same
-- 7ac8659da4f5e701067d43d4606e1ab8 on a clean local `supabase db reset` of the
-- migration ledger without this file. Nothing landed out-of-band that this
-- replace would clobber. Everything else below -- the argument guard, the
-- lock_timeout, the advisory lock, the tombstone insert, the 13-table delete
-- list, and every comment -- is reproduced verbatim from that migration.
-- ---------------------------------------------------------------------------
create or replace function public.purge_account_data(p_clerk_user_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_clerk_user_id is null or btrim(p_clerk_user_id) = '' then
    raise exception 'purge_account_data requires a non-empty clerk_user_id';
  end if;

  set local lock_timeout = '5s';

  perform pg_advisory_xact_lock(public.account_deletion_lock_key(p_clerk_user_id));

  insert into public.account_deletions (clerk_user_id)
  values (p_clerk_user_id)
  on conflict (clerk_user_id) do nothing;

  -- FLA-396: physical redaction, inside the lock, after the tombstone lands so
  -- a concurrent record_signup that runs next already sees the tombstone and
  -- writes NULL attribution itself. public.signup_log is deliberately NOT on
  -- the delete list below: the signup fact is retained permanently and only
  -- its attribution is erased, which is what the published retention promise
  -- requires. This statement reads clerk_user_id, so service_role's
  -- column-scoped SELECT grant is load-bearing for the whole purge.
  update public.signup_log
  set first_touch = null
  where clerk_user_id = p_clerk_user_id;

  -- Every in-scope table. clerk_user_id-keyed tables first, then the two
  -- user_id-keyed MCP OAuth tables. oauth_states is intentionally excluded:
  -- it has no user column (state, redirect_uri, client_id only) and its rows
  -- already expire on their own via public.cleanup_expired_oauth_states(),
  -- regardless of account deletion.
  delete from public.espn_credentials where clerk_user_id = p_clerk_user_id;
  delete from public.espn_leagues where clerk_user_id = p_clerk_user_id;
  delete from public.espn_history_jobs where clerk_user_id = p_clerk_user_id;
  delete from public.yahoo_credentials where clerk_user_id = p_clerk_user_id;
  delete from public.yahoo_leagues where clerk_user_id = p_clerk_user_id;
  delete from public.platform_oauth_states where clerk_user_id = p_clerk_user_id;
  delete from public.sleeper_connections where clerk_user_id = p_clerk_user_id;
  delete from public.sleeper_leagues where clerk_user_id = p_clerk_user_id;
  delete from public.archived_leagues where clerk_user_id = p_clerk_user_id;
  delete from public.provider_sync_state where clerk_user_id = p_clerk_user_id;
  delete from public.user_preferences where clerk_user_id = p_clerk_user_id;
  delete from public.oauth_tokens where user_id = p_clerk_user_id;
  delete from public.oauth_codes where user_id = p_clerk_user_id;
end;
$$;
