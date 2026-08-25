/**
 * Provider Sync State - per-user/provider single-flight lease, cooldown, and
 * last-run telemetry for league refresh/discovery (FLA-121).
 * ---------------------------------------------------------------------------
 *
 * Table: provider_sync_state (see supabase/migrations/).
 * The lease columns follow the yahoo_credentials refresh-lease pattern
 * (yahoo-storage.ts): an unexpired sync_lease_owner blocks new refreshes;
 * a 'cooldown:'-prefixed owner marks post-refresh cooldown.
 *
 * All methods fail open: refresh availability matters more than cooldown
 * enforcement, so storage errors are logged and treated as "no lease state".
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export const SYNC_COOLDOWN_OWNER_PREFIX = 'cooldown:';

/** Normal post-refresh cooldown (issue spec: 60-90s). */
export const NORMAL_REFRESH_COOLDOWN_SECONDS = 75;
/** Cooldown after upstream 429/timeout, unless the provider sent a longer Retry-After. */
export const UPSTREAM_BACKOFF_COOLDOWN_SECONDS = 300;
/** In-flight lease TTL — must exceed the slowest provider refresh (ESPN discovery). */
export const SYNC_LEASE_TTL_MS = 120_000;
/**
 * Sanity ceiling for the Retry-After we report to blocked callers. Cooldowns
 * can legitimately exceed the default upstream backoff when a provider sends
 * a longer Retry-After, so this must not clamp real remaining time (PR #143
 * review: capping at the default backoff under-reported long cooldowns).
 */
export const MAX_REPORTED_RETRY_AFTER_SECONDS = 3_600;

export type SyncProvider = 'espn' | 'yahoo' | 'sleeper';
export type SyncSource = 'web' | 'mcp' | 'extension' | 'scheduled';

export type SyncLeaseState = 'in_progress' | 'cooldown';

export type SyncLeaseAcquisition =
  | { acquired: true }
  | { acquired: false; state: SyncLeaseState; retryAfterSeconds: number };

export interface SyncSettleOutcome {
  /**
   * 'skipped' = the provider was never attempted (e.g. no stored credentials).
   * It releases the lease without touching success/failure telemetry, so an
   * unconnected provider never gets a false last_success_at and a removed
   * credential never wipes the last real error (PR #143 review).
   */
  status: 'success' | 'error' | 'skipped';
  cooldownSeconds: number;
  syncSource: SyncSource;
  errorCode?: string;
  errorMessage?: string;
  leagueCount?: number;
  durationMs?: number;
}

interface SyncStateRow {
  sync_lease_owner: string | null;
  sync_lease_expires_at: string | null;
}

export interface SyncStateEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

function boundedRetryAfterSeconds(expiresAt: string | null, nowMs: number): number {
  if (!expiresAt) return NORMAL_REFRESH_COOLDOWN_SECONDS;
  const remainingMs = new Date(expiresAt).getTime() - nowMs;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 1;
  return Math.min(Math.ceil(remainingMs / 1000), MAX_REPORTED_RETRY_AFTER_SECONDS);
}

export class SyncStateStorage {
  constructor(private supabase: SupabaseClient) {}

