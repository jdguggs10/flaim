-- Reviewed rollback artifact for 20260915120000_add_signup_log.sql (FLA-396).
--
-- This file lives OUTSIDE supabase/migrations on purpose, exactly like the
-- artifacts in supabase/cron: a local `supabase db reset` applies every
-- timestamped file in supabase/migrations, so a rollback stored there would
-- undo the migration it is meant to reverse on every reset. Apply this file
-- only as a deliberate, separately approved operation.
--
-- ORDER MATTERS, AND THE FIRST STEP IS NOT OPTIONAL.
--
--   1. Restore public.purge_account_data(text) to its pre-FLA-396 definition.
--   2. Drop the three analytics views.
--   3. Drop public.record_signup(...).
--   4. Drop public.signup_log.
--
-- Dropping the objects first would leave the live purge function referencing
-- public.signup_log after that table is gone, and plpgsql resolves table
-- references at execution time, so the next real account deletion would fail
-- outright -- a far worse outcome than the thing being rolled back. Restoring
-- the function first means that by the time the table disappears, nothing
-- refers to it. Do not reorder these steps.
--
-- The restored function body below is reproduced VERBATIM from
-- supabase/migrations/20260829120000_add_account_deletions.sql rather than
-- referenced, so this file is self-contained and cannot silently drift if that
-- migration is ever edited. Before running this on a hosted database, confirm
-- the live definition still matches what FLA-396 replaced
-- (pg_get_functiondef md5 was 7ac8659da4f5e701067d43d4606e1ab8 on production
-- and on a clean local reset on 2026-09-15); if something else has landed
-- since, restore that instead of this.
--
-- The rolled-back log data is not recoverable from Clerk metadata for deleted
-- accounts, and the table's rows are dropped by step 4. If the intent is to
-- stop writing rather than to erase, revert the webhook writer and leave these
-- objects in place instead.

begin;

-- ---------------------------------------------------------------------------
-- 1. Restore the pre-FLA-396 purge (no signup_log redaction statement).
-- ---------------------------------------------------------------------------
create or replace function public.purge_account_data(p_clerk_user_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_clerk_user_id is null or btrim(p_clerk_user_id) = '' then
    raise exception 'purge_account_data requires a non-empty clerk_user_id';
  end if;

  set local lock_timeout = '5s';

  perform pg_advisory_xact_lock(public.account_deletion_lock_key(p_clerk_user_id));

  insert into public.account_deletions (clerk_user_id)
  values (p_clerk_user_id)
  on conflict (clerk_user_id) do nothing;

  -- Every in-scope table. clerk_user_id-keyed tables first, then the two
  -- user_id-keyed MCP OAuth tables. oauth_states is intentionally excluded:
  -- it has no user column (state, redirect_uri, client_id only) and its rows
  -- already expire on their own via public.cleanup_expired_oauth_states(),
  -- regardless of account deletion.
  delete from public.espn_credentials where clerk_user_id = p_clerk_user_id;
  delete from public.espn_leagues where clerk_user_id = p_clerk_user_id;
  delete from public.espn_history_jobs where clerk_user_id = p_clerk_user_id;
  delete from public.yahoo_credentials where clerk_user_id = p_clerk_user_id;
  delete from public.yahoo_leagues where clerk_user_id = p_clerk_user_id;
  delete from public.platform_oauth_states where clerk_user_id = p_clerk_user_id;
  delete from public.sleeper_connections where clerk_user_id = p_clerk_user_id;
  delete from public.sleeper_leagues where clerk_user_id = p_clerk_user_id;
  delete from public.archived_leagues where clerk_user_id = p_clerk_user_id;
  delete from public.provider_sync_state where clerk_user_id = p_clerk_user_id;
  delete from public.user_preferences where clerk_user_id = p_clerk_user_id;
  delete from public.oauth_tokens where user_id = p_clerk_user_id;
  delete from public.oauth_codes where user_id = p_clerk_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Drop the analytics views (they depend on public.signup_log).
-- ---------------------------------------------------------------------------
drop view if exists analytics.signup_sources_daily;
drop view if exists analytics.signup_rollups;
drop view if exists analytics.signups_daily;

-- ---------------------------------------------------------------------------
-- 3. Drop the write RPC.
-- ---------------------------------------------------------------------------
drop function if exists public.record_signup(text, timestamptz, jsonb, text);

-- ---------------------------------------------------------------------------
-- 4. Drop the log itself.
-- ---------------------------------------------------------------------------
drop table if exists public.signup_log;

commit;
