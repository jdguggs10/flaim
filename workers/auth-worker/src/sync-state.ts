/**
 * Provider Sync State - per-user/provider single-flight lease, cooldown, and
 * last-run telemetry for league refresh/discovery (FLA-121).
 * ---------------------------------------------------------------------------
 *
 * Table: provider_sync_state (see flaim-docs/migrations/045_provider_sync_state.sql).
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

export type SyncProvider = 'espn' | 'yahoo' | 'sleeper';
export type SyncSource = 'web' | 'mcp' | 'extension' | 'scheduled';

export type SyncLeaseState = 'in_progress' | 'cooldown';

export type SyncLeaseAcquisition =
  | { acquired: true }
  | { acquired: false; state: SyncLeaseState; retryAfterSeconds: number };

export interface SyncSettleOutcome {
  status: 'success' | 'error';
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
  return Math.min(Math.ceil(remainingMs / 1000), UPSTREAM_BACKOFF_COOLDOWN_SECONDS);
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
            : {
                last_failure_at: now,
                last_error_code: outcome.errorCode ?? 'refresh_failed',
                last_error_message: outcome.errorMessage?.slice(0, 500) ?? null,
              }),
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
