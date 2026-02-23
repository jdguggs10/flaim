import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { basketballHandlers } from '../handlers';
import type { ToolParams } from '../../../types';
import { fetchSleeperTransactionsByWeeks, getSleeperCurrentWeek } from '../../../shared/sleeper-transactions';

vi.mock('../../../shared/sleeper-transactions', () => ({
  getSleeperCurrentWeek: vi.fn(),
  fetchSleeperTransactionsByWeeks: vi.fn(),
}));

describe('sleeper basketball get_transactions handler', () => {
  const getCurrentWeekMock = getSleeperCurrentWeek as MockedFunction<typeof getSleeperCurrentWeek>;
  const fetchTransactionsMock = fetchSleeperTransactionsByWeeks as MockedFunction<typeof fetchSleeperTransactionsByWeeks>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses NBA state week when week is omitted', async () => {
    getCurrentWeekMock.mockResolvedValue(18);
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

    const result = await basketballHandlers.get_transactions({} as never, params);

    expect(result.success).toBe(true);
    expect(getCurrentWeekMock).toHaveBeenCalledWith('/state/nba');
    expect(fetchTransactionsMock).toHaveBeenCalledWith('league_nba_1', [18, 17]);

    if (!result.success) return;
    const data = result.data as { count: number; window: { mode: string; weeks: number[] } };
    expect(data.count).toBe(2);
    expect(data.window).toEqual({ mode: 'recent_two_weeks', weeks: [18, 17] });
  });
});
