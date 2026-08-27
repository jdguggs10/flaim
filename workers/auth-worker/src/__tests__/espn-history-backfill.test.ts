import { describe, expect, it, vi } from 'vitest';
import {
  parseEspnHistoryBackfillConfig,
  runEspnHistoryBackfill,
  type EspnHistoryBackfillDependencies,
} from '../espn-history-backfill';
import type { EspnHistoryJob } from '../espn-history';

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  ESPN_HISTORY_BACKFILL_LEGACY_CUTOFF: '2026-08-27T12:00:00.000Z',
  ESPN_HISTORY_REFRESH: { create: vi.fn() },
};

function job(): EspnHistoryJob {
  return {
    id: 'job-123',
    clerk_user_id: 'user_abcdefgh',
    status: 'queued',
    workflow_instance_id: null,
    credential_updated_at: '2026-08-27T00:00:00.000Z',
    scan_version: 1,
    mode: 'full',
    trigger_source: 'scheduled_backfill',
    current_leagues: [],
    plan: [],
    cursor: 0,
    planned_count: 0,
    completed_count: 0,
    skipped_count: 0,
    failed_count: 0,
    failures: [],
    last_error_code: null,
    last_error_message: null,
    started_at: null,
    finished_at: null,
    created_at: '2026-08-27T00:00:00.000Z',
    updated_at: '2026-08-27T00:00:00.000Z',
  };
}

function dependencies(claimed: EspnHistoryJob | null = null): {
  dependencies: EspnHistoryBackfillDependencies;
  claimNextBackfill: ReturnType<typeof vi.fn>;
  startQueued: ReturnType<typeof vi.fn>;
  settle: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
} {
  const claimNextBackfill = vi.fn().mockResolvedValue(claimed);
  const startQueued = vi.fn().mockResolvedValue({ job: claimed, created: true });
  const settle = vi.fn().mockResolvedValue(undefined);
  const log = vi.fn();
  return {
    dependencies: {
      storage: () => ({ claimNextBackfill }),
      syncState: () => ({ settle }),
      startQueued,
      log,
    },
    claimNextBackfill,
    startQueued,
    settle,
    log,
  };
}

