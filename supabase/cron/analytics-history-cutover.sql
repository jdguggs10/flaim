-- FLA-265 production-only read-path cutover.
--
-- This changes no pg_cron job. It replaces analytics.dashboard_payload(boolean)
-- with a thin security-invoker wrapper around the already-proved history
-- sibling. CREATE OR REPLACE preserves the existing function owner and ACL;
-- intentionally do not add ALTER OWNER, GRANT, or REVOKE statements here.
--
-- Before an approved invocation, capture the exact existing function source
-- outside this repository and retain it with the production evidence:
--
--   select pg_get_functiondef('analytics.dashboard_payload(boolean)'::regprocedure);
--
-- That is an operator recovery artifact, not a promise that switching back
-- after raw pruning restores old all-history semantics. Once raw data ages out,
-- the durable aggregate is the only complete history.
--
-- Acknowledge the completed consumer and raw-vs-history parity evidence in the
-- same session, for example:
--
--   psql -v ON_ERROR_STOP=1 \
--     -c "set flaim.analytics_history_cutover_approved = 'yes'" \
--     -f supabase/cron/analytics-history-cutover.sql
--
-- The guards and replacement are one transaction. A failed guard therefore
-- changes neither the function nor any schedule, even when psql continues
-- after an error without ON_ERROR_STOP.

begin;

do $cutover$
declare
  expected_marker date := (now() at time zone 'America/New_York')::date - 1;
begin
  if coalesce(
    current_setting('flaim.analytics_history_cutover_approved', true),
    ''
  ) <> 'yes' then
    raise exception 'FLA-265 history cutover blocked: consumer and parity approval was not acknowledged'
      using hint = 'Complete the approved consumer and parity review, then set '
        'flaim.analytics_history_cutover_approved to yes in this session.';
  end if;

  if not exists (
    select 1
    from analytics.history_rollup_state
    where id
      and initial_history_start_et_day is not null
      and last_closed_et_day = expected_marker
  ) then
    raise exception 'FLA-265 history cutover blocked: marker is not current through the latest closed ET day'
      using hint = 'Run and verify the daily 06:00 UTC close before cutover.';
  end if;

  if not exists (
    select 1
    from cron.job
    where jobname = 'mcp-et-history-close'
      and schedule = '0 6 * * *'
      and active
      and command = 'select public.close_mcp_user_daily_et();'
  ) then
    raise exception 'FLA-265 history cutover blocked: mcp-et-history-close is not active at 06:00 UTC with the expected command'
      using hint = 'Apply supabase/cron/analytics-history.sql and let it run first.';
  end if;

  -- Join execution history to the current job command. cron.schedule updates a
  -- same-named job in place, so job id alone can otherwise let an older command
  -- vouch for a close function that has never succeeded.
  if not exists (
    select 1
    from cron.job_run_details as d
    join cron.job as j on j.jobid = d.jobid
    where j.jobname = 'mcp-et-history-close'
      and d.command = j.command
      and d.status = 'succeeded'
      and d.end_time > now() - interval '26 hours'
  ) then
    raise exception 'FLA-265 history cutover blocked: mcp-et-history-close has no recent successful run of its current command'
      using hint = 'Keep the exact daily job active and verify a successful current-command run.';
  end if;
end
$cutover$;

create or replace function analytics.dashboard_payload(include_internal boolean)
returns jsonb
language sql
stable
security invoker
set search_path to ''
as $function$
  select analytics.dashboard_payload_history(include_internal);
$function$;

commit;
