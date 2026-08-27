-- Rollback-only contract proof for FLA-308 durable ESPN history jobs.
begin;

set local role anon;
do $anon_denials$
begin
  begin
    perform 1 from public.espn_history_jobs limit 1;
    raise exception 'anon select unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.espn_history_jobs (
      clerk_user_id, credential_updated_at, scan_version, mode
    ) values ('denied', now(), 1, 'full');
    raise exception 'anon insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.espn_history_jobs set status = 'failed' where false;
    raise exception 'anon update unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.espn_history_jobs where false;
    raise exception 'anon delete unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.finish_espn_history_job(gen_random_uuid(), 'failed', null, null);
    raise exception 'anon RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.persist_espn_league_with_lease(
      'denied', 'history:denied', 'league', 'football', 2024, 'team'
    );
    raise exception 'anon league persist RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_next_espn_history_backfill_job(1, now(), null);
    raise exception 'anon scheduled claim RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $anon_denials$;

reset role;
set local role authenticated;
do $authenticated_denials$
begin
  begin
    perform 1 from public.espn_history_jobs limit 1;
    raise exception 'authenticated select unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.espn_history_jobs (
      clerk_user_id, credential_updated_at, scan_version, mode
    ) values ('denied', now(), 1, 'full');
    raise exception 'authenticated insert unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.espn_history_jobs set status = 'failed' where false;
    raise exception 'authenticated update unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.espn_history_jobs where false;
    raise exception 'authenticated delete unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.advance_espn_history_job(
      gen_random_uuid(), now(), 0, 'skip',
      null, null, null, null, null, null, null, null
    );
    raise exception 'authenticated RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.claim_next_espn_history_backfill_job(1, now(), null);
    raise exception 'authenticated scheduled claim RPC unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $authenticated_denials$;

reset role;

do $proof$
declare
  v_job uuid := gen_random_uuid();
  v_incremental uuid := gen_random_uuid();
  v_terminal uuid := gen_random_uuid();
  v_lease_write_user text := 'history_lease_write_test';
  v_credential_updated_at timestamptz;
  v_outcome text;
  v_count integer;
