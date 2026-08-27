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
  dedupeHistoryPlan,
  historyKey,
  stopForHistoryAdvanceOutcome,
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
