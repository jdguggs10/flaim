-- Durable, service-role-only ESPN history refresh jobs (FLA-308).
-- Jobs deliberately retain their terminal rows so a completed full scan is the
-- repair marker for later incremental scans.
create table public.espn_history_jobs (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'partial', 'failed', 'superseded', 'cancelled')),
  workflow_instance_id text unique,
  credential_updated_at timestamptz not null,
  scan_version integer not null check (scan_version > 0),
  mode text not null check (mode in ('full', 'incremental')),
  current_leagues jsonb not null default '[]'::jsonb,
  plan jsonb not null default '[]'::jsonb,
  cursor integer not null default 0 check (cursor >= 0),
  planned_count integer not null default 0 check (planned_count >= 0),
  completed_count integer not null default 0 check (completed_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  failures jsonb not null default '[]'::jsonb,
  last_error_code text check (last_error_code is null or length(last_error_code) <= 64),
  last_error_message text check (last_error_message is null or length(last_error_message) <= 240),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint espn_history_jobs_current_leagues_array check (jsonb_typeof(current_leagues) = 'array'),
  constraint espn_history_jobs_plan_array check (jsonb_typeof(plan) = 'array'),
  constraint espn_history_jobs_failures_array check (jsonb_typeof(failures) = 'array')
);

create unique index espn_history_jobs_one_active_per_user
  on public.espn_history_jobs (clerk_user_id)
  where status in ('queued', 'running');
create index espn_history_jobs_user_created_at_idx
  on public.espn_history_jobs (clerk_user_id, created_at desc);

alter table public.espn_history_jobs enable row level security;
revoke all on table public.espn_history_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.espn_history_jobs to service_role;

