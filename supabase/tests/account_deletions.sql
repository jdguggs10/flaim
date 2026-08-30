-- Rollback-only contract proof for FLA-311 self-service account deletion.
begin;

set local role anon;
do $anon_denials$
begin
  begin
    perform 1 from public.account_deletions limit 1;
    raise exception 'anon select unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.account_deletions (clerk_user_id) values ('denied');
    raise exception 'anon insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.account_deletions set deleted_at = now() where false;
    raise exception 'anon update unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.account_deletions where false;
    raise exception 'anon delete unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.purge_account_data('denied');
    raise exception 'anon purge RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.account_deletion_lock_key('denied');
    raise exception 'anon lock-key RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $anon_denials$;

reset role;
set local role authenticated;
do $authenticated_denials$
begin
  begin
    perform 1 from public.account_deletions limit 1;
    raise exception 'authenticated select unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.account_deletions (clerk_user_id) values ('denied');
    raise exception 'authenticated insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.purge_account_data('denied');
    raise exception 'authenticated purge RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.account_deletion_lock_key('denied');
    raise exception 'authenticated lock-key RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $authenticated_denials$;

reset role;

do $acl_proof$
declare
  v_count integer;
begin
  if not (
    select relrowsecurity
    from pg_class
    where oid = 'public.account_deletions'::regclass
  ) then
    raise exception 'RLS disabled on account_deletions';
  end if;
  if has_table_privilege('anon', 'public.account_deletions', 'select')
    or has_table_privilege('authenticated', 'public.account_deletions', 'insert') then
    raise exception 'browser role table access on account_deletions';
  end if;
  if not has_table_privilege('service_role', 'public.account_deletions', 'select')
    or not has_table_privilege('service_role', 'public.account_deletions', 'insert') then
    raise exception 'service role table access missing on account_deletions';
  end if;
  -- GRANT is additive and the baseline migration default-grants service_role
  -- ALL on every new public table; the migration must revoke that inherited
  -- ALL before granting SELECT/INSERT, or the tombstone stays mutable.
  if has_table_privilege('service_role', 'public.account_deletions', 'update')
    or has_table_privilege('service_role', 'public.account_deletions', 'delete')
    or has_table_privilege('service_role', 'public.account_deletions', 'truncate') then
    raise exception 'service role retains mutating privileges on account_deletions (baseline default grants not revoked)';
  end if;

  if has_function_privilege('anon', 'public.purge_account_data(text)', 'execute')
    or has_function_privilege('authenticated', 'public.purge_account_data(text)', 'execute')
    or not has_function_privilege('service_role', 'public.purge_account_data(text)', 'execute') then
    raise exception 'purge_account_data RPC ACL invalid';
  end if;

  if has_function_privilege('anon', 'public.account_deletion_lock_key(text)', 'execute')
    or has_function_privilege('authenticated', 'public.account_deletion_lock_key(text)', 'execute')
    or not has_function_privilege('service_role', 'public.account_deletion_lock_key(text)', 'execute') then
    raise exception 'account_deletion_lock_key RPC ACL invalid';
  end if;

  if has_function_privilege('anon', 'public.reject_write_after_account_deletion()', 'execute')
    or has_function_privilege('authenticated', 'public.reject_write_after_account_deletion()', 'execute')
    or not has_function_privilege('service_role', 'public.reject_write_after_account_deletion()', 'execute') then
    raise exception 'reject_write_after_account_deletion RPC ACL invalid';
  end if;

  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'purge_account_data',
      'account_deletion_lock_key',
      'reject_write_after_account_deletion'
    )
    and (p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false));
  if v_count <> 0 then
    raise exception 'account deletion function security invoker or empty search path missing';
  end if;

  -- Both call sites must route through the one shared lock-key helper, or
  -- the purge RPC and the guard trigger can silently acquire different locks.
  if pg_get_functiondef('public.purge_account_data(text)'::regprocedure)
      not like '%account_deletion_lock_key%'
    or pg_get_functiondef('public.reject_write_after_account_deletion()'::regprocedure)
      not like '%account_deletion_lock_key%' then
    raise exception 'purge RPC and guard trigger do not share the same lock-key helper';
  end if;

  -- All 13 in-scope tables must carry the guard trigger; oauth_states must not.
  if exists (
    select 1 from unnest(array[
      'espn_credentials','espn_leagues','espn_history_jobs',
      'yahoo_credentials','yahoo_leagues','platform_oauth_states',
      'sleeper_connections','sleeper_leagues','archived_leagues',
      'provider_sync_state','user_preferences','oauth_tokens','oauth_codes'
    ]) as t(table_name)
    where not exists (
      select 1 from pg_trigger trig
      join pg_class c on c.oid = trig.tgrelid
      where c.relname = t.table_name
        and trig.tgname = 'reject_write_after_account_deletion'
        and not trig.tgisinternal
    )
  ) then
    raise exception 'a guarded table is missing its reject_write_after_account_deletion trigger';
  end if;
  if exists (
    select 1 from pg_trigger trig
    join pg_class c on c.oid = trig.tgrelid
    where c.relname = 'oauth_states'
      and trig.tgname = 'reject_write_after_account_deletion'
  ) then
    raise exception 'oauth_states must not carry the guard trigger';
  end if;
