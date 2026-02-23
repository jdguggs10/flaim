import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { footballHandlers } from '../handlers';
import type { ToolParams } from '../../../types';
import { fetchSleeperTransactionsByWeeks, getSleeperCurrentWeek } from '../../../shared/sleeper-transactions';

vi.mock('../../../shared/sleeper-transactions', () => ({
  getSleeperCurrentWeek: vi.fn(),
  fetchSleeperTransactionsByWeeks: vi.fn(),
}));

describe('sleeper football get_transactions handler', () => {
  const getCurrentWeekMock = getSleeperCurrentWeek as MockedFunction<typeof getSleeperCurrentWeek>;
  const fetchTransactionsMock = fetchSleeperTransactionsByWeeks as MockedFunction<typeof fetchSleeperTransactionsByWeeks>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses NFL state week when week is omitted', async () => {
    getCurrentWeekMock.mockResolvedValue(12);
    fetchTransactionsMock.mockResolvedValue([
      { transaction_id: 't2', type: 'trade', status: 'complete', timestamp: 2000, week: 12 },
      { transaction_id: 't1', type: 'add', status: 'complete', timestamp: 1000, week: 11 },
    ] as never);

    const params: ToolParams = {
      sport: 'football',
      league_id: 'league_1',
      season_year: 2025,
      count: 100,
    };

    const result = await footballHandlers.get_transactions({} as never, params);

    expect(result.success).toBe(true);
    expect(getCurrentWeekMock).toHaveBeenCalledWith('/state/nfl');
    expect(fetchTransactionsMock).toHaveBeenCalledWith('league_1', [12, 11]);

    if (!result.success) return;
    const data = result.data as { count: number; window: { mode: string; weeks: number[] } };
    expect(data.count).toBe(2);
    expect(data.window).toEqual({ mode: 'recent_two_weeks', weeks: [12, 11] });
  });

  it('uses explicit week and applies type/count filters', async () => {
    getCurrentWeekMock.mockResolvedValue(12);
    fetchTransactionsMock.mockResolvedValue([
      { transaction_id: 'a1', type: 'add', status: 'complete', timestamp: 3000, week: 9 },
      { transaction_id: 'w1', type: 'waiver', status: 'complete', timestamp: 2000, week: 9 },
      { transaction_id: 'w2', type: 'waiver', status: 'complete', timestamp: 1000, week: 9 },
    ] as never);

    const params: ToolParams = {
      sport: 'football',
      league_id: 'league_1',
      season_year: 2025,
      week: 9,
      type: 'waiver',
      count: 1,
    };

    const result = await footballHandlers.get_transactions({} as never, params);

    expect(result.success).toBe(true);
    expect(fetchTransactionsMock).toHaveBeenCalledWith('league_1', [9]);

    if (!result.success) return;
    const data = result.data as { count: number; transactions: Array<{ transaction_id: string }> };
    expect(data.count).toBe(1);
    expect(data.transactions[0]?.transaction_id).toBe('w1');
  });
});
