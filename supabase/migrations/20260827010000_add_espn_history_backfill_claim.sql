-- Atomic, service-role-only scheduled ESPN history backfill claim (FLA-310).
alter table public.espn_history_jobs
  add column trigger_source text not null default 'user'
  check (trigger_source in ('user', 'scheduled_backfill'));

create unique index espn_history_jobs_one_active_scheduled_backfill
  on public.espn_history_jobs ((trigger_source))
  where trigger_source = 'scheduled_backfill'
    and status in ('queued', 'running');

create function public.claim_next_espn_history_backfill_job(
  p_scan_version integer,
  p_legacy_cutoff timestamptz,
  p_allowed_users text[] default null
)
returns table(outcome text, job_id uuid, clerk_user_id text, current_leagues jsonb)
language plpgsql security invoker set search_path = ''
as $$
declare
  v_candidate record;
  v_roots jsonb;
  v_job_id uuid := gen_random_uuid();
begin
  if p_scan_version is null or p_scan_version <= 0 then
    return query select 'invalid_scan_version'::text, null::uuid, null::text, null::jsonb;
    return;
  end if;
  if p_legacy_cutoff is null or p_legacy_cutoff > now() then
    return query select 'invalid_legacy_cutoff'::text, null::uuid, null::text, null::jsonb;
    return;
  end if;
  if not pg_try_advisory_xact_lock(308, 1) then
    return query select 'busy'::text, null::uuid, null::text, null::jsonb;
    return;
  end if;

  -- Release only the history lease belonging to a stale scheduled job.
  with stale as (
    update public.espn_history_jobs as jobs
    set status = 'failed', last_error_code = 'scheduled_backfill_stalled',
        last_error_message = 'Scheduled ESPN history claim did not start or renew.',
        finished_at = now(), updated_at = now()
    where jobs.trigger_source = 'scheduled_backfill'
      and (
        (jobs.status = 'queued' and jobs.updated_at < now() - interval '10 minutes')
        or (jobs.status = 'running' and jobs.updated_at < now() - interval '1 hour')
      )
    returning jobs.id, jobs.clerk_user_id
  )
  update public.provider_sync_state state
  set sync_lease_owner = null, sync_lease_expires_at = null, updated_at = now()
  from stale
  where state.clerk_user_id = stale.clerk_user_id
    and state.provider = 'espn'
    and state.sync_lease_owner = ('history:' || stale.id::text);

  if exists (
    select 1 from public.espn_history_jobs
    where trigger_source = 'scheduled_backfill' and status in ('queued', 'running')
  ) or exists (
    select 1 from public.espn_history_jobs
    where trigger_source = 'scheduled_backfill'
      and created_at > now() - interval '5 minutes'
  ) then
    return query select 'busy'::text, null::uuid, null::text, null::jsonb;
    return;
  end if;

  if exists (
    select 1 from public.espn_history_jobs
    where trigger_source = 'scheduled_backfill'
      and last_error_code in ('history_plan_failed', 'history_chunk_retries_exhausted')
      and finished_at > now() - interval '15 minutes'
  ) then
    return query select 'busy'::text, null::uuid, null::text, null::jsonb;
    return;
  end if;

  select c.clerk_user_id, c.updated_at into v_candidate
  from public.espn_credentials c
  where c.updated_at is not null
    and (p_allowed_users is null or c.clerk_user_id = any(p_allowed_users))
    and exists (
      select 1 from public.espn_leagues root
      where root.clerk_user_id = c.clerk_user_id
        and root.created_at <= p_legacy_cutoff
        and root.sport in ('football', 'baseball', 'basketball', 'hockey')
        and root.league_id ~ '^[1-9][0-9]*$'
        and root.season_year between 1900 and extract(year from p_legacy_cutoff)::integer
        and root.team_id ~ '^[1-9][0-9]*$'
        and not exists (
          select 1 from public.archived_leagues hidden
          where hidden.clerk_user_id = root.clerk_user_id and hidden.platform = 'espn'
            and hidden.sport = root.sport and hidden.recurring_league_id = root.league_id
            and hidden.mode = 'hidden'
        )
    )
    and not exists (
      select 1 from public.espn_history_jobs marker
      where marker.clerk_user_id = c.clerk_user_id
        and marker.scan_version = p_scan_version and marker.mode = 'full'
        and marker.status in ('succeeded', 'partial')
    )
    and not exists (
      select 1 from public.espn_history_jobs active
      where active.clerk_user_id = c.clerk_user_id and active.status in ('queued', 'running')
    )
    and (select count(*) from public.espn_history_jobs attempts
         where attempts.clerk_user_id = c.clerk_user_id
           and attempts.credential_updated_at = c.updated_at
           and attempts.trigger_source = 'scheduled_backfill'
           and attempts.last_error_code is distinct from 'history_disabled') < 3
    and not exists (
      select 1 from public.espn_history_jobs parked
      where parked.clerk_user_id = c.clerk_user_id and parked.credential_updated_at = c.updated_at
        and parked.trigger_source = 'scheduled_backfill'
        and (parked.status = 'superseded' or parked.last_error_code = 'credentials_changed'
             or parked.last_error_code = 'espn_auth_failed')
    )
    and not exists (
      select 1 from public.espn_history_jobs recent_failure
      where recent_failure.clerk_user_id = c.clerk_user_id
        and recent_failure.credential_updated_at = c.updated_at
        and recent_failure.trigger_source = 'scheduled_backfill'
        and recent_failure.status in ('failed', 'cancelled')
        and recent_failure.last_error_code is distinct from 'credentials_changed'
        and recent_failure.last_error_code is distinct from 'history_disabled'
        and recent_failure.last_error_code is distinct from 'espn_auth_failed'
        and recent_failure.finished_at > now() - interval '24 hours'
    )
    and not exists (
      select 1 from public.provider_sync_state state
      where state.clerk_user_id = c.clerk_user_id and state.provider = 'espn'
        and state.sync_lease_expires_at > now()
    )
  order by c.updated_at asc nulls first, c.clerk_user_id
  for update of c skip locked limit 1;
  if not found then
    return query select 'none'::text, null::uuid, null::text, null::jsonb;
    return;
  end if;

  with latest_roots as (
    select distinct on (root.sport, root.league_id)
      root.sport, root.league_id, root.league_name, root.season_year, root.team_id, root.team_name
    from public.espn_leagues root
    where root.clerk_user_id = v_candidate.clerk_user_id
      and root.created_at <= p_legacy_cutoff
      and root.sport in ('football', 'baseball', 'basketball', 'hockey')
      and root.league_id ~ '^[1-9][0-9]*$'
      and root.season_year between 1900 and extract(year from p_legacy_cutoff)::integer
      and root.team_id ~ '^[1-9][0-9]*$'
      and not exists (
        select 1 from public.archived_leagues hidden
        where hidden.clerk_user_id = root.clerk_user_id and hidden.platform = 'espn'
          and hidden.sport = root.sport and hidden.recurring_league_id = root.league_id
          and hidden.mode = 'hidden'
      )
    order by root.sport, root.league_id, root.season_year desc, root.id desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'gameId', case sport when 'football' then 'ffl' when 'baseball' then 'flb'
                           when 'basketball' then 'fba' when 'hockey' then 'fhl' end,
    'leagueId', league_id, 'leagueName', coalesce(league_name, ''),
    'seasonId', case when sport in ('basketball', 'hockey') then season_year + 1 else season_year end,
    'teamId', team_id::numeric, 'teamName', coalesce(team_name, '')
  ) order by sport, league_id), '[]'::jsonb)
  into v_roots from latest_roots;
  if jsonb_array_length(v_roots) = 0 then
    return query select 'none'::text, null::uuid, null::text, null::jsonb;
    return;
  end if;

  begin
    insert into public.provider_sync_state (
      clerk_user_id, provider, sync_lease_owner, sync_lease_expires_at,
      last_attempt_at, last_sync_source, updated_at
    ) values (
      v_candidate.clerk_user_id, 'espn', 'history:' || v_job_id::text,
      now() + interval '120 seconds', now(), 'scheduled', now()
    ) on conflict on constraint provider_sync_state_pkey do nothing;
    if not found then
      perform 1 from public.provider_sync_state state
      where state.clerk_user_id = v_candidate.clerk_user_id and state.provider = 'espn'
      for update;
      if exists (
        select 1 from public.provider_sync_state state
        where state.clerk_user_id = v_candidate.clerk_user_id and state.provider = 'espn'
          and state.sync_lease_expires_at > now()
      ) then
        raise exception using errcode = 'P0001', message = 'lease_busy';
      end if;
      update public.provider_sync_state as state
      set sync_lease_owner = 'history:' || v_job_id::text,
          sync_lease_expires_at = now() + interval '120 seconds', last_attempt_at = now(),
          last_sync_source = 'scheduled', updated_at = now()
      where state.clerk_user_id = v_candidate.clerk_user_id and state.provider = 'espn';
    end if;
    insert into public.espn_history_jobs (
      id, clerk_user_id, credential_updated_at, scan_version, mode, trigger_source, current_leagues
    ) values (
      v_job_id, v_candidate.clerk_user_id, v_candidate.updated_at,
      p_scan_version, 'full', 'scheduled_backfill', v_roots
    );
  exception
    when unique_violation then
      return query select 'busy'::text, null::uuid, null::text, null::jsonb;
      return;
    when raise_exception then
      if sqlerrm = 'lease_busy' then
        return query select 'lease_busy'::text, null::uuid, null::text, null::jsonb;
        return;
      end if;
      raise;
  end;
  return query select 'claimed'::text, v_job_id, v_candidate.clerk_user_id, v_roots;
end;
$$;

revoke all on function public.claim_next_espn_history_backfill_job(integer, timestamptz, text[]) from public, anon, authenticated;
grant execute on function public.claim_next_espn_history_backfill_job(integer, timestamptz, text[]) to service_role;
