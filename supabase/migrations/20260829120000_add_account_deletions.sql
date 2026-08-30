-- Self-service account deletion purge and anti-resurrection guards (FLA-311).
--
-- Users delete their account via Clerk's native self-serve UI. A dedicated
-- auth-worker webhook (POST /webhooks/clerk/account-deletion) verifies the
-- Clerk `user.deleted` Svix payload and calls public.purge_account_data(),
-- which is the ONLY place connected-platform credentials and league data are
-- permanently removed for a deleted account. Usage-analytics tables
-- (mcp_tool_events, mcp_user_daily, mcp_tool_daily, analytics.internal_users)
-- are explicitly out of scope and untouched. A permanent tombstone with the
-- raw Clerk user ID and a timestamp remains in public.account_deletions so
-- the guard triggers below can keep rejecting writes for a deleted account
-- indefinitely.

-- ---------------------------------------------------------------------------
-- 1. Permanent tombstone
-- ---------------------------------------------------------------------------
create table public.account_deletions (
  clerk_user_id text primary key,
  deleted_at timestamptz not null default now()
);

alter table public.account_deletions enable row level security;
revoke all on table public.account_deletions from public, anon, authenticated;

-- GRANT is additive, and the baseline migration's default privileges grant
-- service_role ALL on every new public table
-- (20260727230606_baseline.sql:2124). Without this explicit revoke first,
-- service_role would inherit UPDATE/DELETE/TRUNCATE here in addition to the
-- SELECT/INSERT granted below, letting a compromised or buggy service-role
-- caller mutate or erase the permanent tombstone the guard trigger relies on.
revoke all on table public.account_deletions from service_role;
grant select, insert on table public.account_deletions to service_role;

-- ---------------------------------------------------------------------------
-- 2. Shared advisory-lock key
--
-- public.purge_account_data() and the guard trigger function below MUST
-- acquire the identical lock key for the same clerk_user_id, or the mutual
-- exclusion between "delete this account" and "write for this account" is
-- silently defeated with no error. Routing both call sites through this one
-- function makes that divergence impossible instead of merely disciplined.
--
-- hashtextextended's second argument is a seed; it spreads the full 64-bit
-- range. The existing hashtext() idiom at
-- 20260727230606_baseline.sql:564 (public.acquire_public_chat_run) is only
-- 32-bit and is not reused here.
-- ---------------------------------------------------------------------------
create function public.account_deletion_lock_key(p_clerk_user_id text)
returns bigint
language sql
immutable
security invoker
set search_path = ''
as $$
  select hashtextextended(p_clerk_user_id, 0);
$$;