begin
  if not (
    select relrowsecurity
    from pg_class
    where oid = 'public.espn_history_jobs'::regclass
  ) then
    raise exception 'RLS disabled';
  end if;
  if has_table_privilege('anon', 'public.espn_history_jobs', 'select')
    or has_table_privilege('authenticated', 'public.espn_history_jobs', 'insert') then
    raise exception 'browser role table access';
  end if;
  if not has_table_privilege('service_role', 'public.espn_history_jobs', 'select') then
    raise exception 'service role table access missing';
  end if;
  if has_function_privilege(
    'anon',
    'public.advance_espn_history_job(uuid,timestamp with time zone,integer,text,text,text,integer,text,text,text,text,text)',
    'execute'
  ) then
    raise exception 'anon advance RPC access';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.advance_espn_history_job(uuid,timestamp with time zone,integer,text,text,text,integer,text,text,text,text,text)',
    'execute'
  ) then
    raise exception 'service role advance RPC access missing';
  end if;
  if has_function_privilege(
    'anon',
    'public.claim_next_espn_history_backfill_job(integer,timestamp with time zone,text[])',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.claim_next_espn_history_backfill_job(integer,timestamp with time zone,text[])',
    'execute'
  ) then
    raise exception 'scheduled claim RPC ACL invalid';
  end if;
  if has_function_privilege(
    'anon',
    'public.finish_espn_history_job(uuid,text,text,text)',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.finish_espn_history_job(uuid,text,text,text)',
    'execute'
  ) then
    raise exception 'finish RPC ACL';
  end if;
  if has_function_privilege(
    'anon',
    'public.persist_espn_league_with_lease(text,text,text,text,integer,text,text,text)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'public.persist_espn_league_with_lease(text,text,text,text,integer,text,text,text)',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.persist_espn_league_with_lease(text,text,text,text,integer,text,text,text)',
    'execute'
  ) then
    raise exception 'league persist RPC ACL';
  end if;
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'advance_espn_history_job',
      'finish_espn_history_job',
      'persist_espn_league_with_lease'
    )
    and (p.prosecdef or not p.proconfig @> array['search_path=""']);
  if v_count <> 0 then
    raise exception 'history RPC security invoker or empty search path missing';
  end if;

  insert into public.espn_credentials (clerk_user_id, swid, s2, updated_at)
  values ('history_test', 'swid', 's2', now())
  returning updated_at into v_credential_updated_at;
  insert into public.provider_sync_state (
    clerk_user_id, provider, sync_lease_owner, sync_lease_expires_at
  ) values (
    'history_test', 'espn', 'history:' || v_job::text, now() + interval '1 hour'
  );
  insert into public.espn_history_jobs (
    id, clerk_user_id, credential_updated_at, scan_version, mode, plan, planned_count
  ) values (
    v_job,
    'history_test',
    v_credential_updated_at,
    1,
    'full',
    '[{"leagueId":"league","sport":"football","seasonYear":2024,"teamId":"team"}]',
    1
  );

  begin
    insert into public.espn_history_jobs (
      clerk_user_id, credential_updated_at, scan_version, mode
    ) values ('history_test', now(), 1, 'full');
    raise exception 'active uniqueness missing';
  exception when unique_violation then null;
  end;

  select outcome into v_outcome
  from public.advance_espn_history_job(
    v_job, v_credential_updated_at, -1, 'skip',
    null, null, null, null, null, null, null, null
  );
  if v_outcome <> 'plan_index_invalid' then
    raise exception 'negative plan index accepted: %', v_outcome;
  end if;

  select outcome into v_outcome
  from public.advance_espn_history_job(
    v_job, v_credential_updated_at, 99, 'skip',
    null, null, null, null, null, null, null, null
  );
  if v_outcome <> 'plan_index_invalid' then
    raise exception 'future plan index accepted: %', v_outcome;
  end if;

  select outcome into v_outcome
  from public.advance_espn_history_job(
    v_job, v_credential_updated_at, 0, 'invalid',
    null, null, null, null, null, null, null, null
  );
  if v_outcome <> 'invalid_action' then
    raise exception 'invalid action accepted: %', v_outcome;
  end if;

  select outcome into v_outcome
  from public.advance_espn_history_job(
    v_job, v_credential_updated_at, 0, 'persist',
    'wrong', 'football', 2024, 'team', 'Name', 'League', null, null
  );
  if v_outcome <> 'plan_identity_mismatch' then
    raise exception 'plan identity mismatch accepted: %', v_outcome;
  end if;

  select outcome into v_outcome
  from public.advance_espn_history_job(
    v_job, v_credential_updated_at, 0, 'persist',
    'league', 'football', 2024, 'wrong-team', 'Name', 'League', null, null
  );
  if v_outcome <> 'plan_identity_mismatch' then
    raise exception 'plan team identity mismatch accepted: %', v_outcome;
  end if;

  update public.espn_credentials
  set updated_at = v_credential_updated_at + interval '1 second'
  where clerk_user_id = 'history_test';
  select outcome into v_outcome
  from public.advance_espn_history_job(
    v_job, v_credential_updated_at, 0, 'skip',
    null, null, null, null, null, null, null, null
  );
  if v_outcome <> 'credential_changed' then
    raise exception 'credential fence failed: %', v_outcome;
  end if;
  update public.espn_credentials
  set updated_at = v_credential_updated_at
  where clerk_user_id = 'history_test';

  update public.provider_sync_state
  set sync_lease_owner = 'wrong-owner'
  where clerk_user_id = 'history_test' and provider = 'espn';
  select outcome into v_outcome
  from public.advance_espn_history_job(
    v_job, v_credential_updated_at, 0, 'skip',
    null, null, null, null, null, null, null, null
  );
  if v_outcome <> 'lease_lost' then
    raise exception 'wrong-owner lease fence failed: %', v_outcome;
  end if;
  update public.provider_sync_state
  set sync_lease_owner = 'history:' || v_job::text,
      sync_lease_expires_at = now() - interval '1 second'
  where clerk_user_id = 'history_test' and provider = 'espn';
  select outcome into v_outcome
  from public.advance_espn_history_job(
    v_job, v_credential_updated_at, 0, 'skip',
    null, null, null, null, null, null, null, null
  );
  if v_outcome <> 'lease_lost' then
    raise exception 'expired lease fence failed: %', v_outcome;
  end if;
  update public.provider_sync_state
  set sync_lease_expires_at = now() + interval '1 hour'
  where clerk_user_id = 'history_test' and provider = 'espn';

  select outcome into v_outcome
  from public.advance_espn_history_job(
    v_job, v_credential_updated_at, 0, 'persist',
    'league', 'football', 2024, 'team', 'Name', 'League', null, null
  );
  if v_outcome <> 'persisted' then
    raise exception 'full persist failed: %', v_outcome;
  end if;
  update public.espn_leagues
  set league_name = 'old'
  where clerk_user_id = 'history_test';
  update public.espn_history_jobs
  set cursor = 0, completed_count = 0
  where id = v_job;
  select outcome into v_outcome
  from public.advance_espn_history_job(
    v_job, v_credential_updated_at, 0, 'persist',
    'league', 'football', 2024, 'team', 'Name', 'Repaired', null, null
  );
  if (
    select league_name
    from public.espn_leagues
    where clerk_user_id = 'history_test'
  ) <> 'Repaired' then
    raise exception 'full repair failed';
  end if;
  select outcome into v_outcome
  from public.advance_espn_history_job(
    v_job, v_credential_updated_at, 0, 'skip',
    null, null, null, null, null, null, null, null
  );
  if v_outcome <> 'already_processed' then
    raise exception 'replay failed: %', v_outcome;
  end if;
  update public.espn_credentials
  set updated_at = v_credential_updated_at + interval '1 second'
  where clerk_user_id = 'history_test';
  select outcome into v_outcome
  from public.finish_espn_history_job(v_job, 'succeeded', null, null);
  if v_outcome <> 'credential_changed' then
    raise exception 'terminal credential fence failed: %', v_outcome;
  end if;
  update public.espn_credentials
  set updated_at = v_credential_updated_at
  where clerk_user_id = 'history_test';

  update public.provider_sync_state
  set sync_lease_owner = 'wrong-owner'
  where clerk_user_id = 'history_test' and provider = 'espn';
  select outcome into v_outcome
  from public.finish_espn_history_job(v_job, 'succeeded', null, null);
  if v_outcome <> 'lease_lost' then
    raise exception 'terminal lease fence failed: %', v_outcome;
  end if;
  update public.provider_sync_state
  set sync_lease_owner = 'history:' || v_job::text
  where clerk_user_id = 'history_test' and provider = 'espn';

  select outcome into v_outcome
  from public.finish_espn_history_job(v_job, 'succeeded', null, null);
  if v_outcome <> 'finished' then
    raise exception 'valid full completion failed: %', v_outcome;
  end if;
  if not exists (
    select 1
    from public.espn_history_jobs
    where id = v_job
      and status = 'succeeded'
      and finished_at is not null
      and cursor = planned_count
      and failed_count = 0
  ) then
    raise exception 'full completion marker invalid';
  end if;
  select outcome into v_outcome
  from public.finish_espn_history_job(v_job, 'succeeded', null, null);
  if v_outcome <> 'finished' then
    raise exception 'lost terminal response replay was not idempotent: %', v_outcome;
  end if;
  select outcome into v_outcome
  from public.finish_espn_history_job(v_job, 'cancelled', 'other_actor', 'Different terminal tuple');
  if v_outcome <> 'job_not_active' then
    raise exception 'different terminal actor was mistaken for replay: %', v_outcome;
  end if;

  insert into public.espn_history_jobs (
    id, clerk_user_id, credential_updated_at, scan_version, mode, plan, planned_count
  ) values (
    v_incremental,
    'history_test',
    v_credential_updated_at,
    1,
    'incremental',
    jsonb_build_array(jsonb_build_object(
      'leagueId', 'league', 'sport', 'football', 'seasonYear', 2024, 'teamId', 'team'
    )) || (
      select jsonb_agg(jsonb_build_object(
        'leagueId', 'x', 'sport', 'football', 'seasonYear', g, 'teamId', 'team'
      ))
      from generate_series(1, 28) g
    ),
    29
  );
  update public.provider_sync_state
  set sync_lease_owner = 'history:' || v_incremental::text,
      sync_lease_expires_at = now() + interval '1 hour'
  where clerk_user_id = 'history_test' and provider = 'espn';

  select outcome into v_outcome
  from public.advance_espn_history_job(
    v_incremental, v_credential_updated_at, 0, 'persist',
    'league', 'football', 2024, 'team', 'Name', 'No rewrite', null, null
  );
  if (
    select league_name
    from public.espn_leagues
    where clerk_user_id = 'history_test'
  ) <> 'Repaired' then
    raise exception 'incremental rewrote existing row';
  end if;
  select outcome into v_outcome
  from public.advance_espn_history_job(
    v_incremental, v_credential_updated_at, 1, 'skip',
    null, null, null, null, null, null, null, null
  );
  if v_outcome <> 'skipped' then
    raise exception 'skip failed: %', v_outcome;
  end if;
  for v_count in 1..26 loop
    perform public.advance_espn_history_job(
      v_incremental,
      v_credential_updated_at,
      v_count + 1,
      'fail',
      null, null, null, null, null, null,
      'failure_' || v_count::text,
      'message_' || v_count::text
    );
  end loop;
  if (
    select jsonb_array_length(failures)
    from public.espn_history_jobs
    where id = v_incremental
  ) <> 25 then
    raise exception 'failure cap invalid';
  end if;
  if (
    select failures -> 0 ->> 'index'
    from public.espn_history_jobs
    where id = v_incremental
  ) <> '3' or (
    select failures -> 24 ->> 'index'
    from public.espn_history_jobs
    where id = v_incremental
  ) <> '27' or (
    select failures -> 0 ->> 'code'
    from public.espn_history_jobs
    where id = v_incremental
  ) <> 'failure_2' or (
    select failures -> 24 ->> 'message'
    from public.espn_history_jobs
    where id = v_incremental
  ) <> 'message_26' then
    raise exception 'failure cap order or payload invalid';
  end if;

  select outcome into v_outcome
  from public.finish_espn_history_job(v_incremental, 'succeeded', null, null);
  if v_outcome <> 'completion_incomplete' then
    raise exception 'invalid successful completion accepted: %', v_outcome;
  end if;

  update public.provider_sync_state
  set sync_lease_expires_at = now() - interval '1 second'
  where clerk_user_id = 'history_test' and provider = 'espn';
  select outcome into v_outcome
  from public.advance_espn_history_job(
    v_incremental, v_credential_updated_at, 28, 'skip',
    null, null, null, null, null, null, null, null
  );
  if v_outcome <> 'lease_lost' then
    raise exception 'late lease fence failed: %', v_outcome;
  end if;
  update public.provider_sync_state
  set sync_lease_expires_at = now() + interval '1 hour'
  where clerk_user_id = 'history_test' and provider = 'espn';
  select outcome into v_outcome
  from public.advance_espn_history_job(
    v_incremental, v_credential_updated_at, 28, 'skip',
    null, null, null, null, null, null, null, null
  );
  if v_outcome <> 'skipped' then
    raise exception 'final skip failed: %', v_outcome;
  end if;
  select outcome into v_outcome
  from public.finish_espn_history_job(
    v_incremental,
    'partial',
    'history_partial',
    'Some seasons were unavailable'
  );
  if v_outcome <> 'finished' then
    raise exception 'valid partial completion failed: %', v_outcome;
  end if;
  if not exists (
    select 1
    from public.espn_history_jobs
    where id = v_incremental
      and status = 'partial'
      and finished_at is not null
      and cursor = planned_count
      and failed_count = 26
      and last_error_code = 'history_partial'
      and last_error_message = 'Some seasons were unavailable'
  ) then
    raise exception 'partial completion marker invalid';
  end if;

  insert into public.espn_history_jobs (
    id, clerk_user_id, credential_updated_at, scan_version, mode
  ) values (
    v_terminal, 'history_test', v_credential_updated_at, 1, 'full'
  );
  update public.espn_credentials
  set updated_at = v_credential_updated_at + interval '1 second'
  where clerk_user_id = 'history_test';
  update public.provider_sync_state
  set sync_lease_owner = 'wrong-owner',
      sync_lease_expires_at = now() - interval '1 second'
  where clerk_user_id = 'history_test' and provider = 'espn';
  select outcome into v_outcome
  from public.finish_espn_history_job(v_terminal, 'failed', 'handoff_failed', 'Fence lost');
  if v_outcome <> 'finished' then
    raise exception 'failed job was not terminalizable after fence loss: %', v_outcome;
  end if;

  insert into public.provider_sync_state (
    clerk_user_id, provider, sync_lease_owner, sync_lease_expires_at
  ) values (
    v_lease_write_user, 'espn', 'history:valid', now() + interval '1 hour'
  );
  select outcome into v_outcome
  from public.persist_espn_league_with_lease(
    v_lease_write_user, 'history:valid', 'lease-league', 'football', null,
    'lease-team', 'Lease Team', 'Lease League'
  );
  if v_outcome <> 'invalid_identity' then
    raise exception 'null season identity was accepted: %', v_outcome;
  end if;
  select outcome into v_outcome
  from public.persist_espn_league_with_lease(
    v_lease_write_user, 'history:wrong', 'lease-league', 'football', 2024,
    'lease-team', 'Lease Team', 'Lease League'
  );
  if v_outcome <> 'lease_lost' then
    raise exception 'exact lease owner was not required: %', v_outcome;
  end if;
  update public.provider_sync_state
  set sync_lease_expires_at = now() - interval '1 second'
  where clerk_user_id = v_lease_write_user and provider = 'espn';
  select outcome into v_outcome
  from public.persist_espn_league_with_lease(
    v_lease_write_user, 'history:valid', 'lease-league', 'football', 2024,
    'lease-team', 'Lease Team', 'Lease League'
  );
  if v_outcome <> 'lease_lost' then
    raise exception 'expired lease owner was accepted: %', v_outcome;
  end if;
  update public.provider_sync_state
  set sync_lease_expires_at = now() + interval '1 hour'
  where clerk_user_id = v_lease_write_user and provider = 'espn';
  select outcome into v_outcome
  from public.persist_espn_league_with_lease(
    v_lease_write_user, 'history:valid', 'lease-league', 'football', 2024,
    'lease-team', 'Lease Team', 'Lease League'
  );
  if v_outcome <> 'added' then
    raise exception 'lease-fenced add failed: %', v_outcome;
  end if;
  select outcome into v_outcome
  from public.persist_espn_league_with_lease(
    v_lease_write_user, 'history:valid', 'lease-league', 'football', 2024,
    'lease-team-2', 'Lease Team 2', 'Lease League 2'
  );
  if v_outcome <> 'refreshed' then
    raise exception 'lease-fenced refresh failed: %', v_outcome;
  end if;
  if not exists (
    select 1
    from public.espn_leagues
    where clerk_user_id = v_lease_write_user
      and league_id = 'lease-league'
      and sport = 'football'
      and season_year = 2024
      and team_id = 'lease-team-2'
      and league_name = 'Lease League 2'
  ) then
    raise exception 'lease-fenced refresh did not persist the new league values';
  end if;