  static fromEnvironment(env: SyncStateEnv): SyncStateStorage {
    return new SyncStateStorage(
      createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
        auth: { persistSession: false },
      })
    );
  }

  /**
   * Atomically acquire the sync lease for (user, provider).
   *
   * Ensures the row exists, then takes the lease only when no other owner
   * holds an unexpired lease or cooldown marker. Losing the race returns the
   * blocking state and a Retry-After hint. Storage errors fail open.
   */
  async acquireLease(
    clerkUserId: string,
    provider: SyncProvider,
    ownerId: string,
    ttlMs: number = SYNC_LEASE_TTL_MS
  ): Promise<SyncLeaseAcquisition> {
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + ttlMs).toISOString();

    try {
      const { error: upsertError } = await this.supabase
        .from('provider_sync_state')
        .upsert(
          { clerk_user_id: clerkUserId, provider },
          { onConflict: 'clerk_user_id,provider', ignoreDuplicates: true }
        );
      if (upsertError) throw upsertError;

      const { data, error } = await this.supabase
        .from('provider_sync_state')
        .update({
          sync_lease_owner: ownerId,
          sync_lease_expires_at: expiresAt,
          last_attempt_at: now,
          updated_at: now,
        })
        .eq('clerk_user_id', clerkUserId)
        .eq('provider', provider)
        .or(`sync_lease_owner.is.null,sync_lease_expires_at.lt.${now},sync_lease_expires_at.is.null`)
        .select('clerk_user_id');
      if (error) throw error;

      if ((data?.length ?? 0) > 0) return { acquired: true };

      const blocking = await this.getRow(clerkUserId, provider);
      const state: SyncLeaseState = blocking?.sync_lease_owner?.startsWith(SYNC_COOLDOWN_OWNER_PREFIX)
        ? 'cooldown'
        : 'in_progress';
      return {
        acquired: false,
        state,
        retryAfterSeconds: boundedRetryAfterSeconds(blocking?.sync_lease_expires_at ?? null, nowMs),
      };
    } catch (error) {
      console.error(`[sync-state] Lease acquisition failed open for ${provider}:`, error);
      return { acquired: true };
    }
  }

  /**
   * Renew this owner's still-held lease for another `ttlMs` (default
   * SYNC_LEASE_TTL_MS) — for a caller whose single run can outlive the lease
   * TTL (e.g. the FLA-168 Sleeper recurring-id backfill, which renews after
   * every user batch) so a second live run can't acquire mid-run just because
   * the original TTL elapsed while work was still in progress.
   *
   * Owner-guarded exactly like acquireLease's guarded update: the row is only
   * touched `.eq('sync_lease_owner', ownerId)`, so if the lease already
   * expired and was taken by someone else, the update matches zero rows and
   * this returns `false` instead of silently re-extending a lease that is no
   * longer this caller's to hold. Callers must treat `false` as "stop
   * immediately" — continuing to write after this would race the new holder.
   *
   * Storage errors fail CLOSED here (return `false`), deliberately diverging
   * from acquireLease/settle's fail-open posture (round-3 FLA-168 audit
   * finding): the one caller of this method (the Sleeper recurring-id
   * backfill) is idempotent and resumable, so aborting on an
   * uncertain-ownership renewal is safe, while continuing to write under
   * unknown ownership is not. If a future caller needs fail-open renewal
   * semantics, give it its own method rather than flipping this one back —
   * as of this fix, backfill is the only caller of extendLease.
   */
  async extendLease(
    clerkUserId: string,
    provider: SyncProvider,
    ownerId: string,
    ttlMs: number = SYNC_LEASE_TTL_MS
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();

    try {
      const { data, error } = await this.supabase
        .from('provider_sync_state')
        .update({
          sync_lease_expires_at: expiresAt,
          updated_at: now,
        })
        .eq('clerk_user_id', clerkUserId)
        .eq('provider', provider)
        .eq('sync_lease_owner', ownerId)
        .select('clerk_user_id');
      if (error) throw error;

      return (data?.length ?? 0) > 0;
    } catch (error) {
      console.error(`[sync-state] Lease extension failed closed for ${provider}:`, error);
      return false;
    }
  }

  /**
   * Settle a finished refresh: convert this owner's lease into a cooldown
   * marker and record last-run telemetry. Owner-guarded so a stale caller
   * cannot extend another request's cooldown. Storage errors fail open.
   */
  async settle(
    clerkUserId: string,
    provider: SyncProvider,
    ownerId: string,
    outcome: SyncSettleOutcome
  ): Promise<void> {
    const now = new Date().toISOString();
    const cooldownExpiresAt = new Date(Date.now() + outcome.cooldownSeconds * 1000).toISOString();

    try {
      const { error } = await this.supabase
        .from('provider_sync_state')
        .update({
          sync_lease_owner: `${SYNC_COOLDOWN_OWNER_PREFIX}${ownerId}`,
          sync_lease_expires_at: cooldownExpiresAt,
          ...(outcome.status === 'success'
            ? { last_success_at: now, last_error_code: null, last_error_message: null }
            : outcome.status === 'error'
              ? {
                  last_failure_at: now,
                  last_error_code: outcome.errorCode ?? 'refresh_failed',
                  last_error_message: outcome.errorMessage?.slice(0, 500) ?? null,
                }
              : {}),
          ...(outcome.leagueCount !== undefined ? { last_league_count: outcome.leagueCount } : {}),
          ...(outcome.durationMs !== undefined ? { last_duration_ms: outcome.durationMs } : {}),
          last_sync_source: outcome.syncSource,
          updated_at: now,
        })
        .eq('clerk_user_id', clerkUserId)
        .eq('provider', provider)
        .eq('sync_lease_owner', ownerId);
      if (error) throw error;
    } catch (error) {
      console.error(`[sync-state] Settle failed open for ${provider}:`, error);
    }
  }

  /**
   * Release this owner's lease outright — clears sync_lease_owner/expires_at
   * back to null without setting a cooldown marker or touching telemetry.
   * For callers using the lease purely as a single-flight concurrency guard
   * (e.g. the FLA-168 Sleeper recurring-id backfill's synthetic pseudo-user
   * lease) rather than a provider refresh with its own cooldown semantics.
   * Owner-guarded so a stale caller cannot release another request's lease.
   * Storage errors fail open (no-op) — same posture as acquireLease/settle.
   */
  async release(clerkUserId: string, provider: SyncProvider, ownerId: string): Promise<void> {
    try {
      const { error } = await this.supabase
        .from('provider_sync_state')
        .update({
          sync_lease_owner: null,
          sync_lease_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('clerk_user_id', clerkUserId)
        .eq('provider', provider)
        .eq('sync_lease_owner', ownerId);
      if (error) throw error;
    } catch (error) {
      console.error(`[sync-state] Lease release failed open for ${provider}:`, error);
    }
  }

  /**
   * Delete this owner's row outright, rather than clearing it back to an
   * unheld state like release() does. For a caller whose (clerk_user_id,
   * provider) key is a synthetic pseudo-user rather than a real refresh
   * target (the FLA-168 Sleeper recurring-id backfill's single-flight lease)
   * and so has no cooldown/telemetry history worth keeping between runs — a
   * row left behind after release() would sit in `provider_sync_state`
   * indefinitely, inflating `sync_7d.users_attempted` and risking a phantom
   * Sleeper provider entry in `sync_recent` (audit FLA-168 Fix 3).
   *
   * Do NOT use this for a real user/provider row: unlike release(), which
   * only clears the lease fields, this permanently destroys the row's
   * last_success_at/cooldown history. Owner-guarded exactly like release() so
   * a lease already stolen by a new holder (e.g. after a failed extendLease)
   * is left untouched instead of being deleted out from under it.
   *
   * Unlike the rest of this class, storage errors are reported to the caller
   * (returns `false`) rather than swallowed (round-3 FLA-168 audit finding):
   * a failed cleanup here silently leaves the synthetic '__backfill__' row
   * polluting dashboard sync metrics, so the backfill orchestrator surfaces
   * this in its response (`leaseCleanup: 'failed'`) and logs a warning —
   * without treating it as a reason to change the run's own outcome.
   */
  async deleteLeaseRow(clerkUserId: string, provider: SyncProvider, ownerId: string): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('provider_sync_state')
        .delete()
        .eq('clerk_user_id', clerkUserId)
        .eq('provider', provider)
        .eq('sync_lease_owner', ownerId);
      if (error) throw error;
      return true;
    } catch (error) {
      console.error(`[sync-state] Lease row delete failed for ${provider}:`, error);
      return false;
    }
  }

  private async getRow(clerkUserId: string, provider: SyncProvider): Promise<SyncStateRow | null> {
    const { data, error } = await this.supabase
      .from('provider_sync_state')
      .select('sync_lease_owner, sync_lease_expires_at')
      .eq('clerk_user_id', clerkUserId)
      .eq('provider', provider)
      .single();
    if (error || !data) return null;
    return data as SyncStateRow;
  }
}

