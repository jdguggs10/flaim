-- Synthetic local-development data only.
--
-- Every identifier and credential-shaped value below is deliberately invalid.
-- Never replace these placeholders with copied production rows or secrets.

insert into public.espn_credentials (
  clerk_user_id,
  swid,
  s2,
  email,
  updated_at
) values (
  'seed-user-001',
  'synthetic-swid-never-valid',
  'synthetic-espn-cookie-never-valid',
  'seed-user@example.invalid',
  '2026-01-15 12:00:00+00'
);

insert into public.espn_leagues (
  clerk_user_id,
  league_id,
  sport,
  team_id,
  team_name,
  league_name,
  season_year,
  created_at
) values (
  'seed-user-001',
  'seed-espn-league-001',
  'football',
  'seed-team-001',
  'Synthetic Starters',
  'Synthetic ESPN League',
  2026,
  '2026-01-15 12:00:00+00'
);

insert into public.oauth_states (
  id,
  state,
  redirect_uri,
  client_id,
  expires_at,
  created_at
) values (
  '00000000-0000-4000-8000-000000000001',
  'synthetic-oauth-state-never-valid',
  'https://example.invalid/oauth/callback',
  'synthetic-client',
  '2000-01-01 00:00:00+00',
  '2026-01-15 12:00:00+00'
);

insert into public.oauth_codes (
  id,
  code,
  user_id,
  redirect_uri,
  code_challenge,
  code_challenge_method,
  scope,
  expires_at,
  used_at,
  created_at,
  resource
) values (
  '00000000-0000-4000-8000-000000000002',
  'synthetic-oauth-code-never-valid',
  'seed-user-001',
  'https://example.invalid/oauth/callback',
  'synthetic-code-challenge',
  'S256',
  'mcp:read',
  '2000-01-01 00:00:00+00',
  '2026-01-15 12:00:00+00',
  '2026-01-15 12:00:00+00',
  'https://example.invalid/mcp'
);

insert into public.oauth_tokens (
  id,
  access_token,
  user_id,
  scope,
  expires_at,
  revoked_at,
  refresh_token,
  refresh_token_expires_at,
  created_at,
  resource,
  client_name,
  grant_type
) values (
  '00000000-0000-4000-8000-000000000003',
  'synthetic-access-token-never-valid',
  'seed-user-001',
  'mcp:read',
  '2000-01-01 00:00:00+00',
  '2026-01-15 12:00:00+00',
  'synthetic-refresh-token-never-valid',
  '2000-01-01 00:00:00+00',
  '2026-01-15 12:00:00+00',
  'https://example.invalid/mcp',
  'Synthetic Client',
  'authorization_code'
);

insert into public.yahoo_credentials (
  clerk_user_id,
  access_token,
  refresh_token,
  expires_at,
  yahoo_guid,
  created_at,
  updated_at,
  app_fingerprint
) values (
  'seed-user-001',
  'synthetic-yahoo-access-never-valid',
  'synthetic-yahoo-refresh-never-valid',
  '2000-01-01 00:00:00+00',
  'seed-yahoo-guid-001',
  '2026-01-15 12:00:00+00',
  '2026-01-15 12:00:00+00',
  'synthetic-app-fingerprint'
);

insert into public.yahoo_leagues (
  id,
  clerk_user_id,
  sport,
  season_year,
  league_key,
  league_name,
  team_id,
  team_key,
  team_name,
  recurring_league_id,
  created_at,
  updated_at
) values (
  '00000000-0000-4000-8000-000000000004',
  'seed-user-001',
  'football',
  2026,
  'seed-yahoo-league-001',
  'Synthetic Yahoo League',
  'seed-team-001',
  'seed-yahoo-team-001',
  'Synthetic Starters',
  'seed-recurring-yahoo-001',
  '2026-01-15 12:00:00+00',
  '2026-01-15 12:00:00+00'
);

insert into public.platform_oauth_states (
  id,
  state,
  platform,
  clerk_user_id,
  redirect_after,
  expires_at,
  created_at
) values (
  '00000000-0000-4000-8000-000000000005',
  'synthetic-platform-state-never-valid',
  'yahoo',
  'seed-user-001',
  '/connect',
  '2000-01-01 00:00:00+00',
  '2026-01-15 12:00:00+00'
);

