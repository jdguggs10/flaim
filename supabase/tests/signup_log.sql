-- Rollback-only contract proof for the FLA-396 signup log.
--
-- Every grant here is proved BY EXECUTION, not by reading an ACL listing. An
-- ACL tells you what a GRANT statement said; running the real statement as the
-- real role tells you whether Postgres agrees. The catalog assertions below
-- exist only to catch the shapes execution cannot reach (RLS flags, security
-- invoker, empty search_path).
begin;

-- ---------------------------------------------------------------------------
-- 1. Browser roles reach nothing.
-- ---------------------------------------------------------------------------
set local role anon;
do $anon_denials$
begin
  begin
    perform public.record_signup('denied', now(), null, 'webhook');
    raise exception 'anon record_signup unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform clerk_user_id from public.signup_log limit 1;
    raise exception 'anon select on signup_log unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.signup_log (clerk_user_id, created_at, source)
    values ('denied', now(), 'webhook');
    raise exception 'anon insert on signup_log unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.signup_log set first_touch = null where false;
    raise exception 'anon update on signup_log unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $anon_denials$;

reset role;
set local role authenticated;
do $authenticated_denials$
begin
  begin
    perform public.record_signup('denied', now(), null, 'webhook');
    raise exception 'authenticated record_signup unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform clerk_user_id from public.signup_log limit 1;
    raise exception 'authenticated select on signup_log unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.signup_log (clerk_user_id, created_at, source)
    values ('denied', now(), 'webhook');
    raise exception 'authenticated insert on signup_log unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.signup_log set first_touch = null where false;
    raise exception 'authenticated update on signup_log unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $authenticated_denials$;

reset role;

-- ---------------------------------------------------------------------------
-- 2. Catalog shape the execution proofs cannot reach.
-- ---------------------------------------------------------------------------
do $catalog_proof$
declare
  v_count integer;
begin
  if not (
    select relrowsecurity
    from pg_class
    where oid = 'public.signup_log'::regclass
  ) then
    raise exception 'RLS disabled on signup_log';
  end if;

  -- RLS with no policies is the second layer only. It blocks anon and
  -- authenticated; it does NOT block service_role, which carries BYPASSRLS.
  -- The column grants are what constrain service_role, and they are proved by
  -- execution below.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'signup_log'
  ) then
    raise exception 'signup_log unexpectedly carries a policy';
  end if;

  -- The anti-resurrection guard trigger is deliberately NOT attached: a
  -- user.created retry arriving after a purge must record the signup, not
  -- raise P0001 and burn eight Svix attempts.
  if exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    where c.relname = 'signup_log'
      and t.tgname = 'reject_write_after_account_deletion'
  ) then
    raise exception 'signup_log must not carry the account-deletion guard trigger';
  end if;

  -- No index on created_at, by decision.
  if (
    select count(*) from pg_index x
    join pg_class t on t.oid = x.indrelid
    where t.relname = 'signup_log'
  ) <> 1 then
    raise exception 'signup_log must carry exactly its primary-key index';
  end if;

  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'record_signup'
    and (p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false));
  if v_count <> 0 then
    raise exception 'record_signup must be security invoker with an empty search path';
  end if;

  -- The purge and the writer must take the identical per-user advisory lock
  -- through the one shared helper, or "delete this account" and "record this
  -- signup" silently stop excluding each other.
  if pg_get_functiondef('public.record_signup(text, timestamptz, jsonb, text)'::regprocedure)
      not like '%account_deletion_lock_key%' then
    raise exception 'record_signup does not use the shared lock-key helper';
  end if;

  -- The purge redacts, and must NOT delete: the signup fact is retained.
  if pg_get_functiondef('public.purge_account_data(text)'::regprocedure)
      not like '%update public.signup_log%' then
    raise exception 'purge_account_data does not redact signup_log.first_touch';
  end if;
  if pg_get_functiondef('public.purge_account_data(text)'::regprocedure)
      like '%delete from public.signup_log%' then
    raise exception 'signup_log must not be on the purge delete list';
  end if;

  -- No view exposes an identifier or the raw attribution object.
  if exists (
    select 1
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'analytics'
      and c.relkind = 'v'
      and c.relname in ('signups_daily', 'signup_rollups', 'signup_sources_daily')
      and a.attnum > 0
      and not a.attisdropped
      and (a.attname in ('clerk_user_id', 'first_touch', 'landing_path')
           or format_type(a.atttypid, a.atttypmod) = 'jsonb')
  ) then
    raise exception 'a signup analytics view exposes a per-user or raw-jsonb column';
  end if;
