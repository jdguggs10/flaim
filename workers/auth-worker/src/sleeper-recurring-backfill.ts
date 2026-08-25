/**
 * One-off backfill orchestrator for Sleeper `recurring_league_id` (FLA-168).
 * ---------------------------------------------------------------------------
 *
 * Finds distinct users with at least one `sleeper_leagues` row missing
 * `recurring_league_id`, then re-runs backfillSleeperRecurringIds's full
 * previous_league_id chain walk for each — resolving the canonical root
 * rather than the cheap `= league_id` shortcut applied at write time before
 * this migration.
 *
 * Default is dry-run: the internal route below requires an explicit
 * `dryRun: false` to perform writes. Every run emits structured
 * `sleeper_recurring_backfill` JSON log lines, mirroring reconciliation.ts's
 * `league_reconciliation` event style.
 *
 * Concurrency: live (dryRun:false) runs single-flight via the same
 * provider_sync_state lease machinery used for per-user provider syncs
 * (sync-state.ts), keyed on a reserved pseudo-user id rather than a real
 * clerk_user_id. This is a global lock across all users being backfilled in
 * one run — adequate because this route is an operator-triggered one-off,
 * not a per-user user-facing action. A second concurrent live run gets a 409
 * instead of racing writes against the first. Dry runs are read-only and
 * skip the guard entirely (audit FLA-168 Fix 5).
 *
 * The lease is renewed after every user batch so a run that outlives the
 * 120s TTL doesn't let a second live run acquire mid-run (audit FLA-168
 * Fix 1); if renewal ever fails (lease already expired and re-acquired by
 * someone else), the run stops touching rows immediately and returns a
 * `lease_lost` outcome with whatever partial counts it completed. On a normal
 * finish, the synthetic lease row is deleted outright rather than released
 * back to an unheld state (audit FLA-168 Fix 3) — it has no real user's
 * telemetry worth keeping, and a leftover row would otherwise sit in
 * provider_sync_state indefinitely, inflating sync_7d.users_attempted and
 * risking a phantom Sleeper entry in sync_recent. The row is still visible
 * for the run's own (manual, minutes-long) duration, which is acceptable.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { backfillSleeperRecurringIds, type SleeperConnectEnv } from './sleeper-connect-handlers';
import { SyncStateStorage, type SyncProvider } from './sync-state';

export type SleeperRecurringBackfillEnv = SleeperConnectEnv;

const SNAPSHOT_PAGE_SIZE = 1000;
const BATCH_SIZE = 2;

// Synthetic (clerk_user_id, provider) key for the backfill's single-flight
// lease. No schema change needed: provider_sync_state's primary key is
// (clerk_user_id, provider) with no FK to a real users table, and 'sleeper'
// already satisfies its provider check constraint.
const BACKFILL_LEASE_USER_ID = '__backfill__';
const BACKFILL_LEASE_PROVIDER: SyncProvider = 'sleeper';
const BACKFILL_LEASE_OWNER_PREFIX = 'sleeper-recurring-backfill:';

function maskUserId(userId: string): string {
  if (!userId || userId.length <= 8) return '***';
  return `${userId.substring(0, 8)}...`;
}

function logBackfill(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event: 'sleeper_recurring_backfill', service: 'auth-worker', ...fields }));
}

/**
 * Distinct clerk_user_ids with at least one sleeper_leagues row where
 * recurring_league_id IS NULL. Selects only the id column and pages through
 * results — the full table is never loaded, matching fetchProviderSnapshot's
 * select-only, paginated approach in reconciliation.ts.
 */
async function fetchUsersMissingRecurringId(supabase: SupabaseClient): Promise<string[]> {
  const userIds = new Set<string>();
  for (let offset = 0; ; offset += SNAPSHOT_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('sleeper_leagues')
      .select('clerk_user_id')
      .is('recurring_league_id', null)
      // Tiebreakers so pages have a total order even though only clerk_user_id
      // is selected — (clerk_user_id, league_id, season_year) is a unique
      // constraint on sleeper_leagues, mirroring fetchProviderSnapshot's
      // ordering in reconciliation.ts.
      .order('clerk_user_id', { ascending: true })
      .order('league_id', { ascending: true })
      .order('season_year', { ascending: true })
      .range(offset, offset + SNAPSHOT_PAGE_SIZE - 1);
    if (error) throw new Error(`sleeper_leagues snapshot query failed: ${error.message}`);

    const page = (data ?? []) as unknown as Array<{ clerk_user_id: string }>;
    for (const row of page) userIds.add(row.clerk_user_id);
    if (page.length < SNAPSHOT_PAGE_SIZE) break;
  }
  return Array.from(userIds);
}