insert into public.user_preferences (
  clerk_user_id,
  default_sport,
  default_football,
  created_at,
  updated_at
) values (
  'seed-user-001',
  'football',
  '{"platform":"espn","leagueId":"seed-espn-league-001","seasonYear":2026}',
  '2026-01-15 12:00:00+00',
  '2026-01-15 12:00:00+00'
);

insert into public.sleeper_connections (
  clerk_user_id,
  sleeper_user_id,
  sleeper_username,
  created_at,
  updated_at
) values (
  'seed-user-001',
  'seed-sleeper-user-001',
  'synthetic_manager',
  '2026-01-15 12:00:00+00',
  '2026-01-15 12:00:00+00'
);

insert into public.sleeper_leagues (
  id,
  clerk_user_id,
  league_id,
  sport,
  season_year,
  league_name,
  roster_id,
  sleeper_user_id,
  recurring_league_id,
  created_at,
  updated_at
) values (
  '00000000-0000-4000-8000-000000000006',
  'seed-user-001',
  'seed-sleeper-league-001',
  'football',
  2026,
  'Synthetic Sleeper League',
  1,
  'seed-sleeper-user-001',
  'seed-recurring-sleeper-001',
  '2026-01-15 12:00:00+00',
  '2026-01-15 12:00:00+00'
);

insert into public.chat_runs (
  id,
  visitor_key,
  preset_id,
  model,
  status,
  duration_ms,
  started_at,
  completed_at,
  created_at,
  updated_at
) values (
  '00000000-0000-4000-8000-000000000007',
  'seed-visitor-001',
  'seed-preset-001',
  'synthetic-model',
  'completed',
  1200,
  '2026-01-15 12:00:00+00',
  '2026-01-15 12:00:01.2+00',
  '2026-01-15 12:00:00+00',
  '2026-01-15 12:00:01.2+00'
);

insert into public.demo_context_cache (
  cache_key,
  context_text,
  expires_at,
  created_at,
  updated_at
) values (
  'seed-context-001',
  'Synthetic context for local verification.',
  '2099-01-01 00:00:00+00',
  '2026-01-15 12:00:00+00',
  '2026-01-15 12:00:00+00'
);

insert into public.demo_answer_cache (
  cache_key,
  preset_id,
  sport,
  provider,
  provider_model,
  context_version,
  prompt_version,
  answer_text,
  answer_word_count,
  generated_at,
  expires_at,
  stale_after,
  generation_ms,
  source_meta,
  tool_trace_summary,
  created_at,
  updated_at
) values (
  'seed-answer-001',
  'seed-preset-001',
  'football',
  'synthetic-provider',
  'synthetic-model',
  'seed-context-v1',
  'seed-prompt-v1',
  'Synthetic cached answer for local verification.',
  6,
  '2026-01-15 12:00:00+00',
  '2099-01-01 00:00:00+00',
  '2098-12-31 00:00:00+00',
  1200,
  '{"synthetic":true}',
  '{"calls":["get_league_info"]}',
  '2026-01-15 12:00:00+00',
  '2026-01-15 12:00:00+00'
);

insert into public.demo_refresh_runs (
  id,
  job_type,
  preset_id,
  sport,
  provider_attempted,
  provider_model,
  status,
  started_at,
  completed_at,
  duration_ms,
  source_meta,
  created_at
) values (
  '00000000-0000-4000-8000-000000000008',
  'answer',
  'seed-preset-001',
  'football',
  'synthetic-provider',
  'synthetic-model',
  'completed',
  '2026-01-15 12:00:00+00',
  '2026-01-15 12:00:01.2+00',
  1200,
  '{"synthetic":true}',
  '2026-01-15 12:00:00+00'
);

insert into public.demo_refresh_attempts (
  run_id,
  job_type,
  preset_id,
  sport,
  attempt_number,
  provider_attempted,
  requested_model,
  resolved_provider_model,
  model_class,
  model_family,
  status,
  parse_status,
  validation_status,
  started_at,
  completed_at,
  duration_ms,
  answer_word_count,
  tool_call_count,
  used_fantasy_mcp,
  used_web_search,
  token_input,
  token_total,
  token_thoughts,
  stored_to_cache,
  source_meta,
  created_at
) values (
  '00000000-0000-4000-8000-000000000008',
  'answer',
  'seed-preset-001',
  'football',
  1,
  'synthetic-provider',
  'synthetic-model',
  'synthetic-model',
  'seed-class',
  'seed-family',
  'completed',
  'parsed',
  'valid',
  '2026-01-15 12:00:00+00',
  '2026-01-15 12:00:01.2+00',
  1200,
  6,
  1,
  true,
  false,
  100,
  150,
  25,
  true,
  '{"synthetic":true}',
  '2026-01-15 12:00:00+00'
);

