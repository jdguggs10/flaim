/**
 * Staggered dispatcher for legacy ESPN history backfill.
 *
 * This is intentionally separate from the interactive durable-history gate.
 * `claimNextBackfill` is the storage-layer atomic selector: it prepares one
 * eligible job and transfers its ESPN lease to `history:<jobId>` before this
 * dispatcher creates the Workflow. Keeping selection there avoids a scheduler
 * read-then-create race and lets interactive refresh retain the same lease
 * boundary.
 */

import {
  EspnHistoryJobStorage,
  startQueuedEspnHistoryJob,
  type EspnHistoryEnv,
  type EspnHistoryClaimedJob,
} from './espn-history';
import { SyncStateStorage } from './sync-state';

export type EspnHistoryBackfillMode = 'off' | 'allowlist' | 'all';
export type EspnHistoryBackfillTrigger = 'cron' | 'manual';
export type EspnHistoryBackfillOutcome = 'disabled' | 'refused' | 'idle' | 'queued' | 'failed';

export interface EspnHistoryBackfillEnv extends EspnHistoryEnv {
  ESPN_HISTORY_BACKFILL_MODE?: string;
  ESPN_HISTORY_BACKFILL_USERS?: string;
  ESPN_HISTORY_BACKFILL_LEGACY_CUTOFF?: string;
}

export interface EspnHistoryBackfillSummary {
  trigger: EspnHistoryBackfillTrigger;
  outcome: EspnHistoryBackfillOutcome;
  mode: EspnHistoryBackfillMode | null;
  selectedUsers: number;
}

interface BackfillStorage {
  /**
   * Atomically select and prepare one job for scheduler execution. The storage
   * method owns eligibility, root-seed persistence, and lease transfer.
   */
  claimNextBackfill(legacyCutoff: string, allowedUsers: string[] | null): Promise<EspnHistoryClaimedJob | null>;
}

type BackfillSyncState = Pick<SyncStateStorage, 'settle'>;

export interface EspnHistoryBackfillDependencies {
  storage: (env: EspnHistoryBackfillEnv) => BackfillStorage;
  syncState: (env: EspnHistoryBackfillEnv) => BackfillSyncState;
  startQueued: (
    env: EspnHistoryBackfillEnv,
    claimed: { job: EspnHistoryClaimedJob; created: boolean }
  ) => Promise<unknown>;
  log: (fields: Record<string, unknown>) => void;
}

const WORKFLOW_START_FAILURE_COOLDOWN_SECONDS = 1;
const LEASE_SETTLE_ATTEMPTS = 3;

function logBackfill(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ event: 'espn_history_backfill', service: 'auth-worker', ...fields }));
}

export function parseEspnHistoryBackfillConfig(env: Pick<EspnHistoryBackfillEnv, 'ESPN_HISTORY_BACKFILL_MODE' | 'ESPN_HISTORY_BACKFILL_USERS' | 'ESPN_HISTORY_BACKFILL_LEGACY_CUTOFF'>):
  | { kind: 'disabled'; mode: 'off' }
  | { kind: 'refused'; mode: 'allowlist' | 'all' | null; reason: 'invalid_mode' | 'invalid_or_empty_allowlist' | 'invalid_legacy_cutoff' }
  | { kind: 'enabled'; mode: 'allowlist' | 'all'; allowedUsers: string[] | null; legacyCutoff: string } {
  const rawMode = env.ESPN_HISTORY_BACKFILL_MODE;
  if (rawMode === undefined || rawMode === 'off') return { kind: 'disabled', mode: 'off' };
  if (rawMode !== 'allowlist' && rawMode !== 'all') {
    return { kind: 'refused', mode: null, reason: 'invalid_mode' };
  }

  const cutoffMs = Date.parse(env.ESPN_HISTORY_BACKFILL_LEGACY_CUTOFF ?? '');
  if (!Number.isFinite(cutoffMs) || cutoffMs > Date.now()) {
    return { kind: 'refused', mode: rawMode, reason: 'invalid_legacy_cutoff' };
  }
  const legacyCutoff = new Date(cutoffMs).toISOString();

  if (rawMode === 'all') {
    return { kind: 'enabled', mode: 'all', allowedUsers: null, legacyCutoff };
  }

  const allowedUsers = [...new Set((env.ESPN_HISTORY_BACKFILL_USERS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean))];
  if (allowedUsers.length === 0) {
    return { kind: 'refused', mode: 'allowlist', reason: 'invalid_or_empty_allowlist' };
  }
  return { kind: 'enabled', mode: 'allowlist', allowedUsers, legacyCutoff };
}

const defaultDependencies: EspnHistoryBackfillDependencies = {
  storage: (env) => EspnHistoryJobStorage.fromEnvironment(env),
  syncState: (env) => SyncStateStorage.fromEnvironment(env),
  startQueued: startQueuedEspnHistoryJob,
  log: logBackfill,
};

export async function runEspnHistoryBackfill(
  env: EspnHistoryBackfillEnv,
  trigger: EspnHistoryBackfillTrigger,
  overrides: Partial<EspnHistoryBackfillDependencies> = {}
): Promise<EspnHistoryBackfillSummary> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const config = parseEspnHistoryBackfillConfig(env);

  if (config.kind === 'disabled') {
    dependencies.log({ trigger, status: 'disabled', mode: config.mode });
    return { trigger, outcome: 'disabled', mode: config.mode, selectedUsers: 0 };
  }
  if (config.kind === 'refused') {
    dependencies.log({ trigger, status: 'refused', mode: config.mode, reason: config.reason });
    return { trigger, outcome: 'refused', mode: config.mode, selectedUsers: 0 };
  }

  let job: EspnHistoryClaimedJob | null;
  try {
    job = await dependencies.storage(env).claimNextBackfill(
      config.legacyCutoff,
      config.allowedUsers
    );
  } catch {
    dependencies.log({ trigger, status: 'failed', mode: config.mode, selected_users: 0, stage: 'claim' });
    return { trigger, outcome: 'failed', mode: config.mode, selectedUsers: 0 };
  }

  if (!job) {
    dependencies.log({ trigger, status: 'idle', mode: config.mode, selected_users: 0 });
    return { trigger, outcome: 'idle', mode: config.mode, selectedUsers: 0 };
  }

  try {
    await dependencies.startQueued(env, { job, created: true });
    dependencies.log({
      trigger,
      status: 'queued',
      mode: config.mode,
      selected_users: 1,
    });
    return { trigger, outcome: 'queued', mode: config.mode, selectedUsers: 1 };
  } catch {
    let leaseCleanup: 'settled' | 'failed' = 'failed';
    const syncState = dependencies.syncState(env);
    for (let attempt = 1; attempt <= LEASE_SETTLE_ATTEMPTS; attempt++) {
      try {
        await syncState.settle(job.clerk_user_id, 'espn', `history:${job.id}`, {
          status: 'error',
          cooldownSeconds: WORKFLOW_START_FAILURE_COOLDOWN_SECONDS,
          syncSource: 'scheduled',
          errorCode: 'history_workflow_start_failed',
          errorMessage: 'Unable to start scheduled ESPN history backfill',
        }, { failOnError: true });
        leaseCleanup = 'settled';
        break;
      } catch {
        // Bounded immediate retries make a transient storage failure visible
        // without holding the cron invocation beyond its normal execution.
      }
    }
    dependencies.log({
      trigger,
      status: 'failed',
      mode: config.mode,
      selected_users: 1,
      stage: 'workflow_start',
      lease_cleanup: leaseCleanup,
    });
    return { trigger, outcome: 'failed', mode: config.mode, selectedUsers: 1 };
  }
}
