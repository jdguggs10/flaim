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

-- FLA-264 phase 1. This file is the *current* production schedule and is safe
-- to re-run at any time: it adds the dedicated provider-flags job while the
-- dashboard job keeps its five-minute cadence, so both signals stay fresh and
-- no consumer changes behavior.
--
-- Phase 2 — dashboard hourly, internal-inclusive nightly — is deliberately NOT
-- here. It lives in production-cadence-cutover.sql behind a precondition
-- guard, because applying it before the provider-flags consumer has been
-- verified would silently stop provider-outage alerting on a stale-snapshot
-- gate. Fold the post-cutover cadence into this file only after phase 2 has
-- been applied and verified in production.
select cron.schedule(
  'dashboard-snapshot',
  '*/5 * * * *',
  $job$select analytics.refresh_dashboard_snapshot();$job$
);

select cron.schedule(
  'provider-flags-snapshot',
  '*/5 * * * *',
  $job$select analytics.refresh_provider_flags_snapshot();$job$
);
