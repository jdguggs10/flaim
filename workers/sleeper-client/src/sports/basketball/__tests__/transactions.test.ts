import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { basketballHandlers } from '../handlers';
import type { ToolParams } from '../../../types';
import { fetchSleeperTransactionsByWeeks, getSleeperCurrentWeek } from '../../../shared/sleeper-transactions';
import { getSleeperPlayersIndex } from '../../../shared/sleeper-players-cache';

vi.mock('../../../shared/sleeper-transactions', () => ({
  getSleeperCurrentWeek: vi.fn(),
  fetchSleeperTransactionsByWeeks: vi.fn(),
}));

vi.mock('../../../shared/sleeper-players-cache', () => ({
  getSleeperPlayersIndex: vi.fn(),
}));

describe('sleeper basketball get_transactions handler', () => {
  const getCurrentWeekMock = getSleeperCurrentWeek as MockedFunction<typeof getSleeperCurrentWeek>;
  const fetchTransactionsMock = fetchSleeperTransactionsByWeeks as MockedFunction<typeof fetchSleeperTransactionsByWeeks>;
  const getPlayersIndexMock = getSleeperPlayersIndex as MockedFunction<typeof getSleeperPlayersIndex>;

  beforeEach(() => {
    vi.clearAllMocks();
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
    const data = result.data as { count: number; window: { mode: string; weeks: number[] } };
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