end $catalog_proof$;

-- ---------------------------------------------------------------------------
-- 3. service_role: the grants are the boundary, proved by running statements.
-- ---------------------------------------------------------------------------
set local role service_role;
do $service_role_proof$
declare
  v_replay_user text := 'signup_log_test_replay';
  v_fill_user text := 'signup_log_test_fill';
  v_out_of_order_user text := 'signup_log_test_out_of_order';
  v_tombstone_first_user text := 'signup_log_test_tombstone_first';
  v_write_first_user text := 'signup_log_test_write_first';
  v_purge_user text := 'signup_log_test_full_purge';
  v_created timestamptz := timestamptz '2026-05-04 15:00:00+00';
  v_later timestamptz := timestamptz '2026-06-09 11:00:00+00';
  v_touch_a jsonb := jsonb_build_object(
    'schemaVersion', 1, 'landingPath', '/', 'utmSource', 'Reddit', 'ref', 'AlphaRef'
  );
  v_touch_b jsonb := jsonb_build_object(
    'schemaVersion', 1, 'landingPath', '/guides', 'utmSource', 'hn'
  );
  v_row record;
  v_first_touch jsonb;
  v_day_count bigint;
  v_day_count_after bigint;
  v_day_total bigint;
  v_day_total_after bigint;
  v_credential_updated_at timestamptz;