end $proof$;

do $scheduled_claim_guards$
declare
  v_outcome text;
  v_job uuid;
  v_snapshot timestamptz;
begin
  -- Malformed-only roots do not enter the cohort or overflow season conversion.
  insert into public.espn_credentials (clerk_user_id, swid, s2, updated_at)
  values ('claim_invalid_year', 'swid', 's2', now());
  insert into public.espn_leagues (clerk_user_id, league_id, sport, team_id, season_year, created_at)
  values ('claim_invalid_year', '400', 'basketball', '1', 2147483647, now() - interval '2 days');
  select outcome into v_outcome
  from public.claim_next_espn_history_backfill_job(41, now() - interval '1 hour', array['claim_invalid_year']);
  if v_outcome <> 'none' then raise exception 'invalid-only season root was eligible: %', v_outcome; end if;

  -- A completed full marker excludes the account even after credentials rotate.
  insert into public.espn_credentials (clerk_user_id, swid, s2, updated_at)
  values ('claim_marker', 'swid', 's2', now()) returning updated_at into v_snapshot;
  insert into public.espn_leagues (clerk_user_id, league_id, sport, team_id, season_year, created_at)
  values ('claim_marker', '401', 'football', '1', 2024, now() - interval '2 days');
  insert into public.espn_history_jobs (clerk_user_id, credential_updated_at, scan_version, mode, status, finished_at)
  values ('claim_marker', v_snapshot, 41, 'full', 'succeeded', now() - interval '2 days');
  update public.espn_credentials set updated_at = now() + interval '1 second'
  where clerk_user_id = 'claim_marker';
  select outcome into v_outcome from public.claim_next_espn_history_backfill_job(41, now() - interval '1 hour', array['claim_marker']);
  if v_outcome <> 'none' then raise exception 'completed marker was not excluded: %', v_outcome; end if;

  -- A live provider lease excludes an otherwise valid candidate.
  insert into public.espn_credentials (clerk_user_id, swid, s2, updated_at)
  values ('claim_live_lease', 'swid', 's2', now()) returning updated_at into v_snapshot;
  insert into public.espn_leagues (clerk_user_id, league_id, sport, team_id, season_year, created_at)
  values ('claim_live_lease', '402', 'football', '1', 2024, now() - interval '2 days');
  insert into public.provider_sync_state (clerk_user_id, provider, sync_lease_owner, sync_lease_expires_at)
  values ('claim_live_lease', 'espn', 'refresh:other', now() + interval '1 hour');
  select outcome into v_outcome from public.claim_next_espn_history_backfill_job(41, now() - interval '1 hour', array['claim_live_lease']);
  if v_outcome <> 'none' then raise exception 'active provider lease was not excluded: %', v_outcome; end if;

  -- Three non-control scheduled attempts exhaust this exact credential version.
  insert into public.espn_credentials (clerk_user_id, swid, s2, updated_at)
  values ('claim_attempt_cap', 'swid', 's2', now()) returning updated_at into v_snapshot;
  insert into public.espn_leagues (clerk_user_id, league_id, sport, team_id, season_year, created_at)
  values ('claim_attempt_cap', '403', 'football', '1', 2024, now() - interval '2 days');
  insert into public.espn_history_jobs (clerk_user_id, credential_updated_at, scan_version, mode, trigger_source, status, last_error_code, created_at, finished_at)
  select 'claim_attempt_cap', v_snapshot, 41, 'full', 'scheduled_backfill', 'failed', 'season_failed', now() - interval '2 days', now() - interval '2 days'
  from generate_series(1, 3);
  select outcome into v_outcome from public.claim_next_espn_history_backfill_job(41, now() - interval '1 hour', array['claim_attempt_cap']);
  if v_outcome <> 'none' then raise exception 'three-attempt cap was not enforced: %', v_outcome; end if;

  -- Auth failures and supersession park the snapshot even after their normal retry window.
  insert into public.espn_credentials (clerk_user_id, swid, s2, updated_at)
  values ('claim_auth_parked', 'swid', 's2', now()) returning updated_at into v_snapshot;
  insert into public.espn_leagues (clerk_user_id, league_id, sport, team_id, season_year, created_at)
  values ('claim_auth_parked', '404', 'football', '1', 2024, now() - interval '2 days');
  insert into public.espn_history_jobs (clerk_user_id, credential_updated_at, scan_version, mode, trigger_source, status, last_error_code, created_at, finished_at)
  values ('claim_auth_parked', v_snapshot, 41, 'full', 'scheduled_backfill', 'failed', 'espn_auth_failed', now() - interval '2 days', now() - interval '2 days');
  select outcome into v_outcome from public.claim_next_espn_history_backfill_job(41, now() - interval '1 hour', array['claim_auth_parked']);
  if v_outcome <> 'none' then raise exception 'auth failure did not park snapshot: %', v_outcome; end if;

  insert into public.espn_credentials (clerk_user_id, swid, s2, updated_at)
  values ('claim_credentials_parked', 'swid', 's2', now()) returning updated_at into v_snapshot;
  insert into public.espn_leagues (clerk_user_id, league_id, sport, team_id, season_year, created_at)
  values ('claim_credentials_parked', '408', 'football', '1', 2024, now() - interval '2 days');
  insert into public.espn_history_jobs (clerk_user_id, credential_updated_at, scan_version, mode, trigger_source, status, last_error_code, created_at, finished_at)
  values ('claim_credentials_parked', v_snapshot, 41, 'full', 'scheduled_backfill', 'failed', 'credentials_changed', now() - interval '2 days', now() - interval '2 days');
  select outcome into v_outcome from public.claim_next_espn_history_backfill_job(41, now() - interval '1 hour', array['claim_credentials_parked']);
  if v_outcome <> 'none' then raise exception 'credential rotation failure did not park snapshot: %', v_outcome; end if;

  insert into public.espn_credentials (clerk_user_id, swid, s2, updated_at)
  values ('claim_superseded', 'swid', 's2', now()) returning updated_at into v_snapshot;
  insert into public.espn_leagues (clerk_user_id, league_id, sport, team_id, season_year, created_at)
  values ('claim_superseded', '405', 'football', '1', 2024, now() - interval '2 days');
  insert into public.espn_history_jobs (clerk_user_id, credential_updated_at, scan_version, mode, trigger_source, status, created_at, finished_at)
  values ('claim_superseded', v_snapshot, 41, 'full', 'scheduled_backfill', 'superseded', now() - interval '2 days', now() - interval '2 days');
  select outcome into v_outcome from public.claim_next_espn_history_backfill_job(41, now() - interval '1 hour', array['claim_superseded']);
  if v_outcome <> 'none' then raise exception 'supersession did not park snapshot: %', v_outcome; end if;

  -- Ordinary terminal failures wait 24h; history_disabled cancellations are controls, not retries.
  insert into public.espn_credentials (clerk_user_id, swid, s2, updated_at)
  values ('claim_recent_failure', 'swid', 's2', now()) returning updated_at into v_snapshot;
  insert into public.espn_leagues (clerk_user_id, league_id, sport, team_id, season_year, created_at)
  values ('claim_recent_failure', '406', 'football', '1', 2024, now() - interval '2 days');
  insert into public.espn_history_jobs (clerk_user_id, credential_updated_at, scan_version, mode, trigger_source, status, last_error_code, created_at, finished_at)
  values ('claim_recent_failure', v_snapshot, 41, 'full', 'scheduled_backfill', 'failed', 'season_failed', now() - interval '2 days', now() - interval '1 hour');
  select outcome into v_outcome from public.claim_next_espn_history_backfill_job(41, now() - interval '1 hour', array['claim_recent_failure']);
  if v_outcome <> 'none' then raise exception 'recent ordinary failure was retried: %', v_outcome; end if;

  insert into public.espn_credentials (clerk_user_id, swid, s2, updated_at)
  values ('claim_disabled_control', 'swid', 's2', now()) returning updated_at into v_snapshot;
  insert into public.espn_leagues (clerk_user_id, league_id, sport, team_id, season_year, created_at)
  values ('claim_disabled_control', '407', 'football', '1', 2024, now() - interval '2 days');
  insert into public.espn_history_jobs (clerk_user_id, credential_updated_at, scan_version, mode, trigger_source, status, last_error_code, created_at, finished_at)
  select 'claim_disabled_control', v_snapshot, 41, 'full', 'scheduled_backfill', 'cancelled', 'history_disabled', now() - interval '2 days', now() - interval '1 hour'
  from generate_series(1, 3);
  select outcome, job_id into v_outcome, v_job from public.claim_next_espn_history_backfill_job(41, now() - interval '1 hour', array['claim_disabled_control']);
  if v_outcome <> 'claimed' then raise exception 'history_disabled controls exhausted retries: %', v_outcome; end if;
  update public.espn_history_jobs set status = 'cancelled', last_error_code = 'history_disabled', created_at = now() - interval '6 minutes', finished_at = now() - interval '6 minutes' where id = v_job;
  update public.provider_sync_state set sync_lease_expires_at = now() - interval '1 second' where clerk_user_id = 'claim_disabled_control' and provider = 'espn';

  -- The global active job and five-minute creation spacing stop concurrent dispatch.
  insert into public.espn_history_jobs (clerk_user_id, credential_updated_at, scan_version, mode, trigger_source)
  values ('claim_global_active', now() - interval '2 days', 41, 'full', 'scheduled_backfill') returning id into v_job;
  select outcome into v_outcome from public.claim_next_espn_history_backfill_job(41, now() - interval '1 hour', array['no_candidate']);
  if v_outcome <> 'busy' then raise exception 'global active serialization missing: %', v_outcome; end if;
  update public.espn_history_jobs set status = 'cancelled', last_error_code = 'history_disabled', created_at = now() - interval '6 minutes', finished_at = now() - interval '6 minutes' where id = v_job;
  insert into public.espn_history_jobs (clerk_user_id, credential_updated_at, scan_version, mode, trigger_source, status, last_error_code, created_at, finished_at)
  values ('claim_spacing', now() - interval '2 days', 41, 'full', 'scheduled_backfill', 'cancelled', 'history_disabled', now() - interval '1 minute', now() - interval '1 minute') returning id into v_job;
  select outcome into v_outcome from public.claim_next_espn_history_backfill_job(41, now() - interval '1 hour', array['no_candidate']);
  if v_outcome <> 'busy' then raise exception 'five-minute claim spacing missing: %', v_outcome; end if;
  update public.espn_history_jobs set created_at = now() - interval '6 minutes', finished_at = now() - interval '6 minutes' where id = v_job;

  -- A recent upstream planning/chunk failure pauses every new scheduled claim for 15 minutes.
  insert into public.espn_history_jobs (clerk_user_id, credential_updated_at, scan_version, mode, trigger_source, status, last_error_code, created_at, finished_at)
  values ('claim_global_pause', now() - interval '2 days', 41, 'full', 'scheduled_backfill', 'failed', 'history_plan_failed', now() - interval '6 minutes', now()) returning id into v_job;
  select outcome into v_outcome from public.claim_next_espn_history_backfill_job(41, now() - interval '1 hour', array['no_candidate']);
  if v_outcome <> 'busy' then raise exception 'global upstream pause missing: %', v_outcome; end if;
  update public.espn_history_jobs set finished_at = now() - interval '16 minutes' where id = v_job;

  -- Queued jobs recover after 10m; running jobs remain protected until 1h.
  insert into public.espn_history_jobs (clerk_user_id, credential_updated_at, scan_version, mode, trigger_source, updated_at)
  values ('claim_stale_queued', now() - interval '2 days', 41, 'full', 'scheduled_backfill', now() - interval '11 minutes') returning id into v_job;
  insert into public.provider_sync_state (clerk_user_id, provider, sync_lease_owner, sync_lease_expires_at)
  values ('claim_stale_queued', 'espn', 'history:' || v_job::text, now() + interval '1 hour');
  perform public.claim_next_espn_history_backfill_job(41, now() - interval '1 hour', array['no_candidate']);
  if (select status from public.espn_history_jobs where id = v_job) <> 'failed'
    or exists (select 1 from public.provider_sync_state where clerk_user_id = 'claim_stale_queued' and sync_lease_owner is not null) then
    raise exception 'stale queued recovery threshold or lease release failed';
  end if;
  update public.espn_history_jobs set created_at = now() - interval '6 minutes', finished_at = now() - interval '6 minutes' where id = v_job;
  insert into public.espn_history_jobs (clerk_user_id, credential_updated_at, scan_version, mode, trigger_source, status, updated_at)
  values ('claim_running_threshold', now() - interval '2 days', 41, 'full', 'scheduled_backfill', 'running', now() - interval '59 minutes') returning id into v_job;
  select outcome into v_outcome from public.claim_next_espn_history_backfill_job(41, now() - interval '1 hour', array['no_candidate']);
  if v_outcome <> 'busy' then raise exception 'running job recovered before one-hour threshold: %', v_outcome; end if;
  update public.espn_history_jobs set updated_at = now() - interval '61 minutes' where id = v_job;
  perform public.claim_next_espn_history_backfill_job(41, now() - interval '1 hour', array['no_candidate']);
  if (select status from public.espn_history_jobs where id = v_job) <> 'failed' then
    raise exception 'stale running job was not recovered after one hour';
  end if;
  update public.espn_history_jobs
  set created_at = now() - interval '6 minutes', finished_at = now() - interval '6 minutes'
  where id = v_job;
