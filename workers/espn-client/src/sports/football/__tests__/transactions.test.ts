import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { footballHandlers } from '../handlers';
import type { ToolParams } from '../../../types';
import { getCredentials } from '../../../shared/auth';
import { fetchEspnTransactionsByWeeks, getCurrentEspnScoringPeriod } from '../../../shared/espn-transactions';

vi.mock('../../../shared/auth', () => ({
  getCredentials: vi.fn(),
}));

vi.mock('../../../shared/espn-transactions', () => ({
  getCurrentEspnScoringPeriod: vi.fn(),
  fetchEspnTransactionsByWeeks: vi.fn(),
}));

describe('football get_transactions handler', () => {
  const getCredentialsMock = getCredentials as MockedFunction<typeof getCredentials>;
  const getCurrentWeekMock = getCurrentEspnScoringPeriod as MockedFunction<typeof getCurrentEspnScoringPeriod>;
  const fetchTransactionsMock = fetchEspnTransactionsByWeeks as MockedFunction<typeof fetchEspnTransactionsByWeeks>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses current+previous week window when week is omitted', async () => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    getCurrentWeekMock.mockResolvedValue(10);
    fetchTransactionsMock.mockResolvedValue([
      { transaction_id: 't2', type: 'trade', status: 'complete', timestamp: 2000, week: 10 },
      { transaction_id: 't1', type: 'add', status: 'complete', timestamp: 1000, week: 9 },
    ] as never);

    const params: ToolParams = {
      sport: 'football',
      league_id: '123',
      season_year: 2025,
      count: 999,
    };

    const result = await footballHandlers.get_transactions({} as never, params, 'Bearer x', 'cid-1');

    expect(result.success).toBe(true);
    expect(getCurrentWeekMock).toHaveBeenCalledWith('ffl', '123', 2025, { s2: 'token', swid: '{swid}' });
    expect(fetchTransactionsMock).toHaveBeenCalledWith('ffl', '123', 2025, { s2: 'token', swid: '{swid}' }, [10, 9]);

    if (!result.success) return;
    const data = result.data as { count: number; window: { mode: string; weeks: number[] } };
    expect(data.count).toBe(2);
    expect(data.window).toEqual({ mode: 'recent_two_weeks', weeks: [10, 9] });
  });

  it('applies explicit week, type filter, and count clamp', async () => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    getCurrentWeekMock.mockResolvedValue(10);
    fetchTransactionsMock.mockResolvedValue([
      { transaction_id: 'a1', type: 'add', status: 'complete', timestamp: 3000, week: 7 },
      { transaction_id: 't1', type: 'trade', status: 'complete', timestamp: 2000, week: 7 },
      { transaction_id: 't2', type: 'trade', status: 'complete', timestamp: 1000, week: 7 },
    ] as never);

    const params: ToolParams = {
      sport: 'football',
      league_id: '123',
      season_year: 2025,
      week: 7,
      type: 'trade',
      count: 1,
    };

    const result = await footballHandlers.get_transactions({} as never, params, 'Bearer x', 'cid-2');

    expect(result.success).toBe(true);
    expect(fetchTransactionsMock).toHaveBeenCalledWith('ffl', '123', 2025, { s2: 'token', swid: '{swid}' }, [7]);

    if (!result.success) return;
    const data = result.data as { count: number; transactions: Array<{ transaction_id: string }> };
    expect(data.count).toBe(1);
    expect(data.transactions[0]?.transaction_id).toBe('t1');
  });

  it('returns credentials error when ESPN is not connected', async () => {
    getCredentialsMock.mockResolvedValue(null);

    const params: ToolParams = {
      sport: 'football',
      league_id: '123',
      season_year: 2025,
    };

    const result = await footballHandlers.get_transactions({} as never, params, 'Bearer x', 'cid-3');

    expect(result.success).toBe(false);
    expect(result.code).toBe('ESPN_CREDENTIALS_NOT_FOUND');
  });
});
