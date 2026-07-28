-- Production-only pg_cron activation.
--
-- This file is deliberately outside supabase/migrations so local resets and
-- preview databases do not start background jobs. Apply it only to an approved
-- production lane after the baseline and consumer verification gates pass.
-- Re-running it replaces each existing job with the same case-sensitive name.

select cron.schedule(
  'mcp-rollup',
  '15 5 * * *',
  $job$select public.rollup_mcp_usage();$job$
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

select cron.schedule(
  'dashboard-snapshot',
  '*/5 * * * *',
  $job$select analytics.refresh_dashboard_snapshot();$job$
);
