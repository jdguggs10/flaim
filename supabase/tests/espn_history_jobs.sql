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
end $authenticated_denials$;

reset role;

do $proof$
declare
  v_job uuid := gen_random_uuid();
  v_incremental uuid := gen_random_uuid();
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
    'public.finish_espn_history_job(uuid,text,text,text)',
    'execute'
  ) or not has_function_privilege(
    'service_role',
    'public.finish_espn_history_job(uuid,text,text,text)',
    'execute'
  ) then
    raise exception 'finish RPC ACL';
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
    '[{"leagueId":"league","sport":"football","seasonYear":2024}]',
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

  insert into public.espn_history_jobs (
    id, clerk_user_id, credential_updated_at, scan_version, mode, plan, planned_count
  ) values (
    v_incremental,
    'history_test',
    v_credential_updated_at,
    1,
    'incremental',
    jsonb_build_array(jsonb_build_object(
      'leagueId', 'league', 'sport', 'football', 'seasonYear', 2024
    )) || (
      select jsonb_agg(jsonb_build_object(
        'leagueId', 'x', 'sport', 'football', 'seasonYear', g
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
end $proof$;

rollback;
