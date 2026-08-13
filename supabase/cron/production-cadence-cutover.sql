-- FLA-264 phase 2: move the dashboard snapshot off the five-minute timer.
--
-- Phase 1 (production.sql) adds 'provider-flags-snapshot' at */5 while
-- 'dashboard-snapshot' keeps its */5 cadence. Nothing changes for consumers.
--
-- Phase 2 is this file, and it is the step that can break alerting. The
-- provider-failure consumer rejects a snapshot timestamp older than 30
-- minutes and fails open when it does — no page, no error. Dropping the
-- dashboard to hourly before that consumer sources both its provider rows and
-- its timestamp from analytics.provider_flags_snapshot would silently disable
-- provider-outage monitoring.
--
-- Preconditions. The first three are enforced below; the fourth cannot be
-- checked from inside the database:
--
--   1. The dedicated snapshot relation exists.
--   2. 'provider-flags-snapshot' is scheduled and active at */5.
--   3. Both snapshot variants exist and are fresh.
--   4. The provider-failure consumer has been observed across a full poll
--      cycle reporting availability with a fresh timestamp taken from the
--      dedicated snapshot rather than from the dashboard payload fallback.
--
-- Acknowledge precondition 4 explicitly, in the same session:
--
--   set flaim.flags_consumer_verified = 'yes';
--   \i supabase/cron/production-cadence-cutover.sql
--
-- Run without that acknowledgement, this file raises and changes nothing.
--
-- After this file is applied and verified, update production.sql to the
-- post-cutover schedule so the canonical file and production agree again.

do $cutover$
begin
  if coalesce(
    current_setting('flaim.flags_consumer_verified', true),
    ''
  ) <> 'yes' then
    raise exception 'FLA-264 phase 2 blocked: consumer verification was not acknowledged'
      using hint = 'Verify the provider-failure consumer against the dedicated '
        'snapshot, then run: set flaim.flags_consumer_verified = ''yes'';';
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
  ) then
    raise exception 'FLA-264 phase 2 blocked: provider-flags-snapshot is not active at */5'
      using hint = 'Apply supabase/cron/production.sql first.';
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
