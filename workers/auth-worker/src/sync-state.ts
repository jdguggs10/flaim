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

/**
 * The synthetic `clerk_user_id` used only by the Sleeper recurring-id
 * backfill's single-flight lease (`sleeper-recurring-backfill.ts`'s
 * `BACKFILL_LEASE_USER_ID`, kept as its own literal there rather than
 * imported from here, so this file's hard-scoping can't be widened by a
 * sibling file's constant). `acquireLease`'s strict-mode cleanup (PR #206
 * review, round-6) checks a caller's `clerkUserId` against this literal
 * before ever issuing a delete — not against whatever value the caller
 * happened to pass — so a future strict-mode caller acquiring a lease for a
 * real user can never trigger it, even by accident.
 */
const BACKFILL_SYNTHETIC_USER_ID = '__backfill__';

export type SyncProvider = 'espn' | 'yahoo' | 'sleeper';
export type SyncSource = 'web' | 'mcp' | 'extension' | 'scheduled';

export type SyncLeaseState = 'in_progress' | 'cooldown';

export type SyncLeaseAcquisition =
  | { acquired: true }
  | { acquired: false; state: SyncLeaseState; retryAfterSeconds: number };

/**
 * Returned only by the `{ onStorageError: 'fail' }` opt-in (round-4 FLA-168
 * audit finding) — distinguishable from the normal "another owner holds the
 * lease" result above via `state: 'error'` rather than `'in_progress'` /
 * `'cooldown'`, so a caller can tell "the lease is genuinely held elsewhere,
 * retry later" apart from "we don't actually know who holds it, a
 * provider_sync_state outage is masking the real state."
 */
export type SyncLeaseAcquisitionError = { acquired: false; state: 'error'; errorMessage: string };

/**
 * A checkpoint hook a long-running lease holder calls periodically (at points
 * spaced well under the lease TTL) to renew before expiry. Returns `false`
 * the moment renewal fails — storage error or the lease already stolen by a
 * new holder — and every later call is expected to also return `false`
 * without retrying, so the caller's very next checkpoint halts it instead of
 * racing a new holder. `sleeper-recurring-backfill.ts`'s `createLeaseRenewer`
 * is the only current implementation (round-4 FLA-168 audit finding); the
 * type lives here, not there, so `sleeper-connect-handlers.ts` can accept one
 * without importing from the orchestrator that already imports it.
 */
export type LeaseRenewalCheckpoint = () => Promise<boolean>;

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

/**
 * Shared by both `acquireLease` branches (default and strict-mode) once the
 * blocking row — or `null`, if the diagnostic read itself came back empty —
 * is known: turns it into the normal "someone else holds it" result. Kept
 * identical for both branches so strict mode's Fix 3 diagnostic-error
 * handling (round-5 FLA-168 audit finding) changes only how a storage
 * failure on the diagnostic read itself is reported, not how a successfully
 * read blocking row is turned into a result.
 */