// =============================================================================
// STRUCTURED REFRESH ENVELOPE LOG
// =============================================================================

function maskUserId(userId: string): string {
  if (!userId || userId.length <= 8) return '***';
  return `${userId.substring(0, 8)}...`;
}

export interface SyncEnvelopeLog {
  provider: SyncProvider;
  userId: string;
  syncSource: SyncSource;
  status: 'success' | 'skipped' | 'error' | 'cooldown_blocked';
  httpStatus?: number;
  durationMs?: number;
  leagueCount?: number;
  errorCode?: string;
  retryAfterSeconds?: number;
  correlationId?: string;
  ownerId?: string;
}

/** One structured JSON line per provider refresh, queryable in Workers Logs. */
export function logSyncEnvelope(fields: SyncEnvelopeLog): void {
  console.log(JSON.stringify({
    event: 'provider_sync',
    service: 'auth-worker',
    provider: fields.provider,
    user_id: maskUserId(fields.userId),
    sync_source: fields.syncSource,
    status: fields.status,
    ...(fields.httpStatus !== undefined ? { http_status: fields.httpStatus } : {}),
    ...(fields.durationMs !== undefined ? { duration_ms: fields.durationMs } : {}),
    ...(fields.leagueCount !== undefined ? { league_count: fields.leagueCount } : {}),
    ...(fields.errorCode ? { error_code: fields.errorCode } : {}),
    ...(fields.retryAfterSeconds !== undefined ? { retry_after: fields.retryAfterSeconds } : {}),
    ...(fields.correlationId ? { correlation_id: fields.correlationId } : {}),
    ...(fields.ownerId ? { owner_id: fields.ownerId } : {}),
  }));
}