begin
  -- ---- column-scoped SELECT ----------------------------------------------
  perform public.record_signup(v_replay_user, v_created, null, 'webhook');

  -- `select *` expands to created_at and source, which service_role may not
  -- read. Column-scoped SELECT is the whole point, so this must fail.
  begin
    execute 'select * from public.signup_log limit 1' into v_row;
    raise exception 'service_role select * on signup_log unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;

  -- The two columns the RPC and the purge actually read are readable.
  select first_touch into v_first_touch
  from public.signup_log
  where clerk_user_id = v_replay_user;
  if v_first_touch is not null then
    raise exception 'unattributed signup unexpectedly stored attribution';
  end if;

  -- ---- replay --------------------------------------------------------------
  -- The identical payload twice is one row and no error.
  perform public.record_signup(v_replay_user, v_created, null, 'webhook');
  if (select count(*) from public.signup_log where clerk_user_id = v_replay_user) <> 1 then
    raise exception 'replayed record_signup did not produce exactly one row';
  end if;

  -- ---- fill-if-null --------------------------------------------------------
  perform public.record_signup(v_fill_user, v_created, null, 'webhook');
  perform public.record_signup(v_fill_user, v_created, v_touch_a, 'webhook');
  select first_touch into v_first_touch
  from public.signup_log where clerk_user_id = v_fill_user;
  if v_first_touch is null or v_first_touch ->> 'utmSource' <> 'Reddit' then
    raise exception 'fill-if-null did not fill a null first_touch';
  end if;

  -- A third call with different attribution must NOT replace what was captured.
  perform public.record_signup(v_fill_user, v_created, v_touch_b, 'webhook');
  select first_touch into v_first_touch
  from public.signup_log where clerk_user_id = v_fill_user;
  if v_first_touch ->> 'utmSource' <> 'Reddit' then
    raise exception 'captured attribution was replaced by a later write';
  end if;

  -- ---- update-before-create -----------------------------------------------
  -- Svix does not guarantee ordering. A user.updated for an unknown user
  -- inserts with its own created_at; a later user.created replay must preserve
  -- created_at and source and fill only a null first_touch.
  perform public.record_signup(v_out_of_order_user, v_created, null, 'webhook');
  perform public.record_signup(v_out_of_order_user, v_later, v_touch_a, 'backfill');
  execute 'reset role';
  select created_at, source, first_touch into v_row
  from public.signup_log where clerk_user_id = v_out_of_order_user;
  if v_row.created_at <> v_created then
    raise exception 'created_at was overwritten by a later call (found %)', v_row.created_at;
  end if;
  if v_row.source <> 'webhook' then
    raise exception 'source was overwritten by a later call (found %)', v_row.source;
  end if;
  if v_row.first_touch ->> 'utmSource' <> 'Reddit' then
    raise exception 'a later call did not fill the null first_touch';
  end if;
  execute 'set local role service_role';

  -- ---- tombstone-before-write ---------------------------------------------
  -- After a purge, a late user.created retry must still record the signup,
  -- must write NULL attribution, and must not raise.
  perform public.purge_account_data(v_tombstone_first_user);
  perform public.record_signup(v_tombstone_first_user, v_created, v_touch_a, 'webhook');
  select first_touch into v_first_touch
  from public.signup_log where clerk_user_id = v_tombstone_first_user;
  if not exists (select 1 from public.signup_log where clerk_user_id = v_tombstone_first_user) then
    raise exception 'post-tombstone record_signup did not record the signup';
  end if;
  if v_first_touch is not null then
    raise exception 'post-tombstone record_signup wrote attribution';
  end if;
  -- And a replay of that late retry stays silent and stays redacted.
  perform public.record_signup(v_tombstone_first_user, v_created, v_touch_a, 'webhook');
  select first_touch into v_first_touch
  from public.signup_log where clerk_user_id = v_tombstone_first_user;
  if v_first_touch is not null then
    raise exception 'post-tombstone replay wrote attribution on the conflict path';
  end if;

  -- ---- write-before-purge --------------------------------------------------
  perform public.record_signup(v_write_first_user, v_created, v_touch_a, 'webhook');
  execute 'reset role';
  select signups, signups_including_deleted into v_day_count, v_day_total
  from analytics.signups_daily
  where et_day = (v_created at time zone 'America/New_York')::date;
  execute 'set local role service_role';

  perform public.purge_account_data(v_write_first_user);

  execute 'reset role';
  select first_touch into v_first_touch
  from public.signup_log where clerk_user_id = v_write_first_user;
  if not exists (select 1 from public.signup_log where clerk_user_id = v_write_first_user) then
    raise exception 'purge removed the signup row instead of redacting it';
  end if;
  if v_first_touch is not null then
    raise exception 'purge did not redact first_touch';
  end if;
  select signups, signups_including_deleted into v_day_count_after, v_day_total_after
  from analytics.signups_daily
  where et_day = (v_created at time zone 'America/New_York')::date;
  -- The signup FACT survives the purge: signups_including_deleted for that ET
  -- day is unchanged, which is the whole point of retaining the row. `signups`
  -- drops by exactly one, because the weekly series deliberately continues to
  -- exclude deleted accounts (that keeps the chart identical at cutover and
  -- leaves "signups ever" one predicate away).
  if v_day_total_after <> v_day_total then
    raise exception
      'signups_including_deleted for the purged user''s day moved (% -> %)',
      v_day_total, v_day_total_after;
  end if;
  if v_day_count_after <> v_day_count - 1 then
    raise exception
      'signups for the purged user''s day did not drop by exactly one (% -> %)',
      v_day_count, v_day_count_after;
  end if;
  execute 'set local role service_role';

  -- ---- the full purge still completes, with the signup row present ---------
  -- A missing column-scoped SELECT grant would abort this entire transaction,
  -- which is exactly why the purge is exercised end to end here.
  insert into public.espn_credentials (clerk_user_id, swid, s2, updated_at)
  values (v_purge_user, 'swid', 's2', now())
  returning updated_at into v_credential_updated_at;
  insert into public.espn_leagues (clerk_user_id, league_id, sport, team_id, season_year)
  values (v_purge_user, 'league', 'football', 'team', 2024);
  insert into public.user_preferences (clerk_user_id) values (v_purge_user);
  insert into public.oauth_tokens (access_token, user_id, expires_at)
  values ('at-' || v_purge_user, v_purge_user, now() + interval '1 hour');
  perform public.record_signup(v_purge_user, v_created, v_touch_a, 'webhook');

  perform public.purge_account_data(v_purge_user);

  if exists (select 1 from public.espn_credentials where clerk_user_id = v_purge_user)
    or exists (select 1 from public.espn_leagues where clerk_user_id = v_purge_user)
    or exists (select 1 from public.user_preferences where clerk_user_id = v_purge_user)
    or exists (select 1 from public.oauth_tokens where user_id = v_purge_user) then
    raise exception 'full purge left rows behind for %', v_purge_user;
  end if;
  if not exists (select 1 from public.account_deletions where clerk_user_id = v_purge_user) then
    raise exception 'full purge did not write the tombstone';
  end if;
  select first_touch into v_first_touch
  from public.signup_log where clerk_user_id = v_purge_user;
  if not exists (select 1 from public.signup_log where clerk_user_id = v_purge_user) then
    raise exception 'full purge deleted the signup row';
  end if;
  if v_first_touch is not null then
    raise exception 'full purge did not null the signup attribution';
  end if;

  -- ---- argument validation -------------------------------------------------
  begin
    perform public.record_signup('   ', v_created, null, 'webhook');
    raise exception using errcode = 'ZZ001', message = 'blank clerk_user_id was accepted';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  begin
    perform public.record_signup('signup_log_test_bad', null, null, 'webhook');
    raise exception using errcode = 'ZZ001', message = 'null created_at was accepted';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  begin
    perform public.record_signup('signup_log_test_bad', v_created, null, 'other');
    raise exception using errcode = 'ZZ001', message = 'an invalid source was accepted';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;

  -- service_role must not reach the analytics views either.
  begin
    perform 1 from analytics.signups_daily limit 1;
    raise exception 'service_role unexpectedly read analytics.signups_daily';
  exception when insufficient_privilege then null;
  end;