end $acl_proof$;

-- The deployed auth-worker invokes purge_account_data as service_role, and
-- the guard trigger only ever actually fires under service_role writes
-- (anon/authenticated cannot write to any of the 13 guarded tables today --
-- see discrepancy #3 in the spec header). Prove the real contract here.
set local role service_role;
do $service_role_proof$
declare
  v_deleted_user text := 'account_deletion_test_deleted';
  v_live_user text := 'account_deletion_test_live';
  v_never_existed_user text := 'account_deletion_test_never_existed';
  v_credential_updated_at timestamptz;
begin
  -- Seed one row per in-scope table for the user who will be purged.
  insert into public.espn_credentials (clerk_user_id, swid, s2, updated_at)
  values (v_deleted_user, 'swid', 's2', now())
  returning updated_at into v_credential_updated_at;
  insert into public.espn_leagues (clerk_user_id, league_id, sport, team_id, season_year)
  values (v_deleted_user, 'league', 'football', 'team', 2024);
  insert into public.espn_history_jobs (clerk_user_id, credential_updated_at, scan_version, mode)
  values (v_deleted_user, v_credential_updated_at, 1, 'full');
  insert into public.yahoo_credentials (clerk_user_id, access_token, refresh_token, expires_at)
  values (v_deleted_user, 'yat', 'yrt', now() + interval '1 hour');
  insert into public.yahoo_leagues (clerk_user_id, sport, season_year, league_key, league_name)
  values (v_deleted_user, 'football', 2024, 'yahoo-key', 'Yahoo League');
  insert into public.platform_oauth_states (state, platform, clerk_user_id, expires_at)
  values ('state-' || v_deleted_user, 'yahoo', v_deleted_user, now() + interval '1 hour');
  insert into public.sleeper_connections (clerk_user_id, sleeper_user_id)
  values (v_deleted_user, 'sleeper-uid');
  insert into public.sleeper_leagues (clerk_user_id, league_id, sport, season_year, league_name, sleeper_user_id)
  values (v_deleted_user, 'sleeper-league', 'football', 2024, 'Sleeper League', 'sleeper-uid');
  insert into public.archived_leagues (clerk_user_id, platform, sport, recurring_league_id)
  values (v_deleted_user, 'espn', 'football', 'league');
  insert into public.provider_sync_state (clerk_user_id, provider)
  values (v_deleted_user, 'espn');
  insert into public.user_preferences (clerk_user_id)
  values (v_deleted_user);
  insert into public.oauth_tokens (access_token, user_id, expires_at)
  values ('at-' || v_deleted_user, v_deleted_user, now() + interval '1 hour');
  insert into public.oauth_codes (code, user_id, redirect_uri, expires_at)
  values ('code-' || v_deleted_user, v_deleted_user, 'https://example.com/callback', now() + interval '1 hour');

  -- A non-tombstoned control user gets the identical row set.
  insert into public.espn_credentials (clerk_user_id, swid, s2)
  values (v_live_user, 'swid', 's2');
  insert into public.espn_leagues (clerk_user_id, league_id, sport, team_id, season_year)
  values (v_live_user, 'league', 'football', 'team', 2024);
  insert into public.espn_history_jobs (clerk_user_id, credential_updated_at, scan_version, mode)
  values (v_live_user, now(), 1, 'full');
  insert into public.yahoo_credentials (clerk_user_id, access_token, refresh_token, expires_at)
  values (v_live_user, 'yat', 'yrt', now() + interval '1 hour');
  insert into public.yahoo_leagues (clerk_user_id, sport, season_year, league_key, league_name)
  values (v_live_user, 'football', 2024, 'yahoo-key', 'Yahoo League');
  insert into public.platform_oauth_states (state, platform, clerk_user_id, expires_at)
  values ('state-' || v_live_user, 'yahoo', v_live_user, now() + interval '1 hour');
  insert into public.sleeper_connections (clerk_user_id, sleeper_user_id)
  values (v_live_user, 'sleeper-uid-2');
  insert into public.sleeper_leagues (clerk_user_id, league_id, sport, season_year, league_name, sleeper_user_id)
  values (v_live_user, 'sleeper-league', 'football', 2024, 'Sleeper League', 'sleeper-uid-2');
  insert into public.archived_leagues (clerk_user_id, platform, sport, recurring_league_id)
  values (v_live_user, 'espn', 'football', 'league');
  insert into public.provider_sync_state (clerk_user_id, provider)
  values (v_live_user, 'espn');
  insert into public.user_preferences (clerk_user_id)
  values (v_live_user);
  insert into public.oauth_tokens (access_token, user_id, expires_at)
  values ('at-' || v_live_user, v_live_user, now() + interval '1 hour');
  insert into public.oauth_codes (code, user_id, redirect_uri, expires_at)
  values ('code-' || v_live_user, v_live_user, 'https://example.com/callback', now() + interval '1 hour');

  -- Purge the deleted user.
  perform public.purge_account_data(v_deleted_user);

  if not exists (select 1 from public.account_deletions where clerk_user_id = v_deleted_user) then
    raise exception 'tombstone was not written';
  end if;

  if exists (select 1 from public.espn_credentials where clerk_user_id = v_deleted_user)
    or exists (select 1 from public.espn_leagues where clerk_user_id = v_deleted_user)
    or exists (select 1 from public.espn_history_jobs where clerk_user_id = v_deleted_user)
    or exists (select 1 from public.yahoo_credentials where clerk_user_id = v_deleted_user)
    or exists (select 1 from public.yahoo_leagues where clerk_user_id = v_deleted_user)
    or exists (select 1 from public.platform_oauth_states where clerk_user_id = v_deleted_user)
    or exists (select 1 from public.sleeper_connections where clerk_user_id = v_deleted_user)
    or exists (select 1 from public.sleeper_leagues where clerk_user_id = v_deleted_user)
    or exists (select 1 from public.archived_leagues where clerk_user_id = v_deleted_user)
    or exists (select 1 from public.provider_sync_state where clerk_user_id = v_deleted_user)
    or exists (select 1 from public.user_preferences where clerk_user_id = v_deleted_user)
    or exists (select 1 from public.oauth_tokens where user_id = v_deleted_user)
    or exists (select 1 from public.oauth_codes where user_id = v_deleted_user) then
    raise exception 'purge left rows behind for %', v_deleted_user;
  end if;

  -- Post-tombstone INSERT is rejected on all 13 guarded tables.
  begin
    insert into public.espn_credentials (clerk_user_id, swid, s2) values (v_deleted_user, 'swid', 's2');
    raise exception using errcode = 'ZZ001', message = 'espn_credentials insert after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  begin
    insert into public.espn_leagues (clerk_user_id, league_id, sport, team_id, season_year)
    values (v_deleted_user, 'league2', 'football', 'team', 2024);
    raise exception using errcode = 'ZZ001', message = 'espn_leagues insert after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  begin
    insert into public.espn_history_jobs (clerk_user_id, credential_updated_at, scan_version, mode)
    values (v_deleted_user, now(), 1, 'full');
    raise exception using errcode = 'ZZ001', message = 'espn_history_jobs insert after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  begin
    insert into public.yahoo_credentials (clerk_user_id, access_token, refresh_token, expires_at)
    values (v_deleted_user, 'yat', 'yrt', now() + interval '1 hour');
    raise exception using errcode = 'ZZ001', message = 'yahoo_credentials insert after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  begin
    insert into public.yahoo_leagues (clerk_user_id, sport, season_year, league_key, league_name)
    values (v_deleted_user, 'football', 2024, 'yahoo-key-2', 'Yahoo League');
    raise exception using errcode = 'ZZ001', message = 'yahoo_leagues insert after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  begin
    insert into public.platform_oauth_states (state, platform, clerk_user_id, expires_at)
    values ('state-after-' || v_deleted_user, 'yahoo', v_deleted_user, now() + interval '1 hour');
    raise exception using errcode = 'ZZ001', message = 'platform_oauth_states insert after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  begin
    insert into public.sleeper_connections (clerk_user_id, sleeper_user_id)
    values (v_deleted_user, 'sleeper-uid-after');
    raise exception using errcode = 'ZZ001', message = 'sleeper_connections insert after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  begin
    insert into public.sleeper_leagues (clerk_user_id, league_id, sport, season_year, league_name, sleeper_user_id)
    values (v_deleted_user, 'sleeper-league-2', 'football', 2024, 'Sleeper League', 'sleeper-uid-after');
    raise exception using errcode = 'ZZ001', message = 'sleeper_leagues insert after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  begin
    insert into public.archived_leagues (clerk_user_id, platform, sport, recurring_league_id)
    values (v_deleted_user, 'espn', 'football', 'league-2');
    raise exception using errcode = 'ZZ001', message = 'archived_leagues insert after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  begin
    insert into public.provider_sync_state (clerk_user_id, provider)
    values (v_deleted_user, 'yahoo');
    raise exception using errcode = 'ZZ001', message = 'provider_sync_state insert after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  begin
    insert into public.user_preferences (clerk_user_id) values (v_deleted_user);
    raise exception using errcode = 'ZZ001', message = 'user_preferences insert after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  begin
    insert into public.oauth_tokens (access_token, user_id, expires_at)
    values ('at-after-' || v_deleted_user, v_deleted_user, now() + interval '1 hour');
    raise exception using errcode = 'ZZ001', message = 'oauth_tokens insert after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  begin
    insert into public.oauth_codes (code, user_id, redirect_uri, expires_at)
    values ('code-after-' || v_deleted_user, v_deleted_user, 'https://example.com/callback', now() + interval '1 hour');
    raise exception using errcode = 'ZZ001', message = 'oauth_codes insert after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;

  -- Post-tombstone UPDATE is rejected on all 13 guarded tables too -- the
  -- trigger is BEFORE INSERT OR UPDATE, and the function itself branches on
  -- neither TG_OP, but that's a code-reading inference, not proof by
  -- execution. A row-level UPDATE trigger only fires for rows an UPDATE
  -- actually matches, and the deleted user has zero rows left in any of
  -- these tables post-purge -- and can never gain one through the guarded
  -- path, since INSERT is rejected identically. So each fixture row here is
  -- planted with the trigger briefly disabled (never through the guarded
  -- path), the trigger is re-enabled, the UPDATE attempt is proven rejected,
  -- then the fixture is removed via DELETE, which this trigger never guards.
  -- Disabling/enabling a trigger is an ownership-level DDL operation --
  -- service_role's plain DML grants aren't enough, so this fixture-planting
  -- phase runs as the connection's own (superuser-equivalent) identity via
  -- dynamic SQL, then hands back to service_role for the actual assertions
  -- below, matching every other caller in this file.
  execute 'reset role';

  alter table public.espn_credentials disable trigger reject_write_after_account_deletion;
  insert into public.espn_credentials (clerk_user_id, swid, s2) values (v_deleted_user, 'swid', 's2');
  alter table public.espn_credentials enable trigger reject_write_after_account_deletion;

  alter table public.espn_leagues disable trigger reject_write_after_account_deletion;
  insert into public.espn_leagues (clerk_user_id, league_id, sport, team_id, season_year)
  values (v_deleted_user, 'league-upd', 'football', 'team', 2024);
  alter table public.espn_leagues enable trigger reject_write_after_account_deletion;

  alter table public.espn_history_jobs disable trigger reject_write_after_account_deletion;
  insert into public.espn_history_jobs (clerk_user_id, credential_updated_at, scan_version, mode)
  values (v_deleted_user, now(), 1, 'full');
  alter table public.espn_history_jobs enable trigger reject_write_after_account_deletion;

  alter table public.yahoo_credentials disable trigger reject_write_after_account_deletion;
  insert into public.yahoo_credentials (clerk_user_id, access_token, refresh_token, expires_at)
  values (v_deleted_user, 'yat', 'yrt', now() + interval '1 hour');
  alter table public.yahoo_credentials enable trigger reject_write_after_account_deletion;

  alter table public.yahoo_leagues disable trigger reject_write_after_account_deletion;
  insert into public.yahoo_leagues (clerk_user_id, sport, season_year, league_key, league_name)
  values (v_deleted_user, 'football', 2024, 'yahoo-key-upd', 'Yahoo League');
  alter table public.yahoo_leagues enable trigger reject_write_after_account_deletion;

  alter table public.platform_oauth_states disable trigger reject_write_after_account_deletion;
  insert into public.platform_oauth_states (state, platform, clerk_user_id, expires_at)
  values ('state-upd-' || v_deleted_user, 'yahoo', v_deleted_user, now() + interval '1 hour');
  alter table public.platform_oauth_states enable trigger reject_write_after_account_deletion;

  alter table public.sleeper_connections disable trigger reject_write_after_account_deletion;
  insert into public.sleeper_connections (clerk_user_id, sleeper_user_id) values (v_deleted_user, 'sleeper-uid-upd');
  alter table public.sleeper_connections enable trigger reject_write_after_account_deletion;

  alter table public.sleeper_leagues disable trigger reject_write_after_account_deletion;
  insert into public.sleeper_leagues (clerk_user_id, league_id, sport, season_year, league_name, sleeper_user_id)
  values (v_deleted_user, 'sleeper-league-upd', 'football', 2024, 'Sleeper League', 'sleeper-uid-upd');
  alter table public.sleeper_leagues enable trigger reject_write_after_account_deletion;

  alter table public.archived_leagues disable trigger reject_write_after_account_deletion;
  insert into public.archived_leagues (clerk_user_id, platform, sport, recurring_league_id)
  values (v_deleted_user, 'espn', 'football', 'league-upd');
  alter table public.archived_leagues enable trigger reject_write_after_account_deletion;

  alter table public.provider_sync_state disable trigger reject_write_after_account_deletion;
  insert into public.provider_sync_state (clerk_user_id, provider) values (v_deleted_user, 'sleeper');
  alter table public.provider_sync_state enable trigger reject_write_after_account_deletion;

  alter table public.user_preferences disable trigger reject_write_after_account_deletion;
  insert into public.user_preferences (clerk_user_id) values (v_deleted_user);
  alter table public.user_preferences enable trigger reject_write_after_account_deletion;

  alter table public.oauth_tokens disable trigger reject_write_after_account_deletion;
  insert into public.oauth_tokens (access_token, user_id, expires_at)
  values ('at-upd-' || v_deleted_user, v_deleted_user, now() + interval '1 hour');
  alter table public.oauth_tokens enable trigger reject_write_after_account_deletion;

  alter table public.oauth_codes disable trigger reject_write_after_account_deletion;
  insert into public.oauth_codes (code, user_id, redirect_uri, expires_at)
  values ('code-upd-' || v_deleted_user, v_deleted_user, 'https://example.com/callback', now() + interval '1 hour');
  alter table public.oauth_codes enable trigger reject_write_after_account_deletion;

  execute 'set local role service_role';

  begin
    update public.espn_credentials set email = 'x' where clerk_user_id = v_deleted_user;
    raise exception using errcode = 'ZZ001', message = 'espn_credentials update after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  delete from public.espn_credentials where clerk_user_id = v_deleted_user;

  begin
    update public.espn_leagues set team_name = 'x' where clerk_user_id = v_deleted_user;
    raise exception using errcode = 'ZZ001', message = 'espn_leagues update after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  delete from public.espn_leagues where clerk_user_id = v_deleted_user;

  begin
    update public.espn_history_jobs set status = 'running' where clerk_user_id = v_deleted_user;
    raise exception using errcode = 'ZZ001', message = 'espn_history_jobs update after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  delete from public.espn_history_jobs where clerk_user_id = v_deleted_user;

  begin
    update public.yahoo_credentials set access_token = 'x' where clerk_user_id = v_deleted_user;
    raise exception using errcode = 'ZZ001', message = 'yahoo_credentials update after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  delete from public.yahoo_credentials where clerk_user_id = v_deleted_user;

  begin
    update public.yahoo_leagues set team_name = 'x' where clerk_user_id = v_deleted_user;
    raise exception using errcode = 'ZZ001', message = 'yahoo_leagues update after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  delete from public.yahoo_leagues where clerk_user_id = v_deleted_user;

  begin
    update public.platform_oauth_states set redirect_after = '/x' where clerk_user_id = v_deleted_user;
    raise exception using errcode = 'ZZ001', message = 'platform_oauth_states update after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  delete from public.platform_oauth_states where clerk_user_id = v_deleted_user;

  begin
    update public.sleeper_connections set sleeper_username = 'x' where clerk_user_id = v_deleted_user;
    raise exception using errcode = 'ZZ001', message = 'sleeper_connections update after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  delete from public.sleeper_connections where clerk_user_id = v_deleted_user;

  begin
    update public.sleeper_leagues set league_name = 'x' where clerk_user_id = v_deleted_user;
    raise exception using errcode = 'ZZ001', message = 'sleeper_leagues update after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  delete from public.sleeper_leagues where clerk_user_id = v_deleted_user;

  begin
    update public.archived_leagues set league_name = 'x' where clerk_user_id = v_deleted_user;
    raise exception using errcode = 'ZZ001', message = 'archived_leagues update after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  delete from public.archived_leagues where clerk_user_id = v_deleted_user;

  begin
    update public.provider_sync_state set last_sync_source = 'x' where clerk_user_id = v_deleted_user;
    raise exception using errcode = 'ZZ001', message = 'provider_sync_state update after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  delete from public.provider_sync_state where clerk_user_id = v_deleted_user;

  begin
    update public.user_preferences set default_sport = 'baseball' where clerk_user_id = v_deleted_user;
    raise exception using errcode = 'ZZ001', message = 'user_preferences update after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  delete from public.user_preferences where clerk_user_id = v_deleted_user;

  begin
    update public.oauth_tokens set client_name = 'x' where user_id = v_deleted_user;
    raise exception using errcode = 'ZZ001', message = 'oauth_tokens update after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  delete from public.oauth_tokens where user_id = v_deleted_user;

  begin
    update public.oauth_codes set used_at = now() where user_id = v_deleted_user;
    raise exception using errcode = 'ZZ001', message = 'oauth_codes update after deletion unexpectedly succeeded';
  exception when others then
    if sqlstate <> 'P0001' then raise; end if;
  end;
  delete from public.oauth_codes where user_id = v_deleted_user;

  -- oauth_states has no guard trigger and must remain writable regardless.
  insert into public.oauth_states (state, redirect_uri, expires_at)
  values ('state-oauth-states-' || v_deleted_user, 'https://example.com/callback', now() + interval '1 hour');

  -- The live control user is unaffected: every table remains writable.
  update public.espn_credentials set email = 'still-live@example.com' where clerk_user_id = v_live_user;
  update public.espn_leagues set team_name = 'Still Live' where clerk_user_id = v_live_user;
  update public.espn_history_jobs set status = 'running' where clerk_user_id = v_live_user;
  update public.yahoo_credentials set access_token = 'yat2' where clerk_user_id = v_live_user;
  update public.yahoo_leagues set team_name = 'Still Live' where clerk_user_id = v_live_user;
  update public.platform_oauth_states set redirect_after = '/leagues' where clerk_user_id = v_live_user;
  update public.sleeper_connections set sleeper_username = 'still-live' where clerk_user_id = v_live_user;
  update public.sleeper_leagues set league_name = 'Still Live' where clerk_user_id = v_live_user;
  update public.archived_leagues set league_name = 'Still Live' where clerk_user_id = v_live_user;
  update public.provider_sync_state set last_sync_source = 'test' where clerk_user_id = v_live_user;
  update public.user_preferences set default_sport = 'football' where clerk_user_id = v_live_user;
  update public.oauth_tokens set client_name = 'Still Live' where user_id = v_live_user;
  update public.oauth_codes set used_at = now() where user_id = v_live_user;
  insert into public.espn_leagues (clerk_user_id, league_id, sport, team_id, season_year)
  values (v_live_user, 'league-new', 'football', 'team-2', 2024);

  -- Idempotent replay: purging an already-tombstoned user is a no-op that
  -- does not error and does not duplicate the tombstone.
  perform public.purge_account_data(v_deleted_user);
  if (select count(*) from public.account_deletions where clerk_user_id = v_deleted_user) <> 1 then
    raise exception 'replayed purge duplicated the tombstone';
  end if;

  -- A user who never had any rows purges cleanly too.
  perform public.purge_account_data(v_never_existed_user);
  if not exists (select 1 from public.account_deletions where clerk_user_id = v_never_existed_user) then
    raise exception 'purge of a never-existing user did not tombstone';
  end if;
end $service_role_proof$;
reset role;

rollback;