insert into public.demo_antigravity_cache (
  cache_key,
  preset_id,
  sport,
  provider,
  provider_model,
  context_version,
  prompt_version,
  answer_text,
  answer_word_count,
  generated_at,
  expires_at,
  stale_after,
  generation_ms,
  validation_status,
  quality_warnings,
  source_meta,
  tool_trace_summary,
  created_at,
  updated_at
) values (
  'seed-antigravity-001',
  'seed-preset-001',
  'football',
  'antigravity',
  'synthetic-model',
  'seed-context-v1',
  'seed-prompt-v1',
  'Synthetic Antigravity candidate for local verification.',
  7,
  '2026-01-15 12:00:00+00',
  '2099-01-01 00:00:00+00',
  '2098-12-31 00:00:00+00',
  1400,
  'valid',
  '[]',
  '{"synthetic":true}',
  '{"calls":["get_league_info"]}',
  '2026-01-15 12:00:00+00',
  '2026-01-15 12:00:00+00'
);

insert into public.demo_target_state (
  platform,
  sport,
  public_enabled,
  expected_prompt_version,
  expected_context_version,
  updated_at
) values
  (
    'espn',
    'baseball',
    false,
    'v8',
    'v3',
    '2026-08-05 12:00:00+00'
  ),
  (
    'yahoo',
    'baseball',
    false,
    'v8',
    'v3',
    '2026-08-05 12:00:00+00'
  ),
  (
    'espn',
    'football',
    false,
    'v8',
    'v3',
    '2026-08-05 12:00:00+00'
  ),
  (
    'yahoo',
    'football',
    false,
    'v8',
    'v3',
    '2026-08-05 12:00:00+00'
  ),
  (
    'sleeper',
    'football',
    false,
    'v8',
    'v3',
    '2026-08-05 12:00:00+00'
  );

insert into public.archived_leagues (
  id,
  clerk_user_id,
  platform,
  sport,
  recurring_league_id,
  league_name,
  archived_at,
  mode
) values (
  '00000000-0000-4000-8000-000000000009',
  'seed-user-001',
  'espn',
  'football',
  'seed-recurring-archived-001',
  'Synthetic Archived League',
  '2026-01-15 12:00:00+00',
  'historical'
);

insert into public.mcp_tool_events (
  ts,
  env,
  user_id,
  auth_type,
  client_name,
  tool_name,
  platform,
  sport,
  status,
  error_code,
  latency_ms,
  league_hash
) values
  (
    now() - interval '30 minutes',
    'prod',
    'seed-user-001',
    'oauth',
    'Synthetic Client',
    'get_league_info',
    'espn',
    'football',
    'ok',
    null,
    125,
    'synthetic-league-hash'
  ),
  (
    now() - interval '20 minutes',
    'prod',
    'seed-user-001',
    'oauth',
    'Synthetic Client',
    'refresh_leagues',
    'espn',
    'football',
    'ok',
    null,
    250,
    'synthetic-league-hash'
  ),
  (
    now() - interval '10 minutes',
    'prod',
    'seed-user-001',
    'oauth',
    'Synthetic Client',
    'get_roster',
    'espn',
    'football',
    'error',
    'SYNTHETIC_SEED_ERROR',
    175,
    'synthetic-league-hash'
  );

insert into public.provider_sync_state (
  clerk_user_id,
  provider,
  last_attempt_at,
  last_success_at,
  last_league_count,
  last_duration_ms,
  last_sync_source,
  updated_at
) values (
  'seed-user-001',
  'espn',
  now() - interval '10 minutes',
  now() - interval '10 minutes',
  1,
  250,
  'seed',
  now() - interval '10 minutes'
);

insert into analytics.internal_users (
  user_id,
  note,
  added_at
) values (
  'seed-internal-user-001',
  'Synthetic local-only exclusion row',
  '2026-01-15 12:00:00+00'
);

select public.rollup_mcp_usage(current_date);
select analytics.refresh_dashboard_snapshot();