describe('ESPN history backfill dispatcher', () => {
  it('parses only exact modes and exact trimmed allowlist IDs', () => {
    expect(parseEspnHistoryBackfillConfig({
      ESPN_HISTORY_BACKFILL_MODE: 'all',
      ESPN_HISTORY_BACKFILL_LEGACY_CUTOFF: '2026-08-27T08:00:00-04:00',
    })).toEqual({
      kind: 'enabled', mode: 'all', allowedUsers: null, legacyCutoff: '2026-08-27T12:00:00.000Z',
    });
    expect(parseEspnHistoryBackfillConfig({
      ESPN_HISTORY_BACKFILL_MODE: 'allowlist',
      ESPN_HISTORY_BACKFILL_USERS: ' user_a, user_b ,user_a ',
      ESPN_HISTORY_BACKFILL_LEGACY_CUTOFF: '2026-08-27T12:00:00.000Z',
    })).toEqual({
      kind: 'enabled',
      mode: 'allowlist',
      allowedUsers: ['user_a', 'user_b'],
      legacyCutoff: '2026-08-27T12:00:00.000Z',
    });
    expect(parseEspnHistoryBackfillConfig({ ESPN_HISTORY_BACKFILL_MODE: 'ALL' })).toEqual({
      kind: 'refused', mode: null, reason: 'invalid_mode',
    });
    expect(parseEspnHistoryBackfillConfig({ ESPN_HISTORY_BACKFILL_MODE: 'all' })).toEqual({
      kind: 'refused', mode: 'all', reason: 'invalid_legacy_cutoff',
    });
    expect(parseEspnHistoryBackfillConfig({
      ESPN_HISTORY_BACKFILL_MODE: 'all',
      ESPN_HISTORY_BACKFILL_LEGACY_CUTOFF: '2099-01-01T00:00:00.000Z',
    })).toEqual({ kind: 'refused', mode: 'all', reason: 'invalid_legacy_cutoff' });
  });

  it('does not touch storage while disabled or with an empty allowlist', async () => {
    const disabled = dependencies();
    await expect(runEspnHistoryBackfill(baseEnv, 'cron', disabled.dependencies)).resolves.toMatchObject({
      outcome: 'disabled', selectedUsers: 0,
    });
    expect(disabled.claimNextBackfill).not.toHaveBeenCalled();

    const refused = dependencies();
    await expect(runEspnHistoryBackfill({
      ...baseEnv,
      ESPN_HISTORY_BACKFILL_MODE: 'allowlist',
      ESPN_HISTORY_BACKFILL_USERS: ' , ',
    }, 'cron', refused.dependencies)).resolves.toMatchObject({ outcome: 'refused', selectedUsers: 0 });
    expect(refused.claimNextBackfill).not.toHaveBeenCalled();
  });

  it('claims at most one allowlisted job and starts its workflow', async () => {
    const claimed = job();
    const test = dependencies(claimed);

    await expect(runEspnHistoryBackfill({
      ...baseEnv,
      ESPN_HISTORY_BACKFILL_MODE: 'allowlist',
      ESPN_HISTORY_BACKFILL_USERS: 'user_a, user_b',
    }, 'cron', test.dependencies)).resolves.toEqual({
      trigger: 'cron', outcome: 'queued', mode: 'allowlist', selectedUsers: 1,
    });

    expect(test.claimNextBackfill).toHaveBeenCalledWith(
      '2026-08-27T12:00:00.000Z',
      ['user_a', 'user_b']
    );
    expect(test.startQueued).toHaveBeenCalledWith(expect.any(Object), { job: claimed, created: true });
    expect(test.settle).not.toHaveBeenCalled();
    expect(test.log).toHaveBeenCalledWith(expect.objectContaining({
      status: 'queued', selected_users: 1,
    }));
    expect(test.log).not.toHaveBeenCalledWith(expect.objectContaining({ user_id: expect.anything() }));
  });

  it('settles only the exact history lease when workflow startup fails', async () => {
    const claimed = job();
    const test = dependencies(claimed);
    test.startQueued.mockRejectedValue(new Error('workflow binding unavailable'));

    await expect(runEspnHistoryBackfill({
      ...baseEnv,
      ESPN_HISTORY_BACKFILL_MODE: 'all',
    }, 'cron', test.dependencies)).resolves.toEqual({
      trigger: 'cron', outcome: 'failed', mode: 'all', selectedUsers: 1,
    });

    expect(test.settle).toHaveBeenCalledWith('user_abcdefgh', 'espn', 'history:job-123', {
      status: 'error',
      cooldownSeconds: 1,
      syncSource: 'scheduled',
      errorCode: 'history_workflow_start_failed',
      errorMessage: 'Unable to start scheduled ESPN history backfill',
    }, { failOnError: true });
    expect(test.log).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed', stage: 'workflow_start', lease_cleanup: 'settled',
    }));
  });

  it('retries and reports an exact-lease cleanup failure', async () => {
    const claimed = job();
    const test = dependencies(claimed);
    test.startQueued.mockRejectedValue(new Error('workflow binding unavailable'));
    test.settle.mockRejectedValue(new Error('database unavailable'));

    await expect(runEspnHistoryBackfill({
      ...baseEnv,
      ESPN_HISTORY_BACKFILL_MODE: 'all',
    }, 'cron', test.dependencies)).resolves.toMatchObject({ outcome: 'failed' });

    expect(test.settle).toHaveBeenCalledTimes(3);
    expect(test.log).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failed', stage: 'workflow_start', lease_cleanup: 'failed',
    }));
  });
});
