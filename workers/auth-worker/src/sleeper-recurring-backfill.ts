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

export type SleeperRecurringBackfillSummary =
  | {
      outcome: 'completed' | 'failed' | 'blocked';
      dryRun: true;
      usersScanned: number;
      rowsProcessed: number;
      rowsResolved: number;
      rowsUnresolved: number;
      rowsWouldChange: number;
      errors: number;
    }
  | {
      outcome: 'completed' | 'failed' | 'blocked';
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

  let outcome: 'completed' | 'failed' | 'blocked' = 'completed';
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
      }
    } catch (error) {
      outcome = 'failed';
      console.error('[sleeper-recurring-backfill] Run failed:', error instanceof Error ? error.message : error);
    } finally {
      if (syncState) {
        await syncState.release(BACKFILL_LEASE_USER_ID, BACKFILL_LEASE_PROVIDER, leaseOwner);
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
