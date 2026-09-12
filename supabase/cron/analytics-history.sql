-- FLA-265 production-only activation for the ET-history close job.
--
-- This deliberately schedules only the new job. Do NOT replay
-- cron/production.sql: that artifact owns unrelated maintenance jobs and
-- dashboard/provider cadence. Hosted preview and production activation require
-- separate approval.
--
-- Before an approved production invocation, the initial backfill and its
-- parity evidence must already exist. Acknowledge that explicit operator gate
-- in the same session, for example:
--
--   psql -v ON_ERROR_STOP=1 \
--     -c "set flaim.analytics_history_close_approved = 'yes'" \
--     -f supabase/cron/analytics-history.sql
--
-- Run without the acknowledgement, or before the history marker is
-- initialized, and this file changes nothing. The transaction matters because
-- psql can otherwise continue after a failed guard without ON_ERROR_STOP.

begin;

do $activation$
begin
  if coalesce(
    current_setting('flaim.analytics_history_close_approved', true),
    ''
  ) <> 'yes' then
    raise exception 'FLA-265 history-close activation blocked: operator approval was not acknowledged'
      using hint = 'Complete the approved backfill and parity proof, then set '
        'flaim.analytics_history_close_approved to yes in this session.';
  end if;

  if not exists (
    select 1
    from analytics.history_rollup_state
    where id
      and initial_history_start_et_day is not null
      and last_closed_et_day is not null
  ) then
    raise exception 'FLA-265 history-close activation blocked: analytics history is not initialized'
      using hint = 'Run the explicit initial close/backfill and record parity before scheduling it.';
  end if;
end
$activation$;

-- UTC is deliberate: 06:00 leaves a buffer after the ET day closes at 04:00
-- during EDT and 05:00 during EST. Re-running this file updates only this
-- same-named job in place.
select cron.schedule(
  'mcp-et-history-close',
  '0 6 * * *',
  $job$select public.close_mcp_user_daily_et();$job$
);

commit;
