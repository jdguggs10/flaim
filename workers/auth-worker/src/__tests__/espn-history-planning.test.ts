import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetLeagueInfo = vi.hoisted(() => vi.fn());

vi.mock('../v3/get-league-info', () => ({
  getLeagueInfo: mockGetLeagueInfo,
}));

vi.mock('../v3/get-league-teams', () => ({
  getLeagueTeams: vi.fn(),
}));

import {
  buildPlan,
  beginEspnLeagueMutation,
  dedupeHistoryPlan,
  ESPN_HISTORY_RUNNING_STALE_MS,
  ensureEspnHistoryJobStarted,
  historyKey,
  historyJobExecutionEnabled,
  isMissingEspnHistoryTableError,
  recoverUnhandledEspnHistoryWorkflowFailure,
  reconcileStaleRunningEspnHistoryJob,
  rethrowAfterEspnHistoryWorkflowRecovery,
  stopForHistoryAdvanceOutcome,
  stopForHistoryTerminalOutcome,
  type EspnHistoryJob,
  type EspnHistoryPlanItem,
} from '../espn-history';
import { UPSTREAM_BACKOFF_COOLDOWN_SECONDS } from '../sync-state';

const currentLeague = {
  leagueId: '123',
  gameId: 'ffl',
  leagueName: 'League',
  teamId: 8,
  teamName: 'Team',
  seasonId: 2026,
};

function job(mode: 'full' | 'incremental'): EspnHistoryJob {
  return {
    id: 'job-1',
    clerk_user_id: 'user-1',
    status: 'running',
    workflow_instance_id: 'workflow-1',
    credential_updated_at: '2026-08-26T20:00:00.000Z',
    scan_version: 1,
    mode,
    trigger_source: 'user',
    current_leagues: [currentLeague],
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
    created_at: '2026-08-26T20:00:00.000Z',
    updated_at: '2026-08-26T20:00:00.000Z',
  };
}

describe('ESPN history planning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLeagueInfo.mockResolvedValue({ status: { previousSeasons: [2025, 2024, 2025] } });
  });

  it('uses a stable sport/league/season key and globally deduplicates candidates', () => {
    const item: EspnHistoryPlanItem = {
      leagueId: '123',
      gameId: 'ffl',
      sport: 'football',
      seasonYear: 2025,
      teamId: '8',
      teamName: 'Team',
      leagueName: 'League',
    };

    expect(historyKey(item)).toBe('football:123:2025');
    expect(dedupeHistoryPlan([item, { ...item }, { ...item, seasonYear: 2024 }]))
      .toEqual([item, { ...item, seasonYear: 2024 }]);
  });

  it('loads saved keys once and skips them in incremental mode', async () => {
    const existingKeys = vi.fn().mockResolvedValue(new Set(['football:123:2025']));
    const checkpoint = vi.fn().mockResolvedValue(true);

    const plan = await buildPlan(
      { existingKeys } as never,
      job('incremental'),
      { swid: '{swid}', s2: 's2' },
      [currentLeague, { ...currentLeague }],
      checkpoint,
    );

    expect(existingKeys).toHaveBeenCalledOnce();
    expect(checkpoint).toHaveBeenCalledTimes(2);
    expect(plan.map((item) => item.seasonYear)).toEqual([2024]);
  });

  it('keeps saved seasons during the one-time full repair scan', async () => {
    const existingKeys = vi.fn();

    const plan = await buildPlan(
      { existingKeys } as never,
      job('full'),
      { swid: '{swid}', s2: 's2' },
      [currentLeague],
    );

    expect(existingKeys).not.toHaveBeenCalled();
    expect(plan.map((item) => item.seasonYear)).toEqual([2025, 2024]);
  });

  it('stops planning when the exact history lease checkpoint fails', async () => {
    await expect(buildPlan(
      { existingKeys: vi.fn() } as never,
      job('full'),
      { swid: '{swid}', s2: 's2' },
      [currentLeague],
      vi.fn().mockResolvedValue(false),
    )).rejects.toThrow('lease lost during planning');
    expect(mockGetLeagueInfo).not.toHaveBeenCalled();
  });
});