// 'lease_lost' = the lease was renewed after a batch and had already expired
// and been re-acquired by a new run (audit FLA-168 Fix 1) — processing stops
// immediately and the summary carries whatever was completed so far.
export type SleeperRecurringBackfillOutcome = 'completed' | 'failed' | 'blocked' | 'lease_lost';

export type SleeperRecurringBackfillSummary =
  | {
      outcome: SleeperRecurringBackfillOutcome;
      dryRun: true;
      usersScanned: number;
      rowsProcessed: number;
      rowsResolved: number;
      rowsUnresolved: number;
      rowsWouldChange: number;
      errors: number;
    }
  | {
      outcome: SleeperRecurringBackfillOutcome;
      dryRun: false;
      usersScanned: number;
      rowsProcessed: number;
      rowsResolved: number;
      rowsUnresolved: number;
      rowsChanged: number;
      errors: number;
    };

export async function runSleeperRecurringBackfill(
  env: SleeperRecurringBackfillEnv,
  dryRun: boolean
): Promise<SleeperRecurringBackfillSummary> {
  const startedAt = Date.now();
  const runId = crypto.randomUUID();
  const leaseOwner = `${BACKFILL_LEASE_OWNER_PREFIX}${runId}`;

  let outcome: SleeperRecurringBackfillOutcome = 'completed';
  let usersScanned = 0;
  let rowsProcessed = 0;
  let rowsResolved = 0;
  let rowsUnresolved = 0;
  let rowsChanged = 0;
  let errors = 0;
  let retryAfterSeconds: number | undefined;

  logBackfill({ run_id: runId, status: 'run_start', dry_run: dryRun });

  // Single-flight guard for live runs only (audit FLA-168 Fix 5): dry runs
  // never write, so two concurrent dry runs can't race anything.
  const syncState = dryRun ? null : SyncStateStorage.fromEnvironment(env);
  const lease = syncState
    ? await syncState.acquireLease(BACKFILL_LEASE_USER_ID, BACKFILL_LEASE_PROVIDER, leaseOwner)
    : null;

  if (lease && !lease.acquired) {
    outcome = 'blocked';
    retryAfterSeconds = lease.retryAfterSeconds;
    logBackfill({ run_id: runId, status: 'blocked', dry_run: dryRun, retry_after: retryAfterSeconds });
  } else {
    try {
      const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
        auth: { persistSession: false },
      });
      const userIds = await fetchUsersMissingRecurringId(supabase);
      usersScanned = userIds.length;

      for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
        const batch = userIds.slice(i, i + BATCH_SIZE);
        // Isolate per-user failures: an unexpected throw for one user must not
        // abandon the rest of the batch, mirroring runReconciliation's
        // candidate isolation in reconciliation.ts.
        await Promise.all(
          batch.map(async (userId) => {
            try {
              const result = await backfillSleeperRecurringIds(env, userId, { dryRun });
              rowsProcessed += result.processed;
              rowsResolved += result.resolved;
              rowsUnresolved += result.unresolved;
              rowsChanged += result.changed;
              logBackfill({
                run_id: runId,
                status: 'user_processed',
                user_id: maskUserId(userId),
                processed: result.processed,
                resolved: result.resolved,
                unresolved: result.unresolved,
                changed: result.changed,
              });
            } catch (error) {
              errors++;
              logBackfill({ run_id: runId, status: 'user_failed', user_id: maskUserId(userId) });
              console.error(
                `[sleeper-recurring-backfill] Failed for user ${maskUserId(userId)}:`,
                error instanceof Error ? error.message : error
              );
            }
          })
        );

        // Renew the lease after every batch (audit FLA-168 Fix 1): the
        // 120s SYNC_LEASE_TTL_MS was sized for a single provider refresh, not
        // a whole backfill run, which can easily outlive it across many
        // batches. Without renewal, a second live run could acquire mid-run
        // and race writes against this one. The owner-guarded renewal only
        // succeeds while this run still holds the lease; if it comes back
        // false, the lease already expired and was re-acquired by that other
        // run, so this run stops touching rows immediately rather than
        // racing the new holder — no throw, just a structured outcome.
        if (syncState) {
          const stillHeld = await syncState.extendLease(BACKFILL_LEASE_USER_ID, BACKFILL_LEASE_PROVIDER, leaseOwner);
          if (!stillHeld) {
            outcome = 'lease_lost';
            logBackfill({
              run_id: runId,
              status: 'lease_lost',
              dry_run: dryRun,
              users_scanned: usersScanned,
              rows_processed: rowsProcessed,
              rows_resolved: rowsResolved,
              rows_unresolved: rowsUnresolved,
              rows_changed: rowsChanged,
            });
            break;
          }
        }
      }
    } catch (error) {
      outcome = 'failed';
      console.error('[sleeper-recurring-backfill] Run failed:', error instanceof Error ? error.message : error);
    } finally {
      if (syncState) {
        // Delete rather than release (audit FLA-168 Fix 3): this row's
        // (clerk_user_id, provider) key is the synthetic '__backfill__'/
        // 'sleeper' pseudo-user, not a real refresh target, so nothing should
        // persist here between runs — a leftover row would inflate
        // sync_7d.users_attempted and could phantom a Sleeper provider entry
        // in sync_recent. The row IS visible for this run's own duration
        // (this route is a manual, operator-triggered, minutes-long
        // one-off — that transient visibility is acceptable). Owner-guarded
        // exactly like release() was, so if the lease was already stolen
        // (the lease_lost path above), this deletes zero rows rather than
        // clobbering the new holder's row.
        await syncState.deleteLeaseRow(BACKFILL_LEASE_USER_ID, BACKFILL_LEASE_PROVIDER, leaseOwner);
      }
    }
  }

  const durationMs = Date.now() - startedAt;
  logBackfill({
    run_id: runId,
    status: 'run_end',
    outcome,
    dry_run: dryRun,
    users_scanned: usersScanned,
    rows_processed: rowsProcessed,
    rows_resolved: rowsResolved,
    rows_unresolved: rowsUnresolved,
    ...(dryRun ? { rows_would_change: rowsChanged } : { rows_changed: rowsChanged }),
    errors,
    duration_ms: durationMs,
    ...(retryAfterSeconds !== undefined ? { retry_after: retryAfterSeconds } : {}),
  });

  return dryRun
    ? { outcome, dryRun: true, usersScanned, rowsProcessed, rowsResolved, rowsUnresolved, rowsWouldChange: rowsChanged, errors }
    : { outcome, dryRun: false, usersScanned, rowsProcessed, rowsResolved, rowsUnresolved, rowsChanged, errors };
}

