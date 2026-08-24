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
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { backfillSleeperRecurringIds, type SleeperConnectEnv } from './sleeper-connect-handlers';

export type SleeperRecurringBackfillEnv = SleeperConnectEnv;

const SNAPSHOT_PAGE_SIZE = 1000;
const BATCH_SIZE = 2;

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
      .order('clerk_user_id', { ascending: true })
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
      outcome: 'completed' | 'failed';
      dryRun: true;
      usersScanned: number;
      rowsProcessed: number;
      rowsResolved: number;
      rowsWouldChange: number;
      errors: number;
    }
  | {
      outcome: 'completed' | 'failed';
      dryRun: false;
      usersScanned: number;
      rowsProcessed: number;
      rowsResolved: number;
      rowsChanged: number;
      errors: number;
    };

export async function runSleeperRecurringBackfill(
  env: SleeperRecurringBackfillEnv,
  dryRun: boolean
): Promise<SleeperRecurringBackfillSummary> {
  const startedAt = Date.now();
  const runId = crypto.randomUUID();

  let outcome: 'completed' | 'failed' = 'completed';
  let usersScanned = 0;
  let rowsProcessed = 0;
  let rowsResolved = 0;
  let rowsChanged = 0;
  let errors = 0;

  logBackfill({ run_id: runId, status: 'run_start', dry_run: dryRun });

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
            rowsChanged += result.changed;
            logBackfill({
              run_id: runId,
              status: 'user_processed',
              user_id: maskUserId(userId),
              processed: result.processed,
              resolved: result.resolved,
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
    ...(dryRun ? { rows_would_change: rowsChanged } : { rows_changed: rowsChanged }),
    errors,
    duration_ms: durationMs,
  });

  return dryRun
    ? { outcome, dryRun: true, usersScanned, rowsProcessed, rowsResolved, rowsWouldChange: rowsChanged, errors }
    : { outcome, dryRun: false, usersScanned, rowsProcessed, rowsResolved, rowsChanged, errors };
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

  if (!isRecord(body) || body.dryRun === undefined) {
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