end $service_role_proof$;

reset role;

-- ---------------------------------------------------------------------------
-- 4. analytics_readonly reads the three views and no per-user table.
-- ---------------------------------------------------------------------------
-- analytics_readonly is NOLOGIN and postgres is not a member of it, so the
-- membership is granted here purely to be able to SET ROLE and prove the read
-- path by execution. This whole file runs inside a transaction that is rolled
-- back, so the grant never outlives the test. postgres created the role in the
-- baseline and therefore holds admin option on it. The role name is spelled
-- out rather than written as current_user: GRANT ... TO current_user segfaults
-- this Postgres build.
grant analytics_readonly to postgres;
set local role analytics_readonly;
do $read_role_proof$
begin
  perform 1 from analytics.signups_daily;
  perform 1 from analytics.signup_rollups;
  perform 1 from analytics.signup_sources_daily;

  begin
    perform clerk_user_id from public.signup_log limit 1;
    raise exception 'analytics_readonly unexpectedly read public.signup_log';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.record_signup('denied', now(), null, 'webhook');
    raise exception 'analytics_readonly unexpectedly executed record_signup';
  exception when insufficient_privilege then null;
  end;
end $read_role_proof$;

reset role;

-- ---------------------------------------------------------------------------
-- 5. View semantics, on fixtures this block fully controls.
-- ---------------------------------------------------------------------------
delete from public.signup_log;
delete from public.account_deletions;

do $view_proof$
declare
  v_et_day date;
  v_row record;
  v_now timestamptz := now();
