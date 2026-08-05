-- FLA-247: additive platform contract for the homepage-demo tables.
--
-- The public demo previously assumed a single fantasy platform. This forward
-- migration adds an explicit platform discriminator to the four demo
-- relations, defaulting to the current single-platform behavior so existing
-- rows and writers keep working unchanged. It also adds four query-derived
-- composite indexes, makes the scorecard view platform-aware, and creates the
-- demo_target_state gate table recording the intended per-platform/per-sport
-- public-demo state. Nothing is dropped or rewritten. Hosted preview and
-- production application remain separate approval gates.

begin;

-- On Postgres 17 a NOT NULL column with a constant default is a metadata-only
-- change; existing rows are backfilled atomically without a table rewrite.
alter table public.demo_answer_cache
  add column platform text not null default 'espn';
alter table public.demo_antigravity_cache
  add column platform text not null default 'espn';
alter table public.demo_refresh_runs
  add column platform text not null default 'espn';
alter table public.demo_refresh_attempts
  add column platform text not null default 'espn';

-- Minimal query-derived indexes for platform-scoped cache reads and run
-- history. Existing indexes, including the intentional duplicate before-state
-- pair on demo_refresh_runs, are deliberately untouched.
create index demo_answer_cache_platform_sport_preset_idx
  on public.demo_answer_cache using btree (platform, sport, preset_id);
create index demo_antigravity_cache_platform_sport_preset_idx
  on public.demo_antigravity_cache using btree (platform, sport, preset_id);
create index demo_refresh_runs_platform_sport_created_idx
  on public.demo_refresh_runs using btree (platform, sport, created_at desc);
create index demo_refresh_attempts_platform_sport_created_idx
  on public.demo_refresh_attempts using btree (platform, sport, created_at desc);

-- Platform-aware scorecard. CREATE OR REPLACE VIEW cannot reorder or insert
-- columns, so platform is appended as the final output column.
create or replace view public.demo_refresh_attempt_scorecard_7d
with (security_invoker = true)
as
select
  preset_id,
  sport,
  requested_model,
  resolved_provider_model,
  count(*) filter (
    where coalesce((source_meta ->> 'dryRun')::boolean, false) = false
  ) as attempts,
  count(*) filter (
    where status = 'stored'
      and coalesce((source_meta ->> 'dryRun')::boolean, false) = false
  ) as stored_attempts,
  count(*) filter (
    where status = 'retry'
      and coalesce((source_meta ->> 'dryRun')::boolean, false) = false
  ) as retries,
  count(*) filter (
    where status = 'failed'
      and coalesce((source_meta ->> 'dryRun')::boolean, false) = false
  ) as failures,
  round(avg(duration_ms) filter (
    where coalesce((source_meta ->> 'dryRun')::boolean, false) = false
  )) as avg_duration_ms,
  percentile_disc(0.5) within group (order by duration_ms) filter (
    where coalesce((source_meta ->> 'dryRun')::boolean, false) = false
      and duration_ms is not null
  ) as p50_duration_ms,
  percentile_disc(0.95) within group (order by duration_ms) filter (
    where coalesce((source_meta ->> 'dryRun')::boolean, false) = false
      and duration_ms is not null
  ) as p95_duration_ms,
  round(avg(token_thoughts) filter (
    where coalesce((source_meta ->> 'dryRun')::boolean, false) = false
      and token_thoughts is not null
  )) as avg_token_thoughts,
  platform
from public.demo_refresh_attempts
where created_at >= now() - interval '7 days'
group by preset_id, sport, requested_model, resolved_provider_model, platform
order by preset_id, sport, requested_model, resolved_provider_model;

create table public.demo_target_state (
  platform text not null,
  sport text not null,
  public_enabled boolean not null default false,
  expected_prompt_version text not null,
  expected_context_version text not null,
  updated_at timestamptz not null default now(),
  constraint demo_target_state_pkey primary key (platform, sport),
  constraint demo_target_state_platform_check
    check (platform in ('espn', 'yahoo', 'sleeper')),
  constraint demo_target_state_sport_check
    check (sport in ('baseball', 'football'))
);

-- The before-state default privileges auto-grant broad access to new tables,
-- so the posture is narrowed immediately to match demo_antigravity_cache:
-- service-role only, RLS enabled, no policies.
alter table public.demo_target_state enable row level security;
revoke all privileges on table public.demo_target_state
  from public, anon, authenticated, analytics_readonly;
grant all privileges on table public.demo_target_state to service_role;

comment on table public.demo_target_state is
  'Explicit per-platform, per-sport public-enable gate and expected prompt/context version tags for the homepage demo cache. Service-role only.';

commit;
