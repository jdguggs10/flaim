import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { basketballHandlers } from '../handlers';
import type { ToolParams } from '../../../types';
import {
  fetchSleeperRosterTeamsMap,
  fetchSleeperTransactionsByWeeks,
  getSleeperCurrentWeek,
} from '../../../shared/sleeper-transactions';
import { getSleeperPlayersIndex } from '../../../shared/sleeper-players-cache';
import { SLEEPER_PLAYER_ENRICHMENT_WARNING } from '../../../shared/sleeper-enrichment';
import { TEAMS_UNAVAILABLE_WARNING } from '../../../shared/handlers/get-transactions';

// attachTeamNames is left as the real implementation (a pure function) so
// tests can assert its behavior end-to-end through the handler; only the
// network-backed exports are mocked.
vi.mock('../../../shared/sleeper-transactions', async () => {
  const actual = await vi.importActual<typeof import('../../../shared/sleeper-transactions')>(
    '../../../shared/sleeper-transactions',
  );
  return {
    ...actual,
    getSleeperCurrentWeek: vi.fn(),
    fetchSleeperTransactionsByWeeks: vi.fn(),
    fetchSleeperRosterTeamsMap: vi.fn(),
  };
});

vi.mock('../../../shared/sleeper-players-cache', () => ({
  getSleeperPlayersIndex: vi.fn(),
}));