describe('ESPN history execution gates', () => {
  it('keeps interactive and scheduled rollout controls independent', () => {
    const interactive = job('full');
    const scheduled = { ...interactive, trigger_source: 'scheduled_backfill' as const };

    expect(historyJobExecutionEnabled({
      ESPN_DURABLE_HISTORY_ENABLED: 'true',
      ESPN_DURABLE_HISTORY_USERS: 'user-1',
      ESPN_HISTORY_BACKFILL_MODE: 'off',
    }, interactive)).toBe(true);
    expect(historyJobExecutionEnabled({
      ESPN_DURABLE_HISTORY_ENABLED: 'true',
      ESPN_DURABLE_HISTORY_USERS: 'user-1',
      ESPN_HISTORY_BACKFILL_MODE: 'off',
    }, scheduled)).toBe(false);

    expect(historyJobExecutionEnabled({
      ESPN_DURABLE_HISTORY_ENABLED: 'false',
      ESPN_HISTORY_BACKFILL_MODE: 'allowlist',
      ESPN_HISTORY_BACKFILL_USERS: 'user-1',
    }, scheduled)).toBe(true);
    expect(historyJobExecutionEnabled({
      ESPN_DURABLE_HISTORY_ENABLED: 'false',
      ESPN_HISTORY_BACKFILL_MODE: 'allowlist',
      ESPN_HISTORY_BACKFILL_USERS: 'user-2',
    }, scheduled)).toBe(false);
  });
});

describe('isMissingEspnHistoryTableError', () => {
  it('recognizes Postgres and PostgREST pre-migration responses', () => {
    expect(isMissingEspnHistoryTableError({ code: '42P01' })).toBe(true);
    expect(isMissingEspnHistoryTableError({ code: 'PGRST205' })).toBe(true);
    expect(isMissingEspnHistoryTableError({
      message: "Could not find the table 'public.espn_history_jobs' in the schema cache",
    })).toBe(true);
  });

  it('does not hide unrelated storage failures', () => {
    expect(isMissingEspnHistoryTableError({ code: '08006', message: 'connection failed' })).toBe(false);
  });
});

describe('stopForHistoryAdvanceOutcome', () => {
  it.each(['persisted', 'skipped', 'failed', 'already_processed'])(
    'continues after %s',
    (outcome) => expect(stopForHistoryAdvanceOutcome(outcome)).toBeNull(),
  );

  it('maps credential and lease fences to terminal control states', () => {
    expect(stopForHistoryAdvanceOutcome('credential_changed')).toMatchObject({ status: 'superseded' });
    expect(stopForHistoryAdvanceOutcome('lease_lost')).toMatchObject({ status: 'cancelled' });
    expect(stopForHistoryAdvanceOutcome('out_of_order')).toMatchObject({ status: 'failed' });
  });
});

describe('stopForHistoryTerminalOutcome', () => {
  it('accepts a fenced completion', () => {
    expect(stopForHistoryTerminalOutcome('finished')).toBeNull();
  });

  it('downgrades rejected completion markers to safe terminal states', () => {
    expect(stopForHistoryTerminalOutcome('credential_changed')).toMatchObject({
      status: 'superseded',
      code: 'credentials_changed',
    });
    expect(stopForHistoryTerminalOutcome('lease_lost')).toMatchObject({
      status: 'cancelled',
      code: 'history_lease_lost',
    });
    expect(stopForHistoryTerminalOutcome('job_not_active')).toMatchObject({
      status: 'cancelled',
      code: 'history_job_not_active',
    });
  });
});

describe('ensureEspnHistoryJobStarted', () => {
  it('treats a replayed queued-to-running transition as started', async () => {
    const storage = {
      start: vi.fn().mockResolvedValue(false),
      get: vi.fn().mockResolvedValue(job('full')),
    };
    storage.get.mockResolvedValue({ ...job('full'), status: 'running' });

    await expect(ensureEspnHistoryJobStarted(storage as never, 'job-1')).resolves.toBe(true);
  });

  it('does not revive a terminal job', async () => {
    const storage = {
      start: vi.fn().mockResolvedValue(false),
      get: vi.fn().mockResolvedValue({ ...job('full'), status: 'cancelled' }),
    };

    await expect(ensureEspnHistoryJobStarted(storage as never, 'job-1')).resolves.toBe(false);
  });
});

