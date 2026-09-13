-- Production-only pg_cron activation.
--
-- This file is deliberately outside supabase/migrations so local resets and
-- preview databases do not start background jobs. Apply it only to an approved
-- production lane after the baseline and consumer verification gates pass.
-- Re-running it replaces each existing job with the same case-sensitive name.
-- Renaming or retiring a job is a separate approved operation: explicitly call
-- cron.unschedule() for the old name before scheduling its replacement.

select cron.schedule(
  'mcp-rollup',
  '15 5 * * *',
  $job$
    select public.rollup_mcp_usage(day::date)
    from generate_series(
      (now() at time zone 'UTC')::date - 7,
      (now() at time zone 'UTC')::date - 1,
      interval '1 day'
    ) as completed_days(day);
  $job$
);

select cron.schedule(
  'mcp-prune',
  '30 5 * * *',
  $job$select public.prune_mcp_events();$job$
);

select cron.schedule(
  'oauth-tokens-cleanup',
  '45 5 * * *',
  $job$select public.cleanup_expired_oauth_tokens();$job$
);

select cron.schedule(
  'oauth-ephemeral-cleanup',
  '47 5 * * *',
  $job$select public.cleanup_expired_oauth_ephemeral();$job$
);

-- FLA-264 / FLA-378: the human dashboard refreshes every fifteen minutes;
-- provider flags retain their independent five-minute alerting cadence. The
-- no-argument dashboard refresh computes only the internal-inclusive row.
select cron.schedule(
  'dashboard-snapshot',
  '*/15 * * * *',
  $job$select analytics.refresh_dashboard_snapshot();$job$
);

select cron.schedule(
  'provider-flags-snapshot',
  '*/5 * * * *',
  $job$select analytics.refresh_provider_flags_snapshot();$job$
);