-- This is intentionally SECURITY INVOKER: only the service role has table
-- privileges, and callers must supply the exact job-derived lease owner.
create function public.advance_espn_history_job(
  p_job_id uuid,
  p_credential_updated_at timestamptz,
  p_plan_index integer,
  p_action text,
  p_league_id text default null,
  p_sport text default null,
  p_season_year integer default null,
  p_team_id text default null,
  p_team_name text default null,
  p_league_name text default null,
  p_failure_code text default null,
  p_failure_message text default null
)
returns table(outcome text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.espn_history_jobs%rowtype;
begin
  select * into v_job
  from public.espn_history_jobs
  where id = p_job_id
    and status in ('queued', 'running')
    and credential_updated_at = p_credential_updated_at
  for update;

  if not found then
    return query select 'job_not_active'::text;
    return;
  end if;

  if p_action not in ('persist', 'skip', 'fail') then
    return query select 'invalid_action'::text;
    return;
  end if;

  if p_plan_index is null or p_plan_index < 0 or p_plan_index >= v_job.planned_count then
    return query select 'plan_index_invalid'::text;
    return;
  end if;

  -- A Workflow step can run again after its result was durably written but
  -- before the runtime observed it. The job cursor is the idempotency fence:
  -- a prior index is already complete, a future index is out of order, and
  -- only the exact next index is allowed to mutate storage/counts.
  if v_job.cursor > p_plan_index then
    return query select 'already_processed'::text;
    return;
  end if;
  if v_job.cursor < p_plan_index then
    return query select 'out_of_order'::text;
    return;
  end if;
  if not exists (
    select 1 from public.espn_credentials c
    where c.clerk_user_id = v_job.clerk_user_id
      and c.updated_at = p_credential_updated_at
  ) then
    return query select 'credential_changed'::text;
    return;
  end if;

  if not exists (
    select 1 from public.provider_sync_state s
    where s.clerk_user_id = v_job.clerk_user_id
      and s.provider = 'espn'
      and s.sync_lease_owner = ('history:' || p_job_id::text)
      and s.sync_lease_expires_at > now()
  ) then
    return query select 'lease_lost'::text;
    return;
  end if;

  if p_action = 'skip' then
    update public.espn_history_jobs set cursor=cursor+1, completed_count=completed_count+1, skipped_count=skipped_count+1, updated_at=now() where id=p_job_id and cursor=p_plan_index;
    return query select 'skipped'::text; return;
  end if;
  if p_action = 'fail' then
    update public.espn_history_jobs set cursor=cursor+1, failed_count=failed_count+1,
      failures=(select coalesce(jsonb_agg(entry order by ordinal), '[]'::jsonb) from jsonb_array_elements((failures || jsonb_build_array(jsonb_build_object('index',p_plan_index,'code',left(coalesce(p_failure_code,'season_failed'),64),'message',left(coalesce(p_failure_message,'Season refresh failed'),160))))::jsonb) with ordinality as entries(entry, ordinal) where ordinal > greatest(jsonb_array_length(failures) - 24, 0)),
      last_error_code=left(coalesce(p_failure_code,'season_failed'),64), last_error_message=left(coalesce(p_failure_message,'Season refresh failed'),240), updated_at=now()
    where id=p_job_id and cursor=p_plan_index;
    return query select 'failed'::text; return;
  end if;
  if p_league_id is null or btrim(p_league_id)='' or p_sport not in ('football','baseball','basketball','hockey') or p_season_year is null or p_team_id is null or btrim(p_team_id)='' then return query select 'invalid_persist_identity'::text; return; end if;
  if coalesce(v_job.plan -> p_plan_index ->> 'leagueId','') <> p_league_id
     or coalesce(v_job.plan -> p_plan_index ->> 'sport','') <> p_sport
     or coalesce((v_job.plan -> p_plan_index ->> 'seasonYear')::integer,-1) <> p_season_year then
    return query select 'plan_identity_mismatch'::text;
    return;
  end if;
  if v_job.mode = 'full' then
    -- The existing uniqueness is an expression index on COALESCE(season_year,
    -- -1), so it cannot be named by a simple ON CONFLICT target. Update first,
    -- use targetless DO NOTHING for an insert race, then update once more to
    -- repair the winner's existing row without relying on a constraint shape.
    update public.espn_leagues
    set team_id = p_team_id, team_name = p_team_name, league_name = p_league_name
    where clerk_user_id = v_job.clerk_user_id
      and league_id = p_league_id
      and sport = p_sport
      and season_year = p_season_year;
    insert into public.espn_leagues (clerk_user_id, league_id, sport, team_id, team_name, league_name, season_year)
    values (v_job.clerk_user_id, p_league_id, p_sport, p_team_id, p_team_name, p_league_name, p_season_year)
    on conflict do nothing;
    update public.espn_leagues
    set team_id = p_team_id, team_name = p_team_name, league_name = p_league_name
    where clerk_user_id = v_job.clerk_user_id
      and league_id = p_league_id
      and sport = p_sport
      and season_year = p_season_year;
  else
    insert into public.espn_leagues (clerk_user_id, league_id, sport, team_id, team_name, league_name, season_year)
    values (v_job.clerk_user_id, p_league_id, p_sport, p_team_id, p_team_name, p_league_name, p_season_year)
    -- espn_leagues uses an expression unique index for NULL season years, so
    -- a column conflict target is invalid. Targetless DO NOTHING correctly
    -- recognizes that existing index and preserves incremental rows.
    on conflict do nothing;
  end if;

  update public.espn_history_jobs
  set cursor = cursor + 1, completed_count = completed_count + 1, updated_at = now()
  where id = p_job_id and cursor = p_plan_index;
  return query select 'persisted'::text;
end;
$$;

revoke all on function public.advance_espn_history_job(uuid, timestamptz, integer, text, text, text, integer, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.advance_espn_history_job(uuid, timestamptz, integer, text, text, text, integer, text, text, text, text, text) to service_role;

create function public.finish_espn_history_job(
  p_job_id uuid,
  p_status text,
  p_error_code text default null,
  p_error_message text default null
)
returns table(outcome text)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.espn_history_jobs%rowtype;
begin
  select * into v_job
  from public.espn_history_jobs
  where id = p_job_id
    and status in ('queued', 'running')
  for update;

  if not found then
    return query select 'job_not_active'::text;
    return;
  end if;
  if p_status not in ('succeeded', 'partial', 'failed', 'superseded', 'cancelled') then
    return query select 'invalid_status'::text;
    return;
  end if;
  if p_status = 'succeeded'
    and (v_job.cursor <> v_job.planned_count or v_job.failed_count <> 0) then
    return query select 'completion_incomplete'::text;
    return;
  end if;
  if p_status = 'partial'
    and (v_job.cursor <> v_job.planned_count or v_job.failed_count = 0) then
    return query select 'completion_incomplete'::text;
    return;
  end if;

  update public.espn_history_jobs
  set status = p_status,
      last_error_code = left(p_error_code, 64),
      last_error_message = left(p_error_message, 240),
      finished_at = now(),
      updated_at = now()
  where id = p_job_id;
  return query select 'finished'::text;
end;
$$;

revoke all on function public.finish_espn_history_job(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.finish_espn_history_job(uuid, text, text, text) to service_role;