describe('beginEspnLeagueMutation', () => {
  it('terminalizes an active job before taking over the provider lease', async () => {
    const calls: string[] = [];
    const storage = {
      activeForUser: vi.fn().mockResolvedValue(job('full')),
      terminal: vi.fn().mockImplementation(async () => { calls.push('terminal'); }),
    };
    const lease = {
      takeoverLeaseForMutation: vi.fn().mockImplementation(async () => {
        calls.push('takeover');
        return true;
      }),
    };

    await expect(beginEspnLeagueMutation(storage as never, lease as never, 'user-1'))
      .resolves.toMatchObject({ jobId: 'job-1', ownerId: expect.stringMatching(/^league-mutation:/) });

    expect(calls).toEqual(['terminal', 'takeover']);
    expect(storage.terminal).toHaveBeenCalledWith(
      'job-1',
      'cancelled',
      'league_data_changed',
      expect.stringContaining('changed')
    );
    expect(lease.takeoverLeaseForMutation).toHaveBeenCalledWith(
      'user-1', 'espn', expect.stringMatching(/^league-mutation:/)
    );
  });

  it('takes over the request lease even before a history job exists', async () => {
    const storage = {
      activeForUser: vi.fn().mockResolvedValue(null),
      terminal: vi.fn(),
    };
    const lease = { takeoverLeaseForMutation: vi.fn().mockResolvedValue(true) };

    await expect(beginEspnLeagueMutation(storage as never, lease as never, 'user-1'))
      .resolves.toMatchObject({ jobId: null });
    expect(storage.terminal).not.toHaveBeenCalled();
    expect(lease.takeoverLeaseForMutation).toHaveBeenCalledOnce();
  });
});

describe('recoverUnhandledEspnHistoryWorkflowFailure', () => {
  it('reports scheduled telemetry for a proactive job', async () => {
    const scheduled = { ...job('full'), trigger_source: 'scheduled_backfill' as const };
    const storage = {
      get: vi.fn().mockResolvedValue(scheduled),
      terminal: vi.fn().mockResolvedValue('finished'),
    };
    const lease = { settle: vi.fn().mockResolvedValue(true) };

    await recoverUnhandledEspnHistoryWorkflowFailure(
      storage as never,
      lease as never,
      scheduled,
      'history:job-1'
    );

    expect(lease.settle).toHaveBeenCalledWith(
      'user-1',
      'espn',
      'history:job-1',
      expect.objectContaining({ syncSource: 'scheduled' }),
      { failOnError: true }
    );
  });

  it('terminalizes an active job and releases its provider lease', async () => {
    const storage = {
      get: vi.fn().mockResolvedValue(job('full')),
      terminal: vi.fn().mockResolvedValue('finished'),
    };
    const lease = { settle: vi.fn().mockResolvedValue(true) };

    await recoverUnhandledEspnHistoryWorkflowFailure(
      storage as never,
      lease as never,
      job('full'),
      'history:job-1'
    );

    expect(storage.terminal).toHaveBeenCalledWith(
      'job-1',
      'failed',
      'workflow_runtime_failed',
      expect.stringContaining('stopped unexpectedly')
    );
    expect(lease.settle).toHaveBeenCalledWith(
      'user-1',
      'espn',
      'history:job-1',
      expect.objectContaining({
        status: 'error',
        syncSource: 'web',
        errorCode: 'workflow_runtime_failed',
      }),
      { failOnError: true }
    );
  });

  it('retries lease settlement without rewriting a terminal job', async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({ ...job('full'), status: 'succeeded' }),
      terminal: vi.fn(),
    };
    const lease = { settle: vi.fn().mockResolvedValue(true) };

    await recoverUnhandledEspnHistoryWorkflowFailure(
      storage as never,
      lease as never,
      job('full'),
      'history:job-1'
    );

    expect(storage.terminal).not.toHaveBeenCalled();
    expect(lease.settle).toHaveBeenCalledWith(
      'user-1',
      'espn',
      'history:job-1',
      expect.objectContaining({ status: 'success', errorCode: undefined }),
      { failOnError: true }
    );
  });

  it('preserves a terminal job\'s specific failure metadata while settling its lease', async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({
        ...job('full'),
        status: 'partial',
        last_error_code: 'history_partial',
        last_error_message: 'Some unavailable seasons were skipped.',
      }),
      terminal: vi.fn(),
    };
    const lease = { settle: vi.fn().mockResolvedValue(true) };

    await recoverUnhandledEspnHistoryWorkflowFailure(
      storage as never,
      lease as never,
      job('full'),
      'history:job-1'
    );

    expect(storage.terminal).not.toHaveBeenCalled();
    expect(lease.settle).toHaveBeenCalledWith(
      'user-1',
      'espn',
      'history:job-1',
      expect.objectContaining({
        status: 'error',
        errorCode: 'history_partial',
        errorMessage: 'Some unavailable seasons were skipped.',
      }),
      { failOnError: true }
    );
  });

  it('preserves upstream backoff when retry exhaustion was already terminalized', async () => {
    const storage = {
      get: vi.fn().mockResolvedValue({
        ...job('full'),
        status: 'failed',
        last_error_code: 'history_chunk_retries_exhausted',
        last_error_message: 'ESPN history refresh failed after retries.',
      }),
      terminal: vi.fn(),
    };
    const lease = { settle: vi.fn().mockResolvedValue(true) };

    await recoverUnhandledEspnHistoryWorkflowFailure(
      storage as never,
      lease as never,
      job('full'),
      'history:job-1'
    );

    expect(lease.settle).toHaveBeenCalledWith(
      'user-1',
      'espn',
      'history:job-1',
      expect.objectContaining({
        cooldownSeconds: UPSTREAM_BACKOFF_COOLDOWN_SECONDS,
        errorCode: 'history_chunk_retries_exhausted',
      }),
      { failOnError: true }
    );
  });

  it('does not report recovery when the terminal fence rejects it', async () => {
    const storage = {
      get: vi.fn().mockResolvedValue(job('full')),
      terminal: vi.fn().mockResolvedValue('lease_lost'),
    };
    const lease = { settle: vi.fn() };

    await expect(recoverUnhandledEspnHistoryWorkflowFailure(
      storage as never,
      lease as never,
      job('full'),
      'history:job-1'
    )).rejects.toThrow('rejected terminal state');
    expect(lease.settle).not.toHaveBeenCalled();
  });
});