function buildBlockedResult(blocking: SyncStateRow | null, nowMs: number): SyncLeaseAcquisition {
  const state: SyncLeaseState = blocking?.sync_lease_owner?.startsWith(SYNC_COOLDOWN_OWNER_PREFIX)
    ? 'cooldown'
    : 'in_progress';
  return {
    acquired: false,
    state,
    retryAfterSeconds: boundedRetryAfterSeconds(blocking?.sync_lease_expires_at ?? null, nowMs),
  };
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
   * blocking state and a Retry-After hint. Storage errors fail open by
   * default: refresh availability matters more than cooldown enforcement for
   * every existing caller (per-user provider refresh, reconciliation).
   *
   * `{ onStorageError: 'fail' }` is an explicit opt-in (round-4 FLA-168 audit
   * finding) for a caller where fail-open is actively wrong — the Sleeper
   * recurring-id backfill's single-flight guard, where a provider_sync_state
   * outage failing open would let multiple live backfill runs proceed
   * leaseless and race writes. It reports the storage error back as
   * `{ acquired: false, state: 'error', errorMessage }` — distinguishable
   * from the normal "someone else holds it" result — instead of the default
   * `{ acquired: true }`. Overloaded so every caller that doesn't pass this
   * option keeps the original three-branch return type unchanged; only a
   * caller that explicitly asks for it sees the widened type.
   *
   * When the guarded update matches zero rows, the follow-up diagnostic read
   * (which owner/state is actually blocking) is itself a storage call and can
   * itself fail. In strict mode ONLY, that diagnostic-read failure is now
   * surfaced as `state: 'error'` too (round-5 FLA-168 audit finding) — before
   * this fix it fell through to the same `null`-blocking-row handling as "no
   * row found," misreporting a genuine storage outage as `'in_progress'`
   * (the strict caller then saw a 409 `'blocked'` instead of `'failed'`).
   * Default-mode callers (every existing one) are unaffected: they still go
   * through the original `getRow` helper and its plain fail-to-null
   * behavior, unchanged.
   *
   * PR #206 review finding (Codex, round-6): the upsert above can succeed —
   * creating a fresh, unowned row for a (clerk_user_id, provider) pair that
   * didn't exist yet — and then the guarded update can itself throw (a
   * transient PostgREST failure), or, once it matches zero rows, the
   * diagnostic read that follows can throw. Either way this method returns
   * `state: 'error'` without ever having set an owner, and the orchestrator
   * that called `acquireLease` never runs its cleanup (`deleteLeaseRow` is
   * only reached after a *held* lease). For the backfill's synthetic
   * `__backfill__` key specifically, that stranded row has no owner and no
   * expiry to ever age it out, so it sits in `provider_sync_state` forever,
   * inflating the dashboard's `sync_7d` metric. Both strict-mode error exits
   * below now call `cleanupUnownedSyntheticRow` first: a best-effort,
   * conditional `DELETE` scoped to `(clerk_user_id, provider) AND
   * sync_lease_owner IS NULL`. The `IS NULL` guard means it can never remove
   * a lease genuinely held by another run (a non-null owner makes it match
   * zero rows), and the hard-coded synthetic-user check inside that helper
   * means it can never touch a real user's row even if some future caller
   * adopts `{ onStorageError: 'fail' }` with a real clerk_user_id. Cleanup
   * failures are logged and swallowed — this is a best-effort tidy-up, not
   * part of the method's own success/failure contract, so the original error
   * result is always returned unchanged.
   */
  async acquireLease(
    clerkUserId: string,
    provider: SyncProvider,
    ownerId: string,
    ttlMs?: number
  ): Promise<SyncLeaseAcquisition>;
  async acquireLease(
    clerkUserId: string,
    provider: SyncProvider,
    ownerId: string,
    ttlMs: number,
    options: { onStorageError: 'fail' }
  ): Promise<SyncLeaseAcquisition | SyncLeaseAcquisitionError>;
  async acquireLease(
    clerkUserId: string,
    provider: SyncProvider,
    ownerId: string,
    ttlMs: number = SYNC_LEASE_TTL_MS,
    options: { onStorageError?: 'acquire' | 'fail' } = {}
  ): Promise<SyncLeaseAcquisition | SyncLeaseAcquisitionError> {
    const failClosed = options.onStorageError === 'fail';
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

      // Round-5 FLA-168 audit finding (Fix 3): in strict mode, a failure of
      // this diagnostic "who's blocking?" read must itself surface as
      // `state: 'error'`, not silently collapse into "no row found" (which
      // reports the same `'in_progress'` a genuinely-held lease would). The
      // caller opted into `{ onStorageError: 'fail' }` specifically to tell
      // "the lease is truly held elsewhere" apart from "storage is unhealthy
      // and we don't actually know" — a swallowed read here would defeat
      // that for exactly the follow-up read most likely to hit the same
      // outage that's already causing trouble. Default-mode callers keep
      // using `getRow`, whose fail-to-null behavior is untouched.
      if (failClosed) {
        const { data: blockingRow, error: getRowError } = await this.supabase
          .from('provider_sync_state')
          .select('sync_lease_owner, sync_lease_expires_at')
          .eq('clerk_user_id', clerkUserId)
          .eq('provider', provider)
          .single();
        if (getRowError) {
          const message = getRowError.message;
          console.error(`[sync-state] Diagnostic lease-state read failed closed (opt-in) for ${provider}:`, getRowError);
          await this.cleanupUnownedSyntheticRow(clerkUserId, provider);
          return { acquired: false, state: 'error', errorMessage: message };
        }
        return buildBlockedResult((blockingRow as SyncStateRow) ?? null, nowMs);
      }

      const blocking = await this.getRow(clerkUserId, provider);
      return buildBlockedResult(blocking, nowMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[sync-state] Lease acquisition failed ${failClosed ? 'closed (opt-in)' : 'open'} for ${provider}:`, error);
      if (failClosed) {
        await this.cleanupUnownedSyntheticRow(clerkUserId, provider);
        return { acquired: false, state: 'error', errorMessage: message };
      }
      return { acquired: true };
    }
  }

  /**
   * Best-effort tidy-up for the strict `acquireLease` error paths (PR #206
   * review finding, round-6): deletes the row for `(clerkUserId, provider)`
   * ONLY if it is currently unowned (`sync_lease_owner IS NULL`) — never a
   * row genuinely held by another run, since a non-null owner makes the
   * conditional `DELETE` match zero rows regardless of what this call site
   * believes about the current state.
   *
   * Hard-scoped to the backfill's literal synthetic user id, not to
   * whatever `clerkUserId` the caller passed, even though today the strict
   * overload only ever gets called with it: this is the design that "cannot
   * ever touch real-user rows even if a future caller adopts strict mode"
   * (PR #206 review) — a future strict-mode caller acquiring a lease for a
   * REAL clerk_user_id would silently no-op here instead of risking a
   * conditional delete against real refresh/cooldown telemetry.
   *
   * Failures are logged and swallowed: this cleanup is strictly best-effort
   * and must never change what `acquireLease` reports to its caller.
   */
  private async cleanupUnownedSyntheticRow(clerkUserId: string, provider: SyncProvider): Promise<void> {
    if (clerkUserId !== BACKFILL_SYNTHETIC_USER_ID) return;
    try {
      const { error } = await this.supabase
        .from('provider_sync_state')
        .delete()
        .eq('clerk_user_id', clerkUserId)
        .eq('provider', provider)
        .is('sync_lease_owner', null);
      if (error) throw error;
    } catch (cleanupError) {
      console.warn(
        `[sync-state] Best-effort cleanup of an unowned synthetic lease row failed after a strict-mode acquisition error for ${provider}:`,
        cleanupError
      );
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
   * Delete this owner's row outright, rather than clearing it back to an
   * unheld state. For a caller whose (clerk_user_id, provider) key is a
   * synthetic pseudo-user rather than a real refresh target (the FLA-168
   * Sleeper recurring-id backfill's single-flight lease) and so has no
   * cooldown/telemetry history worth keeping between runs — a row left
   * behind indefinitely would sit in `provider_sync_state`, inflating
   * `sync_7d.users_attempted` and risking a phantom Sleeper provider entry
   * in `sync_recent` (audit FLA-168 Fix 3).
   *
   * Do NOT use this for a real user/provider row: this permanently destroys
   * the row's last_success_at/cooldown history. Owner-guarded so a lease
   * already stolen by a new holder (e.g. after a failed extendLease) is left
   * untouched instead of being deleted out from under it.
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