begin
  -- ET-vs-UTC placement: 03:30 UTC on March 1 is 22:30 EST on February 28.
  -- The day boundary the dashboard shows is Eastern, and the view is where
  -- that placement now happens.
  insert into public.signup_log (clerk_user_id, created_at, first_touch, source)
  values ('view_utc_edge', timestamptz '2026-03-01 03:30:00+00', null, 'backfill');

  select et_day into v_et_day
  from analytics.signups_daily
  where signups_including_deleted > 0
    and et_day = date '2026-02-28';
  if v_et_day is null then
    raise exception 'signups_daily placed a 03:30Z signup on the UTC day, not the ET day';
  end if;

  -- Deleted accounts leave `signups` and stay in `signups_including_deleted`.
  insert into public.signup_log (clerk_user_id, created_at, first_touch, source)
  values ('view_deleted', timestamptz '2026-03-01 03:30:00+00', null, 'backfill');
  insert into public.account_deletions (clerk_user_id) values ('view_deleted');

  select signups, signups_including_deleted into v_row
  from analytics.signups_daily where et_day = date '2026-02-28';
  if v_row.signups <> 1 or v_row.signups_including_deleted <> 2 then
    raise exception
      'signups_daily deleted-account split wrong (signups %, including_deleted %)',
      v_row.signups, v_row.signups_including_deleted;
  end if;

  -- Rollups: exactly one row, carrying the clock it was computed from.
  if (select count(*) from analytics.signup_rollups) <> 1 then
    raise exception 'signup_rollups is not a single row';
  end if;

  insert into public.signup_log (clerk_user_id, created_at, first_touch, source)
  values
    ('view_today', v_now, null, 'webhook'),
    ('view_d7', v_now - interval '3 days', null, 'webhook'),
    ('view_d7_prev', v_now - interval '10 days', null, 'webhook'),
    ('view_d30', v_now - interval '20 days', null, 'webhook');

  select * into v_row from analytics.signup_rollups;
  if v_row.now_at is null then
    raise exception 'signup_rollups does not expose the clock it was computed from';
  end if;
  -- view_deleted is excluded everywhere; view_utc_edge is a 2026-02-28 signup.
  if v_row.total <> 5 then
    raise exception 'signup_rollups total wrong (found %)', v_row.total;
  end if;
  if v_row.today <> 1 then
    raise exception 'signup_rollups today wrong (found %)', v_row.today;
  end if;
  if v_row.d7 <> 2 then
    raise exception 'signup_rollups d7 wrong (found %)', v_row.d7;
  end if;
  if v_row.d7_prev <> 1 then
    raise exception 'signup_rollups d7_prev wrong (found %)', v_row.d7_prev;
  end if;
  if v_row.d30 <> 4 then
    raise exception 'signup_rollups d30 wrong (found %)', v_row.d30;
  end if;

  -- Sources: lower-cased dimensions, campaign flag, attributed rows only.
  delete from public.signup_log;
  delete from public.account_deletions;

  insert into public.signup_log (clerk_user_id, created_at, first_touch, source)
  values
    ('src_a', timestamptz '2026-03-01 03:30:00+00',
     jsonb_build_object('schemaVersion', 1, 'landingPath', '/',
                        'utmSource', 'Reddit', 'ref', 'AlphaRef',
                        'referrerHost', 'News.YCombinator.com'), 'webhook'),
    ('src_b', timestamptz '2026-03-01 03:31:00+00',
     jsonb_build_object('schemaVersion', 1, 'landingPath', '/',
                        'utmSource', 'reddit', 'ref', 'alpharef',
                        'referrerHost', 'news.ycombinator.com'), 'webhook'),
    ('src_campaign', timestamptz '2026-03-01 03:32:00+00',
     jsonb_build_object('schemaVersion', 1, 'landingPath', '/',
                        'utmCampaign', 'spring'), 'webhook'),
    ('src_unattributed', timestamptz '2026-03-01 03:33:00+00', null, 'webhook'),
    ('src_deleted', timestamptz '2026-03-01 03:34:00+00',
     jsonb_build_object('schemaVersion', 1, 'landingPath', '/',
                        'utmSource', 'deleted'), 'webhook');
  insert into public.account_deletions (clerk_user_id) values ('src_deleted');

  -- The two differently-cased rows fold into one grouped row of 2.
  select et_day, utm_source, ref, referrer_host, has_campaign_fields, signups
    into v_row
  from analytics.signup_sources_daily
  where utm_source = 'reddit';
  if v_row.signups <> 2
    or v_row.et_day <> date '2026-02-28'
    or v_row.ref <> 'alpharef'
    or v_row.referrer_host <> 'news.ycombinator.com'
    or v_row.has_campaign_fields then
    raise exception 'signup_sources_daily did not fold case-varying dimensions into one row';
  end if;

  select has_campaign_fields, signups into v_row
  from analytics.signup_sources_daily
  where utm_source is null and ref is null and referrer_host is null;
  if not v_row.has_campaign_fields or v_row.signups <> 1 then
    raise exception 'signup_sources_daily has_campaign_fields is wrong for a campaign-only row';
  end if;

  -- Unattributed and deleted rows are absent entirely.
  if (select coalesce(sum(signups), 0) from analytics.signup_sources_daily) <> 3 then
    raise exception 'signup_sources_daily included unattributed or deleted rows';
  end if;
  if exists (
    select 1 from analytics.signup_sources_daily where utm_source = 'deleted'
  ) then
    raise exception 'signup_sources_daily exposed a deleted account''s attribution';
  end if;
end $view_proof$;

rollback;