end $scheduled_claim_guards$;

-- The deployed workers invoke these invoker functions as service_role. Use
-- named arguments for a real, state-changing call to prove that contract.
set local role service_role;
do $service_role_proof$
declare
  v_job uuid := gen_random_uuid();
  v_credential_updated_at timestamptz;
  v_outcome text;
  v_claimed_job uuid;
  v_claimed_leagues jsonb;
begin
  insert into public.espn_credentials (clerk_user_id, swid, s2, updated_at)
  values ('history_service_role_test', 'swid', 's2', now())
  returning updated_at into v_credential_updated_at;
  insert into public.provider_sync_state (
    clerk_user_id, provider, sync_lease_owner, sync_lease_expires_at
  ) values (
    'history_service_role_test', 'espn', 'history:' || v_job::text,
    now() + interval '1 hour'
  );
  insert into public.espn_history_jobs (
    id, clerk_user_id, credential_updated_at, scan_version, mode, plan, planned_count
  ) values (
    v_job,
    'history_service_role_test',
    v_credential_updated_at,
    1,
    'full',
    '[{"leagueId":"service-league","sport":"football","seasonYear":2024,"teamId":"service-team"}]',
    1
  );

  select outcome into v_outcome
  from public.advance_espn_history_job(
    p_job_id => v_job,
    p_credential_updated_at => v_credential_updated_at,
    p_plan_index => 0,
    p_action => 'skip'
  );
  if v_outcome <> 'skipped' then
    raise exception 'service_role named advance failed: %', v_outcome;
  end if;

  select outcome into v_outcome
  from public.finish_espn_history_job(
    p_job_id => v_job,
    p_status => 'succeeded'
  );
  if v_outcome <> 'finished' then
    raise exception 'service_role named finish failed: %', v_outcome;
  end if;

  select outcome into v_outcome
  from public.persist_espn_league_with_lease(
    p_clerk_user_id => 'history_service_role_test',
    p_lease_owner => 'history:' || v_job::text,
    p_league_id => 'service-league',
    p_sport => 'football',
    p_season_year => 2024,
    p_team_id => 'service-team',
    p_team_name => 'Service Team',
    p_league_name => 'Service League'
  );
  if v_outcome <> 'added' then
    raise exception 'service_role named league persist failed: %', v_outcome;
  end if;

  insert into public.espn_credentials (clerk_user_id, swid, s2, updated_at)
  values ('history_scheduled_claim_test', 'swid', 's2', now());
  insert into public.espn_leagues (
    clerk_user_id, league_id, sport, team_id, league_name, season_year, created_at
  ) values
    ('history_scheduled_claim_test', '100', 'football', '12', 'Older', 2023, now() - interval '2 days'),
    ('history_scheduled_claim_test', '100', 'football', '12', 'Newest pre-cutoff', 2024, now() - interval '1 day'),
    ('history_scheduled_claim_test', '100', 'football', '12', 'Post-cutoff', 2025, now()),
    ('history_scheduled_claim_test', '200', 'basketball', '34', 'Hoops', 2024, now() - interval '1 day'),
    ('history_scheduled_claim_test', '300', 'hockey', '56', 'Hidden', 2024, now() - interval '1 day'),
    ('history_scheduled_claim_test', '400', 'basketball', '78', 'Invalid Year', 2147483647, now() - interval '1 day');
  insert into public.archived_leagues (clerk_user_id, platform, sport, recurring_league_id, mode)
  values ('history_scheduled_claim_test', 'espn', 'hockey', '300', 'hidden');

  select outcome, job_id, current_leagues into v_outcome, v_claimed_job, v_claimed_leagues
  from public.claim_next_espn_history_backfill_job(
    p_scan_version => 19,
    p_legacy_cutoff => now() - interval '1 hour',
    p_allowed_users => array['history_scheduled_claim_test']
  );
  if v_outcome <> 'claimed'
    or v_claimed_job is null
    or jsonb_array_length(v_claimed_leagues) <> 2
    or v_claimed_leagues @> '[{"gameId":"fhl"}]'::jsonb
    or not v_claimed_leagues @> '[{"gameId":"fba","seasonId":2025,"leagueId":"200","teamId":34}]'::jsonb
    or not v_claimed_leagues @> '[{"gameId":"ffl","seasonId":2024,"leagueId":"100","leagueName":"Newest pre-cutoff","teamId":12}]'::jsonb
    or v_claimed_leagues @> '[{"leagueId":"100","seasonId":2025}]'::jsonb
    or v_claimed_leagues @> '[{"leagueId":"400"}]'::jsonb then
    raise exception 'scheduled claim root conversion, dedupe, or hidden exclusion failed: %, %', v_outcome, v_claimed_leagues;
  end if;
  if (select trigger_source from public.espn_history_jobs where id = v_claimed_job) <> 'scheduled_backfill'
    or (select sync_lease_owner from public.provider_sync_state where clerk_user_id = 'history_scheduled_claim_test' and provider = 'espn') <> 'history:' || v_claimed_job::text then
    raise exception 'scheduled claim job source or exact lease missing';
  end if;
end $service_role_proof$;
reset role;

rollback;
