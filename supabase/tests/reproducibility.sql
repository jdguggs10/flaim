-- Read-only acceptance proof for the greenfield baseline.
--
-- Run only against a reset local database:
--   docker cp supabase/tests/reproducibility.sql supabase_db_flaim:/tmp/reproducibility.sql
--   docker exec supabase_db_flaim psql -v ON_ERROR_STOP=1 -U postgres -d postgres -f /tmp/reproducibility.sql

do $proof$
declare
  actual_count bigint;
  expected_count bigint;
  relation_name text;
begin
  select count(*) into actual_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r';
  if actual_count <> 24 then
    raise exception 'expected 24 public tables, found %', actual_count;
  end if;

  select count(*) into actual_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'analytics' and c.relkind = 'r';
  if actual_count <> 3 then
    raise exception 'expected 3 analytics tables, found %', actual_count;
  end if;

  select count(*) into actual_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v';
  if actual_count <> 2 then
    raise exception 'expected 2 public views, found %', actual_count;
  end if;

  select count(*) into actual_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'analytics' and c.relkind = 'v';
  if actual_count <> 14 then
    raise exception 'expected 14 analytics views, found %', actual_count;
  end if;

  select count(*) into actual_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f';
  if actual_count <> 20 then
    raise exception 'expected 20 public functions, found %', actual_count;
  end if;

  select count(*) into actual_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'analytics' and p.prokind = 'f';
  -- dashboard_payload, refresh_dashboard_snapshot(), the FLA-264 per-variant
  -- refresh_dashboard_snapshot(boolean), provider_flags_payload, and
  -- refresh_provider_flags_snapshot.
  if actual_count <> 5 then
    raise exception 'expected 5 analytics functions, found %', actual_count;
  end if;

  select count(*) into actual_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'i';
  if actual_count <> 75 then
    raise exception 'expected 75 public indexes, found %', actual_count;
  end if;

  select count(*) into actual_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'analytics' and c.relkind = 'i';
  if actual_count <> 3 then
    raise exception 'expected 3 analytics indexes, found %', actual_count;
  end if;

  select count(*) into actual_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'S';
  if actual_count <> 2 then
    raise exception 'expected 2 public sequences, found %', actual_count;
  end if;

  select count(*) into actual_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relrowsecurity;
  if actual_count <> 24 then
    raise exception 'expected RLS on all 24 public tables, found %', actual_count;
  end if;

  select count(*) into actual_count
  from pg_policies
  where schemaname in ('public', 'analytics');
  if actual_count <> 0 then
    raise exception 'expected no application policies, found %', actual_count;
  end if;

  select count(*) into actual_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'v'
    and c.reloptions @> array['security_invoker=true'];
  if actual_count <> 2 then
    raise exception 'expected both public views to be security-invoker';
  end if;

  if to_regprocedure('public.cleanup_expired_extension_codes()') is not null then
    raise exception 'orphan cleanup_expired_extension_codes() was recreated';
  end if;

  select count(*) into actual_count
  from pg_extension e
  where e.extname in (
    'pg_cron',
    'pg_graphql',
    'pg_stat_statements',
    'pgcrypto',
    'supabase_vault',
    'uuid-ossp'
  );
  if actual_count <> 6 then
    raise exception 'expected 6 contract extensions, found %', actual_count;
  end if;

  -- Fresh environments must not activate hosted production schedules. A
  -- disposable local cron job is the negative control for this assertion.
  select count(*) into actual_count from cron.job;
  if actual_count <> 0 then
    raise exception 'local baseline unexpectedly activated % cron jobs', actual_count;
  end if;

  if not exists (
    select 1
    from pg_roles
    where rolname = 'analytics_readonly' and not rolcanlogin
  ) then
    raise exception 'analytics_readonly must exist as NOLOGIN';
  end if;

  if not has_schema_privilege('analytics_readonly', 'analytics', 'USAGE')
     or not has_table_privilege(
       'analytics_readonly',
       'analytics.dashboard_snapshot',
       'SELECT'
     )
     or not has_table_privilege(
       'analytics_readonly',
       'analytics.provider_flags_snapshot',
       'SELECT'
     ) then
    raise exception 'analytics_readonly is missing required read privileges';
  end if;

  -- The provider flags snapshot keeps the private analytics posture: the
  -- internal read-only role is the ONLY non-owner grantee, and it gets SELECT
  -- and nothing else. anon, authenticated, service_role, and PUBLIC get none.
  select count(*) into actual_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(
    coalesce(c.relacl, acldefault('r', c.relowner))
  ) a
  where n.nspname = 'analytics'
    and c.relname = 'provider_flags_snapshot'
    and case a.grantee
      when 0 then 'PUBLIC'
      else pg_get_userbyid(a.grantee)
    end <> pg_get_userbyid(c.relowner);
  if actual_count <> 1 then
    raise exception
      'provider_flags_snapshot has % non-owner grants, expected exactly 1',
      actual_count;
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) a
    where n.nspname = 'analytics'
      and c.relname = 'provider_flags_snapshot'
      and pg_get_userbyid(a.grantee) = 'analytics_readonly'
      and a.privilege_type = 'SELECT'
  ) then
    raise exception
      'the single provider_flags_snapshot grant is not analytics_readonly SELECT';
  end if;

  -- The refresh path is owner-only, and never reachable as a definer shortcut.
  select count(*) into actual_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(
    coalesce(p.proacl, acldefault('f', p.proowner))
  ) a
  where n.nspname = 'analytics'
    and (
      p.proname in (
        'provider_flags_payload',
        'refresh_provider_flags_snapshot'
      )
      or (p.proname = 'refresh_dashboard_snapshot' and p.pronargs = 1)
    )
    and case a.grantee
      when 0 then 'PUBLIC'
      else pg_get_userbyid(a.grantee)
    end <> pg_get_userbyid(p.proowner);
  if actual_count <> 0 then
    raise exception
      'FLA-264 functions expose % non-owner EXECUTE grants',
      actual_count;
  end if;

  select count(*) into actual_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'analytics'
    and p.proname in (
      'provider_flags_payload',
      'refresh_provider_flags_snapshot',
      'refresh_dashboard_snapshot'
    )
    and not p.prosecdef
    -- `set search_path to ''` is stored with the empty value quoted.
    and p.proconfig @> array['search_path=""'];
  if actual_count <> 4 then
    raise exception
      'expected 4 security-invoker FLA-264 functions with an empty search_path, found %',
      actual_count;
  end if;

  if has_schema_privilege('service_role', 'analytics', 'USAGE') then
    raise exception 'service_role unexpectedly has analytics schema usage';
  end if;

  if has_table_privilege('anon', 'public.demo_antigravity_cache', 'SELECT')
     or has_table_privilege(
       'authenticated',
       'public.demo_antigravity_cache',
       'SELECT'
     )
     or not has_table_privilege(
       'service_role',
       'public.demo_antigravity_cache',
       'SELECT'
     ) then
    raise exception 'demo_antigravity_cache grants do not match before-state';
  end if;

  if has_table_privilege('anon', 'public.demo_target_state', 'SELECT')
     or has_table_privilege(
       'authenticated',
       'public.demo_target_state',
       'SELECT'
     )
     or not has_table_privilege(
       'service_role',
       'public.demo_target_state',
       'SELECT'
     ) then
    raise exception 'demo_target_state grants are not service-role only';
  end if;

  select count(*) into actual_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
  where n.nspname = 'public'
    and c.relkind = 'S'
    and c.relname in ('espn_leagues_id_seq', 'mcp_tool_events_id_seq')
    and case a.grantee
      when 0 then 'PUBLIC'
      else pg_get_userbyid(a.grantee)
    end in ('anon', 'authenticated', 'service_role')
    and a.privilege_type in ('SELECT', 'UPDATE', 'USAGE');
  if actual_count <> 18 then
    raise exception 'sequence ACL before-state is incomplete: % rows', actual_count;
  end if;

  select count(*) into actual_count
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) a
  where pg_get_userbyid(d.defaclrole) = 'supabase_admin'
    and n.nspname = 'public';
  if actual_count <> 48 then
    raise exception 'expected 48 platform supabase_admin default ACL rows, found %', actual_count;
  end if;

  select count(*) into actual_count
  from pg_default_acl d
  join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) a
  where pg_get_userbyid(d.defaclrole) = 'supabase_admin'
    and n.nspname = 'public'
    and not a.is_grantable
    and case a.grantee
      when 0 then 'PUBLIC'
      else pg_get_userbyid(a.grantee)
    end in ('anon', 'authenticated', 'postgres', 'service_role')
    and (
      (d.defaclobjtype = 'S' and a.privilege_type in ('SELECT', 'UPDATE', 'USAGE'))
      or (d.defaclobjtype = 'f' and a.privilege_type = 'EXECUTE')
      or (
        d.defaclobjtype = 'r'
        and a.privilege_type in (
          'DELETE',
          'INSERT',
          'MAINTAIN',
          'REFERENCES',
          'SELECT',
          'TRIGGER',
          'TRUNCATE',
          'UPDATE'
        )
      )
    );
  if actual_count <> 48 then
    raise exception 'platform supabase_admin default ACL semantics differ: % expected rows', actual_count;
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'idx_public_demo_refresh_runs_preset_sport_created'
  ) or not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'public_demo_refresh_runs_preset_sport_created_at_idx'
  ) then
    raise exception 'expected duplicate before-state indexes are missing';
  end if;

  if (
    select row(
      i.indrelid,
      i.indkey,
      i.indcollation,
      i.indclass,
      i.indoption,
      pg_get_expr(i.indexprs, i.indrelid),
      pg_get_expr(i.indpred, i.indrelid)
    )
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    where c.relname = 'idx_public_demo_refresh_runs_preset_sport_created'
  ) is distinct from (
    select row(
      i.indrelid,
      i.indkey,
      i.indcollation,
      i.indclass,
      i.indoption,
      pg_get_expr(i.indexprs, i.indrelid),
      pg_get_expr(i.indpred, i.indrelid)
    )
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    where c.relname = 'public_demo_refresh_runs_preset_sport_created_at_idx'
  ) then
    raise exception 'known duplicate indexes are not structurally identical';
  end if;

  for relation_name, expected_count in
    select *
    from (values
      ('public.espn_credentials', 1),
      ('public.espn_leagues', 1),
      ('public.oauth_codes', 1),
      ('public.oauth_tokens', 1),
      ('public.oauth_states', 1),
      ('public.yahoo_credentials', 1),
      ('public.yahoo_leagues', 1),
      ('public.platform_oauth_states', 1),
      ('public.user_preferences', 1),
      ('public.sleeper_connections', 1),
      ('public.sleeper_leagues', 1),
      ('public.chat_runs', 1),
      ('public.demo_context_cache', 1),
      ('public.demo_answer_cache', 1),
      ('public.demo_refresh_runs', 1),
      ('public.demo_refresh_attempts', 1),
      ('public.demo_antigravity_cache', 1),
      ('public.demo_target_state', 5),
      ('public.archived_leagues', 1),
      ('public.mcp_tool_events', 3),
      ('public.mcp_user_daily', 1),
      ('public.mcp_tool_daily', 3),
      ('public.provider_sync_state', 2),
      ('analytics.dashboard_snapshot', 2),
      ('analytics.provider_flags_snapshot', 2),
      ('analytics.internal_users', 1)
    ) expected(relation_name, expected_count)
  loop
    execute format('select count(*) from %s', relation_name)
      into actual_count;
    if actual_count <> expected_count then
      raise exception '% expected % seed rows, found %',
        relation_name,
        expected_count,
        actual_count;
    end if;
  end loop;

  if exists (
    select 1
    from public.oauth_states
    where expires_at > now()
  ) or exists (
    select 1
    from public.platform_oauth_states
    where expires_at > now()
  ) or exists (
    select 1
    from public.oauth_codes
    where expires_at > now() or used_at is null
  ) or exists (
    select 1
    from public.oauth_tokens
    where expires_at > now()
      or refresh_token_expires_at > now()
      or revoked_at is null
  ) then
    raise exception 'synthetic OAuth rows are usable';
  end if;

  select count(*) into actual_count
  from public.mcp_tool_events
  where env = 'prod' and status = 'ok';
  if actual_count <> 2 then
    raise exception 'expected 2 synthetic ok events, found %', actual_count;
  end if;

  select count(*) into actual_count
  from public.mcp_tool_events
  where env = 'prod'
    and status = 'error'
    and error_code = 'SYNTHETIC_SEED_ERROR';
  if actual_count <> 1 then
    raise exception 'expected 1 synthetic error event, found %', actual_count;
  end if;

  if (select count(*) from analytics.usage_daily) = 0
     or (select count(*) from analytics.usage_rolling) = 0
     or (select count(*) from analytics.usage_trend) = 0
     or (select count(*) from analytics.tool_health) = 0
     or (select count(*) from analytics.tool_health_7d) = 0
     or (select count(*) from analytics.health_summary) = 0
     or (select count(*) from analytics.funnel_snapshot) = 0 then
    raise exception 'synthetic analytics coverage is incomplete';
  end if;

  select count(*) into actual_count
  from analytics.dashboard_snapshot
  where id in (1, 2)
    and jsonb_typeof(payload) = 'object'
    and computed_at is not null;
  if actual_count <> 2 then
    raise exception 'dashboard snapshot seed proof failed';
  end if;

  if not (select analytics.dashboard_payload(false) ? 'sync_recent') then
    raise exception 'dashboard payload is missing sync_recent';
  end if;

  -- The seed gives the external account one recent ESPN success and the
  -- internal account one recent Yahoo failure. The external variant must show
  -- ESPN only; the internal-inclusive variant must add Yahoo. Neither may
  -- invent a Sleeper row for a provider with no sync state at all.
  if not exists (
    select 1
    from analytics.dashboard_snapshot
    where id = 1
      and jsonb_typeof(payload -> 'sync_recent') = 'array'
      and jsonb_array_length(payload -> 'sync_recent') = 1
      and exists (
        select 1
        from jsonb_array_elements(payload -> 'sync_recent') as item
        where item ->> 'provider' = 'espn'
          and (item ->> 'users_failed_6h')::integer = 0
          and (item ->> 'users_succeeded_6h')::integer = 1
          and jsonb_typeof(item -> 'recent_error_codes') = 'array'
          and jsonb_array_length(item -> 'recent_error_codes') = 0
      )
  ) then
    raise exception 'external sync_recent dashboard snapshot proof failed';
  end if;

  if not exists (
    select 1
    from analytics.dashboard_snapshot
    where id = 2
      and jsonb_array_length(payload -> 'sync_recent') = 2
      and exists (
        select 1
        from jsonb_array_elements(payload -> 'sync_recent') as item
        where item ->> 'provider' = 'yahoo'
          and (item ->> 'users_failed_6h')::integer = 1
          and (item ->> 'users_succeeded_6h')::integer = 0
          and item -> 'recent_error_codes'
              = '["SYNTHETIC_SEED_SYNC_ERROR"]'::jsonb
      )
  ) then
    raise exception 'internal-inclusive sync_recent dashboard snapshot proof failed';
  end if;

  -- FLA-264 dedicated provider-flags snapshot.
  if to_regclass('analytics.provider_flags_snapshot') is null then
    raise exception 'analytics.provider_flags_snapshot is missing';
  end if;

  if to_regprocedure('analytics.provider_flags_payload(boolean)') is null
     or to_regprocedure('analytics.refresh_provider_flags_snapshot()') is null
     or to_regprocedure('analytics.refresh_dashboard_snapshot(boolean)') is null
     or to_regprocedure('analytics.refresh_dashboard_snapshot()') is null then
    raise exception 'FLA-264 analytics functions are incomplete';
  end if;

  select count(*) into actual_count
  from analytics.provider_flags_snapshot
  where id in (1, 2)
    and jsonb_typeof(providers) = 'array'
    and computed_at is not null;
  if actual_count <> 2 then
    raise exception 'provider flags snapshot variants are incomplete';
  end if;

  if not exists (
    select 1
    from analytics.provider_flags_snapshot
    where id = 1
      and jsonb_array_length(providers) = 1
      and exists (
        select 1
        from jsonb_array_elements(providers) as item
        where item ->> 'provider' = 'espn'
          and (item ->> 'users_failed_6h')::integer = 0
          and (item ->> 'users_succeeded_6h')::integer = 1
          and jsonb_typeof(item -> 'recent_error_codes') = 'array'
          and jsonb_array_length(item -> 'recent_error_codes') = 0
      )
  ) then
    raise exception 'external provider flags variant proof failed';
  end if;

  if not exists (
    select 1
    from analytics.provider_flags_snapshot
    where id = 2
      and jsonb_array_length(providers) = 2
      and exists (
        select 1
        from jsonb_array_elements(providers) as item
        where item ->> 'provider' = 'yahoo'
          and (item ->> 'users_failed_6h')::integer = 1
          and (item ->> 'users_succeeded_6h')::integer = 0
          and item -> 'recent_error_codes'
              = '["SYNTHETIC_SEED_SYNC_ERROR"]'::jsonb
      )
      and not exists (
        select 1
        from jsonb_array_elements(providers) as item
        where item ->> 'provider' = 'sleeper'
      )
  ) then
    raise exception 'internal-inclusive provider flags variant proof failed';
  end if;

  -- The dedicated relation must carry exactly what the dashboard payload's
  -- sync_recent key carries, per variant. A consumer switching sources reads
  -- the same rows; only the timestamp's cadence changes.
  select count(*) into actual_count
  from analytics.provider_flags_snapshot p
  join analytics.dashboard_snapshot d on d.id = p.id
  where p.providers = (d.payload -> 'sync_recent');
  if actual_count <> 2 then
    raise exception
      'provider flags variants do not match the dashboard sync_recent key';
  end if;

  select count(*) into actual_count
  from supabase_migrations.schema_migrations
  where version = '20260727230606';
  if actual_count <> 1 then
    raise exception 'baseline migration history row is missing';
  end if;

  select count(*) into actual_count
  from supabase_migrations.schema_migrations
  where version = '20260802131749';
  if actual_count <> 1 then
    raise exception 'sync_recent migration history row is missing';
  end if;

  select count(*) into actual_count
  from supabase_migrations.schema_migrations
  where version = '20260805112500';
  if actual_count <> 1 then
    raise exception 'demo platform migration history row is missing';
  end if;

  select count(*) into actual_count
  from supabase_migrations.schema_migrations
  where version = '20260813012740';
  if actual_count <> 1 then
    raise exception 'snapshot cadence migration history row is missing';
  end if;

  select count(*) into actual_count
  from supabase_migrations.schema_migrations
  where version = '20260827004306';
  if actual_count <> 1 then
    raise exception 'ESPN history jobs migration history row is missing';
  end if;
