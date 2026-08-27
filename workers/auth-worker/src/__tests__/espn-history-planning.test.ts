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
  ensureEspnHistoryJobStarted,
  historyKey,
  isMissingEspnHistoryTableError,
  stopForHistoryAdvanceOutcome,
  stopForHistoryTerminalOutcome,
  type EspnHistoryJob,
  type EspnHistoryPlanItem,
} from '../espn-history';

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