// =============================================================================
// REQUEST PARSING (refuse-don't-fallback on malformed bodies, mirroring
// parseReconciliationConfig / parseLeagueRefreshRequest)
// =============================================================================

export interface BackfillRequestValidation {
  dryRun?: boolean;
  error?: {
    status: 400;
    body: {
      error: string;
      error_description: string;
    };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Body is `{ dryRun?: boolean }`; missing/absent dryRun defaults to true. */
export async function parseSleeperRecurringBackfillRequest(request: Request): Promise<BackfillRequestValidation> {
  const rawBody = await request.text();
  if (!rawBody.trim()) {
    return { dryRun: true };
  }

  let body: unknown;
  try {
    // JSON.parse is last-wins on duplicate keys (e.g. `{"dryRun":true,"dryRun":false}`
    // parses as `{ dryRun: false }`) — there is no raw-text duplicate-key
    // detection here (audit FLA-168 Fix 4). Accepted: this route is
    // internal-token-gated (requireInternalService, index-hono.ts), not
    // reachable by an untrusted caller who'd have a reason to smuggle a
    // second key past a naive reviewer of the request body.
    body = JSON.parse(rawBody);
  } catch {
    return {
      error: {
        status: 400,
        body: { error: 'invalid_request', error_description: 'Request body must be valid JSON' },
      },
    };
  }

  if (!isRecord(body)) {
    return {
      error: {
        status: 400,
        body: { error: 'invalid_request', error_description: 'Request body must be a JSON object' },
      },
    };
  }

  if (body.dryRun === undefined) {
    return { dryRun: true };
  }

  if (typeof body.dryRun !== 'boolean') {
    return {
      error: {
        status: 400,
        body: { error: 'invalid_dry_run', error_description: 'dryRun must be a boolean' },
      },
    };
  }

  return { dryRun: body.dryRun };
}
