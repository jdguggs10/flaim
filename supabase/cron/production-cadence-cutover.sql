-- FLA-264 phase 2: move the dashboard snapshot off the five-minute timer.
--
-- Phase 1 (production.sql) adds 'provider-flags-snapshot' at */5 while
-- 'dashboard-snapshot' keeps its */5 cadence. Nothing changes for consumers.
--
-- Phase 2 is this file, and it is the step that can break alerting. The
-- provider-failure consumer rejects a snapshot timestamp older than 30
-- minutes and fails open when it does — no error, no alert. Dropping the
-- dashboard to hourly before that consumer sources both its provider rows and
-- its timestamp from analytics.provider_flags_snapshot would silently disable
-- provider-outage monitoring.
--
-- The whole file is ONE transaction. A failed precondition aborts it, so the
-- schedule changes below cannot be applied by a session that stepped over the
-- guard — psql continues past a failed statement unless ON_ERROR_STOP is set,
-- so the transaction, not the operator's invocation, is what makes this safe.
--
-- Preconditions. The first four are enforced below; the fifth cannot be
-- checked from inside the database:
--
--   1. The dedicated snapshot relation exists.
--   2. 'provider-flags-snapshot' is active at */5 and calls
--      analytics.refresh_provider_flags_snapshot().
--   3. That job has actually run, successfully, more than once recently —
--      the migration populates the relation on its own, so fresh rows alone
--      do not prove the schedule fires.
--   4. Both snapshot variants are fresh.
--   5. The provider-failure consumer has been observed across a full poll
--      cycle reporting availability with a fresh timestamp taken from the
--      dedicated snapshot rather than from the dashboard payload fallback.
--
-- Acknowledge precondition 5 explicitly, in the same session:
--
--   psql -v ON_ERROR_STOP=1 \
--     -c "set flaim.flags_consumer_verified = 'yes'" \
--     -f supabase/cron/production-cadence-cutover.sql
--
-- Run without that acknowledgement, this file changes nothing.
--
-- After this file is applied and verified, update production.sql to the
-- post-cutover schedule so the canonical file and production agree again.

begin;

do $cutover$
begin
  if coalesce(
    current_setting('flaim.flags_consumer_verified', true),
    ''
  ) <> 'yes' then
    raise exception 'FLA-264 phase 2 blocked: consumer verification was not acknowledged'
      using hint = 'Verify the provider-failure consumer against the dedicated '
        'snapshot, then set flaim.flags_consumer_verified to yes in this session.';
  end if;

  if to_regclass('analytics.provider_flags_snapshot') is null then
    raise exception 'FLA-264 phase 2 blocked: analytics.provider_flags_snapshot does not exist'
      using hint = 'Apply the phase 1 migration first.';
  end if;

  if not exists (
    select 1
    from cron.job
    where jobname = 'provider-flags-snapshot'
      and schedule = '*/5 * * * *'
      and active
      and command = 'select analytics.refresh_provider_flags_snapshot();'
  ) then
    raise exception 'FLA-264 phase 2 blocked: provider-flags-snapshot is not active at */5 with the expected command'
      using hint = 'Apply supabase/cron/production.sql first.';
  end if;

  -- Execution history, not row freshness: the phase 1 migration populates the
  -- relation itself, so a fresh row proves nothing about the schedule.
  --
  -- Matching on d.command, not just the job id, is the load-bearing part.
  -- cron.schedule() updates a job with an existing name in place and keeps its
  -- jobid, while cron.job_run_details keeps the command each historical run
  -- actually executed. Joining on jobid alone therefore lets successes from a
  -- previous, unrelated command vouch for a refresh that has never run.
  if (
    select count(*)
    from cron.job_run_details d
    join cron.job j on j.jobid = d.jobid
    where j.jobname = 'provider-flags-snapshot'
      and d.command = j.command
      and d.status = 'succeeded'
      and d.end_time > now() - interval '20 minutes'
  ) < 2 then
    raise exception 'FLA-264 phase 2 blocked: provider-flags-snapshot has not run its current command successfully twice in the last 20 minutes'
      using hint = 'Let the */5 job run, then re-check cron.job_run_details.';
  end if;

  if (
    select count(*)
    from analytics.provider_flags_snapshot
    where id in (1, 2)
      and computed_at > now() - interval '30 minutes'
  ) <> 2 then
    raise exception 'FLA-264 phase 2 blocked: provider flags variants are missing or stale'
      using hint = 'Let the */5 job run, then re-check both id=1 and id=2.';
  end if;
end
$cutover$;

-- Replaces the existing five-minute job in place. Offset from the top of the
-- hour so it does not stack onto other scheduled work.
select cron.schedule(
  'dashboard-snapshot',
  '7 * * * *',
  $job$select analytics.refresh_dashboard_snapshot(false);$job$
);

-- The internal-inclusive variant is not on the alerting path — the consumer
-- polls the external variant — so it runs nightly, after the daily rollup and
-- prune jobs.
select cron.schedule(
  'dashboard-snapshot-internal',
  '10 6 * * *',
  $job$select analytics.refresh_dashboard_snapshot(true);$job$
);

commit;