describe('sleeper basketball get_transactions handler', () => {
  const getCurrentWeekMock = getSleeperCurrentWeek as MockedFunction<typeof getSleeperCurrentWeek>;
  const fetchTransactionsMock = fetchSleeperTransactionsByWeeks as MockedFunction<typeof fetchSleeperTransactionsByWeeks>;
  const fetchTeamsMapMock = fetchSleeperRosterTeamsMap as MockedFunction<typeof fetchSleeperRosterTeamsMap>;
  const getPlayersIndexMock = getSleeperPlayersIndex as MockedFunction<typeof getSleeperPlayersIndex>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns MISSING_PARAM when league_id is omitted', async () => {
    const params = {
      sport: 'basketball',
      season_year: 2025,
      week: 9,
    } as unknown as ToolParams;

    const result = await basketballHandlers.get_transactions({} as never, params);

    expect(result.success).toBe(false);
    expect(result.code).toBe('MISSING_PARAM');
    expect(getCurrentWeekMock).not.toHaveBeenCalled();
    expect(fetchTransactionsMock).not.toHaveBeenCalled();
  });

  it('uses NBA state week when week is omitted', async () => {
    getCurrentWeekMock.mockResolvedValue(18);
    getPlayersIndexMock.mockResolvedValue(new Map([
      ['p1', { player_id: 'p1', full_name: 'Player One', active: true }],
    ]) as never);
    fetchTransactionsMock.mockResolvedValue([
      { transaction_id: 't2', type: 'trade', status: 'complete', timestamp: 2000, week: 18 },
      { transaction_id: 't1', type: 'add', status: 'complete', timestamp: 1000, week: 17 },
    ] as never);

    const params: ToolParams = {
      sport: 'basketball',
      league_id: 'league_nba_1',
      season_year: 2025,
      count: 100,
    };

    const result = await basketballHandlers.get_transactions({ SLEEPER_PLAYERS_CACHE: {} as KVNamespace } as never, params);

    expect(result.success).toBe(true);
    expect(getCurrentWeekMock).toHaveBeenCalledWith('/state/nba');
    expect(fetchTransactionsMock).toHaveBeenCalledWith('league_nba_1', [18, 17], expect.any(Function));

    if (!result.success) return;
    const data = result.data as { sport: string; count: number; window: { mode: string; weeks: number[] } };
    expect(data.sport).toBe('basketball');
    expect(data.count).toBe(2);
    expect(data.window).toEqual({ mode: 'recent_two_weeks', weeks: [18, 17] });
  });

  it('degrades gracefully when player lookup cache fails', async () => {
    getPlayersIndexMock.mockRejectedValue(new Error('cache failure'));
    fetchTransactionsMock.mockResolvedValue([
      { transaction_id: 't1', type: 'add', status: 'complete', timestamp: 1000, week: 9 },
    ] as never);

    const params: ToolParams = {
      sport: 'basketball',
      league_id: 'league_nba_1',
      season_year: 2025,
      week: 9,
    };

    const result = await basketballHandlers.get_transactions({ SLEEPER_PLAYERS_CACHE: {} as KVNamespace } as never, params);

    expect(result.success).toBe(true);
    expect(fetchTransactionsMock).toHaveBeenCalledWith('league_nba_1', [9], undefined);
    if (!result.success) return;
    // Mirrors get_roster/get_matchups: player-index failure no longer degrades silently.
    expect((result.data as { warnings?: string[] }).warnings).toEqual([SLEEPER_PLAYER_ENRICHMENT_WARNING]);
  });

  it('includes a teams map and per-row team_names with manager-set and default names', async () => {
    getPlayersIndexMock.mockResolvedValue(new Map() as never);
    fetchTeamsMapMock.mockResolvedValue({
      '1': { ownerName: 'Alice', teamName: 'The Waiver Wire Wizards' },
      '2': { ownerName: 'Bob', teamName: 'Team Bob' },
    });
    fetchTransactionsMock.mockResolvedValue([
      { transaction_id: 't1', type: 'trade', status: 'complete', timestamp: 1000, week: 9, team_ids: ['1', '2'] },
    ] as never);

    const params: ToolParams = {
      sport: 'basketball',
      league_id: 'league_nba_1',
      season_year: 2025,
      week: 9,
    };

    const result = await basketballHandlers.get_transactions({} as never, params);

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as {
      teams?: Record<string, { ownerName: string; teamName: string }>;
      transactions: Array<{ team_ids?: string[]; team_names?: string[] }>;
      warnings?: string[];
    };
    expect(data.teams).toEqual({
      '1': { ownerName: 'Alice', teamName: 'The Waiver Wire Wizards' },
      '2': { ownerName: 'Bob', teamName: 'Team Bob' },
    });
    expect(data.transactions[0].team_names).toEqual(['The Waiver Wire Wizards', 'Team Bob']);
    expect(data.warnings).toBeUndefined();
  });

  it('omits teams and adds a warning when the rosters/users fetch fails, keeping rows intact', async () => {
    getPlayersIndexMock.mockResolvedValue(new Map() as never);
    fetchTeamsMapMock.mockRejectedValue(new Error('SLEEPER_API_ERROR: Sleeper returned 500'));
    fetchTransactionsMock.mockResolvedValue([
      { transaction_id: 't1', type: 'trade', status: 'complete', timestamp: 1000, week: 9, team_ids: ['1', '2'] },
    ] as never);

    const params: ToolParams = {
      sport: 'basketball',
      league_id: 'league_nba_1',
      season_year: 2025,
      week: 9,
    };

    const result = await basketballHandlers.get_transactions({} as never, params);

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as {
      teams?: unknown;
      transactions: Array<{ transaction_id: string; team_ids?: string[]; team_names?: string[] }>;
      warnings?: string[];
    };
    expect(data.teams).toBeUndefined();
    expect(data.warnings).toEqual([TEAMS_UNAVAILABLE_WARNING]);
    // Rows are intact — team_names falls back to the raw ids rather than disappearing.
    expect(data.transactions).toHaveLength(1);
    expect(data.transactions[0]).toMatchObject({ transaction_id: 't1', team_ids: ['1', '2'], team_names: ['1', '2'] });
  });

  it.each([
    { requested: 0, expected: 1 },
    { requested: -2, expected: 1 },
    { requested: 200, expected: 3 },
  ])('clamps count=$requested to expected result size=$expected', async ({ requested, expected }) => {
    getPlayersIndexMock.mockResolvedValue(new Map() as never);
    fetchTransactionsMock.mockResolvedValue([
      { transaction_id: 't1', type: 'trade', status: 'complete', timestamp: 3000, week: 9 },
      { transaction_id: 't2', type: 'waiver', status: 'complete', timestamp: 2000, week: 9 },
      { transaction_id: 't3', type: 'add', status: 'complete', timestamp: 1000, week: 9 },
    ] as never);

    const params: ToolParams = {
      sport: 'basketball',
      league_id: 'league_nba_1',
      season_year: 2025,
      week: 9,
      count: requested,
    };

    const result = await basketballHandlers.get_transactions({} as never, params);

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as { count: number; transactions: unknown[] };
    expect(data.count).toBe(expected);
    expect(data.transactions).toHaveLength(expected);
  });
});