end
$proof$;

with relation_rows as (
  select concat_ws(
    '|',
    n.nspname,
    c.relkind,
    c.relname,
    pg_get_userbyid(c.relowner),
    c.relrowsecurity,
    c.relforcerowsecurity,
    coalesce(array_to_string(c.reloptions, ','), '')
  ) as value
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'analytics')
    and c.relkind in ('r', 'v', 'S', 'i')
),
column_rows as (
  select
    n.nspname as schema_name,
    c.relname as relation_name,
    a.attnum,
    concat_ws(
      '|',
      n.nspname,
      c.relname,
      a.attname,
      format_type(a.atttypid, a.atttypmod),
      a.attnotnull,
      a.attidentity,
      a.attgenerated,
      coalesce(pg_get_expr(d.adbin, d.adrelid), '')
    ) as value
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_attrdef d
    on d.adrelid = a.attrelid and d.adnum = a.attnum
  where n.nspname in ('public', 'analytics')
    and c.relkind in ('r', 'v')
    and a.attnum > 0
    and not a.attisdropped
),
constraint_rows as (
  select concat_ws(
    '|',
    n.nspname,
    c.relname,
    con.conname,
    con.contype,
    pg_get_constraintdef(con.oid, true)
  ) as value
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'analytics')
),
index_rows as (
  select concat_ws(
    '|',
    n.nspname,
    t.relname,
    i.relname,
    pg_get_indexdef(i.oid)
  ) as value
  from pg_index x
  join pg_class i on i.oid = x.indexrelid
  join pg_class t on t.oid = x.indrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname in ('public', 'analytics')
),
view_rows as (
  select concat_ws(
    '|',
    n.nspname,
    c.relname,
    pg_get_viewdef(c.oid, true)
  ) as value
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'analytics')
    and c.relkind = 'v'
),
function_rows as (
  select concat_ws(
    '|',
    n.nspname,
    p.proname,
    pg_get_function_identity_arguments(p.oid),
    pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.provolatile,
    coalesce(array_to_string(p.proconfig, ','), ''),
    pg_get_functiondef(p.oid)
  ) as value
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'analytics')
    and p.prokind = 'f'
),
relation_grant_rows as (
  select concat_ws(
    '|',
    n.nspname,
    c.relkind,
    c.relname,
    case a.grantor
      when 0 then 'PUBLIC'
      else pg_get_userbyid(a.grantor)
    end,
    case a.grantee
      when 0 then 'PUBLIC'
      else pg_get_userbyid(a.grantee)
    end,
    a.privilege_type,
    a.is_grantable
  ) as value
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(
    coalesce(
      c.relacl,
      acldefault(
        case when c.relkind = 'S' then 'S'::"char" else 'r'::"char" end,
        c.relowner
      )
    )
  ) a
  where n.nspname in ('public', 'analytics')
    and c.relkind in ('r', 'v', 'S')
),
function_grant_rows as (
  select concat_ws(
    '|',
    n.nspname,
    p.proname,
    pg_get_function_identity_arguments(p.oid),
    case a.grantor
      when 0 then 'PUBLIC'
      else pg_get_userbyid(a.grantor)
    end,
    case a.grantee
      when 0 then 'PUBLIC'
      else pg_get_userbyid(a.grantee)
    end,
    a.privilege_type,
    a.is_grantable
  ) as value
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(
    coalesce(p.proacl, acldefault('f', p.proowner))
  ) a
  where n.nspname in ('public', 'analytics')
    and p.prokind = 'f'
),
schema_grant_rows as (
  select concat_ws(
    '|',
    n.nspname,
    case a.grantor
      when 0 then 'PUBLIC'
      else pg_get_userbyid(a.grantor)
    end,
    case a.grantee
      when 0 then 'PUBLIC'
      else pg_get_userbyid(a.grantee)
    end,
    a.privilege_type,
    a.is_grantable
  ) as value
  from pg_namespace n
  cross join lateral aclexplode(
    coalesce(n.nspacl, acldefault('n', n.nspowner))
  ) a
  where n.nspname in ('public', 'analytics')
),
default_grant_rows as (
  select concat_ws(
    '|',
    pg_get_userbyid(d.defaclrole),
    coalesce(n.nspname, '*'),
    d.defaclobjtype,
    case a.grantor
      when 0 then 'PUBLIC'
      else pg_get_userbyid(a.grantor)
    end,
    case a.grantee
      when 0 then 'PUBLIC'
      else pg_get_userbyid(a.grantee)
    end,
    a.privilege_type,
    a.is_grantable
  ) as value
  from pg_default_acl d
  left join pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) a
  where pg_get_userbyid(d.defaclrole) in ('postgres', 'supabase_admin')
    and coalesce(n.nspname, '*') in ('public', 'analytics')
),
extension_rows as (
  select concat_ws(
    '|',
    e.extname,
    n.nspname,
    e.extversion
  ) as value
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname in (
    'pg_cron',
    'pg_graphql',
    'pg_stat_statements',
    'pgcrypto',
    'supabase_vault',
    'uuid-ossp'
  )
),
role_rows as (
  select concat_ws(
    '|',
    rolname,
    rolcanlogin,
    rolinherit,
    rolcreaterole,
    rolcreatedb,
    rolreplication,
    rolbypassrls,
    rolconnlimit
  ) as value
  from pg_roles
  where rolname = 'analytics_readonly'
)
select jsonb_pretty(jsonb_build_object(
  'server_version', current_setting('server_version'),
  'relations', (
    select md5(string_agg(value, E'\n' order by value)) from relation_rows
  ),
  'columns', (
    -- Physical attnum gaps from production's dropped columns are historical
    -- storage artifacts, not part of a greenfield logical contract.
    select md5(string_agg(
      value,
      E'\n'
      order by schema_name, relation_name, attnum
    ))
    from column_rows
  ),
  'constraints', (
    select md5(string_agg(value, E'\n' order by value)) from constraint_rows
  ),
  'indexes', (
    select md5(string_agg(value, E'\n' order by value)) from index_rows
  ),
  'views', (
    select md5(string_agg(value, E'\n' order by value)) from view_rows
  ),
  'functions', (
    select md5(string_agg(value, E'\n' order by value)) from function_rows
  ),
  'relation_grants', (
    select md5(string_agg(value, E'\n' order by value))
    from relation_grant_rows
  ),
  'function_grants', (
    select md5(string_agg(value, E'\n' order by value))
    from function_grant_rows
  ),
  'schema_grants', (
    select md5(string_agg(value, E'\n' order by value))
    from schema_grant_rows
  ),
  'default_grants', (
    select md5(string_agg(value, E'\n' order by value))
    from default_grant_rows
  ),
  'extensions', (
    select md5(string_agg(value, E'\n' order by value)) from extension_rows
  ),
  'analytics_role', (
    select md5(string_agg(value, E'\n' order by value)) from role_rows
  ),
  'policies', coalesce((
    select md5(string_agg(
      concat_ws(
        '|',
        schemaname,
        tablename,
        policyname,
        roles::text,
        cmd,
        qual,
        with_check
      ),
      E'\n'
      order by schemaname, tablename, policyname
    ))
    from pg_policies
    where schemaname in ('public', 'analytics')
  ), md5('')),
  'cron_jobs', (select count(*) from cron.job),
  'migration_versions', (
    select jsonb_agg(version order by version)
    from supabase_migrations.schema_migrations
  ),
  'seed_summary', jsonb_build_object(
    'events', (select count(*) from public.mcp_tool_events),
    'user_rollups', (select count(*) from public.mcp_user_daily),
    'tool_rollups', (select count(*) from public.mcp_tool_daily),
    'dashboard_snapshots', (
      select count(*) from analytics.dashboard_snapshot
    ),
    'provider_flags_snapshots', (
      select count(*) from analytics.provider_flags_snapshot
    )
  )
)) as reproducibility_snapshot;
