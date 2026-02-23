import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { baseballHandlers } from '../baseball/handlers';
import { basketballHandlers } from '../basketball/handlers';
import { hockeyHandlers } from '../hockey/handlers';
import type { ToolParams } from '../../types';
import { getCredentials } from '../../shared/auth';
import { fetchEspnTransactionsByWeeks, getCurrentEspnScoringPeriod } from '../../shared/espn-transactions';

vi.mock('../../shared/auth', () => ({
  getCredentials: vi.fn(),
}));

vi.mock('../../shared/espn-transactions', () => ({
  getCurrentEspnScoringPeriod: vi.fn(),
  fetchEspnTransactionsByWeeks: vi.fn(),
}));

const scenarios = [
  { label: 'baseball', sport: 'baseball', gameId: 'flb', handlers: baseballHandlers },
  { label: 'basketball', sport: 'basketball', gameId: 'fba', handlers: basketballHandlers },
  { label: 'hockey', sport: 'hockey', gameId: 'fhl', handlers: hockeyHandlers },
] as const;

describe('espn cross-sport get_transactions handlers', () => {
  const getCredentialsMock = getCredentials as MockedFunction<typeof getCredentials>;
  const getCurrentWeekMock = getCurrentEspnScoringPeriod as MockedFunction<typeof getCurrentEspnScoringPeriod>;
  const fetchTransactionsMock = fetchEspnTransactionsByWeeks as MockedFunction<typeof fetchEspnTransactionsByWeeks>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(scenarios)('$label routes get_transactions using the sport game id', async ({ sport, gameId, handlers }) => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    getCurrentWeekMock.mockResolvedValue(10);
    fetchTransactionsMock.mockResolvedValue([
      { transaction_id: 'a1', type: 'add', status: 'complete', timestamp: 3000, week: 7 },
      { transaction_id: 't1', type: 'trade', status: 'complete', timestamp: 2000, week: 7 },
      { transaction_id: 't2', type: 'trade', status: 'complete', timestamp: 1000, week: 7 },
    ] as never);

    const params: ToolParams = {
      sport,
      league_id: '123',
      season_year: 2025,
      week: 7,
      type: 'trade',
      count: 1,
    };

    const result = await handlers.get_transactions({} as never, params, 'Bearer x', `cid-${sport}`);

    expect(result.success).toBe(true);
    expect(getCurrentWeekMock).toHaveBeenCalledWith(gameId, '123', 2025, { s2: 'token', swid: '{swid}' });
    expect(fetchTransactionsMock).toHaveBeenCalledWith(gameId, '123', 2025, { s2: 'token', swid: '{swid}' }, [7]);

    if (!result.success) return;
    const data = result.data as { count: number; window: { mode: string; weeks: number[] }; transactions: Array<{ transaction_id: string }> };
    expect(data.window).toEqual({ mode: 'explicit_week', weeks: [7] });
    expect(data.count).toBe(1);
    expect(data.transactions[0]?.transaction_id).toBe('t1');
  });

  it.each(scenarios)('$label returns credentials error when ESPN is not connected', async ({ sport, handlers }) => {
    getCredentialsMock.mockResolvedValue(null);

    const params: ToolParams = {
      sport,
      league_id: '123',
      season_year: 2025,
    };

    const result = await handlers.get_transactions({} as never, params, 'Bearer x', `cid-missing-${sport}`);

    expect(result.success).toBe(false);
    expect(result.code).toBe('ESPN_CREDENTIALS_NOT_FOUND');
  });
});