describe('reconcileStaleRunningEspnHistoryJob', () => {
  it('leaves a fresh running job active', async () => {
    const storage = { failStaleRunning: vi.fn() };
    const nowMs = Date.parse('2026-08-27T08:00:00.000Z');
    const fresh = {
      ...job('full'),
      updated_at: new Date(nowMs - ESPN_HISTORY_RUNNING_STALE_MS).toISOString(),
    };

    await expect(reconcileStaleRunningEspnHistoryJob(storage, fresh, nowMs))
      .resolves.toBe(false);
    expect(storage.failStaleRunning).not.toHaveBeenCalled();
  });

  it('fails a stale running job so a later refresh can create a replacement', async () => {
    const storage = { failStaleRunning: vi.fn().mockResolvedValue(true) };
    const nowMs = Date.parse('2026-08-27T08:00:00.000Z');
    const stale = {
      ...job('full'),
      updated_at: new Date(nowMs - ESPN_HISTORY_RUNNING_STALE_MS - 1).toISOString(),
    };

    await expect(reconcileStaleRunningEspnHistoryJob(storage, stale, nowMs))
      .resolves.toBe(true);
    expect(storage.failStaleRunning).toHaveBeenCalledWith(
      'job-1',
      '2026-08-27T07:00:00.000Z'
    );
  });

  it('does not fail a job that resumed before the conditional update', async () => {
    const storage = { failStaleRunning: vi.fn().mockResolvedValue(false) };
    const nowMs = Date.parse('2026-08-27T08:00:00.000Z');
    const stale = {
      ...job('full'),
      updated_at: new Date(nowMs - ESPN_HISTORY_RUNNING_STALE_MS - 1).toISOString(),
    };

    await expect(reconcileStaleRunningEspnHistoryJob(storage, stale, nowMs))
      .resolves.toBe(false);
  });
});

describe('rethrowAfterEspnHistoryWorkflowRecovery', () => {
  it('rethrows the original workflow failure after successful recovery', async () => {
    const original = new Error('load step failed');

    await expect(rethrowAfterEspnHistoryWorkflowRecovery(
      original,
      vi.fn().mockResolvedValue(undefined)
    )).rejects.toBe(original);
  });

  it('preserves both failures when recovery also fails', async () => {
    const original = new Error('load step failed');
    const recovery = new Error('recovery storage failed');

    try {
      await rethrowAfterEspnHistoryWorkflowRecovery(
        original,
        vi.fn().mockRejectedValue(recovery)
      );
      throw new Error('Expected recovery to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect((error as AggregateError).errors).toEqual([original, recovery]);
    }
  });
});