revoke all on function public.account_deletion_lock_key(text) from public, anon, authenticated;
grant execute on function public.account_deletion_lock_key(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Purge RPC
--
-- Called once per verified `user.deleted` webhook delivery, and safely
-- replayed by a Svix retry or a redelivered event. Always runs the full
-- delete list below, even when the tombstone already existed on entry -- a
-- replayed call for an already-deleted user must still clean up any table
-- added to this list later. Do not gate the deletes behind "if inserted".
--
-- lock_timeout is SET LOCAL here, and ONLY here -- never on the trigger/
-- writer side below. An ordinary application write should keep waiting on
-- lock contention like any other write; only this purge path needs a hard,
-- bounded worst case.
--
-- Known-safe deadlock class (documented, no further mitigation needed): this
-- function takes the advisory lock first, then table row locks via the
-- deletes. The ESPN history RPCs (advance_espn_history_job,
-- finish_espn_history_job in 20260827004306_add_espn_history_jobs.sql, and
-- claim_next_espn_history_backfill_job in
-- 20260827010000_add_espn_history_backfill_claim.sql) take a row lock
-- (FOR UPDATE) on espn_credentials or provider_sync_state first, then reach
-- this same advisory lock through the guard trigger below when they write
-- espn_leagues or provider_sync_state. The two opposite lock orders can
-- deadlock; Postgres detects that within ~1s and aborts one side. Every
-- caller on both sides already retries safely (Workflow step retries, cron
-- re-entry, Svix redelivery), and this function's lock_timeout additionally
-- bounds the purge side's worst case.
-- ---------------------------------------------------------------------------
create function public.purge_account_data(p_clerk_user_id text)
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

revoke all on function public.purge_account_data(text) from public, anon, authenticated;
grant execute on function public.purge_account_data(text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Anti-resurrection guard trigger
--
-- One generic function bound to all 13 in-scope tables. The user-id column
-- name is a trigger argument (TG_ARGV[0]), read dynamically via
-- to_jsonb(NEW), never hardcoded: 11 tables key on clerk_user_id, but
-- oauth_tokens and oauth_codes key on user_id. Hardcoding NEW.clerk_user_id
-- would throw on every MCP OAuth code/token write for every user (full
-- MCP-login outage from deploy day).
--
-- This does NOT set lock_timeout -- see the note on purge_account_data above.
--
-- Fails closed: if TG_ARGV[0] names a column that is null or does not exist
-- on the row, this raises rather than silently skipping the check.
-- ---------------------------------------------------------------------------
create function public.reject_write_after_account_deletion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_column_name text := TG_ARGV[0];
  v_clerk_user_id text;
begin
  v_clerk_user_id := to_jsonb(NEW) ->> v_column_name;
  if v_clerk_user_id is null then
    raise exception using errcode = 'P0001',
      message = format('reject_write_after_account_deletion: column %s is null or missing on %s', v_column_name, TG_TABLE_NAME);
  end if;

  perform pg_advisory_xact_lock(public.account_deletion_lock_key(v_clerk_user_id));

  if exists (
    select 1 from public.account_deletions
    where clerk_user_id = v_clerk_user_id
  ) then
    raise exception using errcode = 'P0001',
      message = format('account %s was deleted; write to %s rejected', v_clerk_user_id, TG_TABLE_NAME);
  end if;

  return NEW;
end;
$$;

revoke all on function public.reject_write_after_account_deletion() from public, anon, authenticated;
grant execute on function public.reject_write_after_account_deletion() to service_role;

-- clerk_user_id-keyed tables (11):
create trigger reject_write_after_account_deletion
  before insert or update on public.espn_credentials
  for each row execute function public.reject_write_after_account_deletion('clerk_user_id');

create trigger reject_write_after_account_deletion
  before insert or update on public.espn_leagues
  for each row execute function public.reject_write_after_account_deletion('clerk_user_id');

create trigger reject_write_after_account_deletion
  before insert or update on public.espn_history_jobs
  for each row execute function public.reject_write_after_account_deletion('clerk_user_id');

create trigger reject_write_after_account_deletion
  before insert or update on public.yahoo_credentials
  for each row execute function public.reject_write_after_account_deletion('clerk_user_id');

create trigger reject_write_after_account_deletion
  before insert or update on public.yahoo_leagues
  for each row execute function public.reject_write_after_account_deletion('clerk_user_id');

create trigger reject_write_after_account_deletion
  before insert or update on public.platform_oauth_states
  for each row execute function public.reject_write_after_account_deletion('clerk_user_id');

create trigger reject_write_after_account_deletion
  before insert or update on public.sleeper_connections
  for each row execute function public.reject_write_after_account_deletion('clerk_user_id');

create trigger reject_write_after_account_deletion
  before insert or update on public.sleeper_leagues
  for each row execute function public.reject_write_after_account_deletion('clerk_user_id');

create trigger reject_write_after_account_deletion
  before insert or update on public.archived_leagues
  for each row execute function public.reject_write_after_account_deletion('clerk_user_id');

create trigger reject_write_after_account_deletion
  before insert or update on public.provider_sync_state
  for each row execute function public.reject_write_after_account_deletion('clerk_user_id');

create trigger reject_write_after_account_deletion
  before insert or update on public.user_preferences
  for each row execute function public.reject_write_after_account_deletion('clerk_user_id');

-- user_id-keyed tables (2):
create trigger reject_write_after_account_deletion
  before insert or update on public.oauth_tokens
  for each row execute function public.reject_write_after_account_deletion('user_id');

create trigger reject_write_after_account_deletion
  before insert or update on public.oauth_codes
  for each row execute function public.reject_write_after_account_deletion('user_id');

-- public.oauth_states is intentionally excluded from both the purge list
-- above and these guard triggers: it has no user column at all (state,
-- redirect_uri, client_id, expires_at only) and is cleaned up on its own
-- fixed expiry by public.cleanup_expired_oauth_states(), independent of
-- account deletion.
