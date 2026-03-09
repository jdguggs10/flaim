import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { baseballHandlers } from '../baseball/handlers';
import { basketballHandlers } from '../basketball/handlers';
import { hockeyHandlers } from '../hockey/handlers';
import type { ToolParams } from '../../types';
import { getCredentials } from '../../shared/auth';
import { fetchEspnTransactionsByWeeks, fetchEspnMTransactions2, mergeTradePlayerDetails, getEspnLeagueContext } from '../../shared/espn-transactions';

vi.mock('../../shared/auth', () => ({
  getCredentials: vi.fn(),
}));

vi.mock('../../shared/espn-transactions', () => ({
  getEspnLeagueContext: vi.fn(),
  fetchEspnTransactionsByWeeks: vi.fn(),
  fetchEspnMTransactions2: vi.fn(),
  mergeTradePlayerDetails: vi.fn((mTxns) => mTxns),
  fetchEspnPlayersByIds: vi.fn(),
  enrichTransactions: vi.fn((txns) => txns),
}));

const scenarios = [
  { label: 'baseball', sport: 'baseball', gameId: 'flb', handlers: baseballHandlers },
  { label: 'basketball', sport: 'basketball', gameId: 'fba', handlers: basketballHandlers },
  { label: 'hockey', sport: 'hockey', gameId: 'fhl', handlers: hockeyHandlers },
] as const;

describe('espn cross-sport get_transactions handlers', () => {
  const getCredentialsMock = getCredentials as MockedFunction<typeof getCredentials>;
  const getLeagueContextMock = getEspnLeagueContext as MockedFunction<typeof getEspnLeagueContext>;
  const fetchMTransactions2Mock = fetchEspnMTransactions2 as MockedFunction<typeof fetchEspnMTransactions2>;
  const fetchTransactionsMock = fetchEspnTransactionsByWeeks as MockedFunction<typeof fetchEspnTransactionsByWeeks>;
  const mergeTradeDetailsMock = mergeTradePlayerDetails as MockedFunction<typeof mergeTradePlayerDetails>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(scenarios)('$label routes get_transactions using the sport game id', async ({ sport, gameId, handlers }) => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    getLeagueContextMock.mockResolvedValue({ scoringPeriodId: 10, teams: { '1': 'Team One' } });
    fetchMTransactions2Mock.mockResolvedValue({ truncated: false, transactions: [
      { transaction_id: 'a1', type: 'add', status: 'complete', timestamp: 3000, week: 7 },
      { transaction_id: 't1', type: 'trade', status: 'complete', timestamp: 2000, week: 7, players_added: [{ id: '1' }], players_dropped: [] },
      { transaction_id: 't2', type: 'trade', status: 'complete', timestamp: 1000, week: 7, players_added: [{ id: '2' }], players_dropped: [] },
    ] } as never);

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
    expect(getLeagueContextMock).toHaveBeenCalledWith(gameId, '123', 2025, { s2: 'token', swid: '{swid}' });
    expect(fetchMTransactions2Mock).toHaveBeenCalledWith(gameId, '123', 2025, { s2: 'token', swid: '{swid}' }, [7]);

    if (!result.success) return;
    const data = result.data as { count: number; window: { mode: string; weeks: number[] }; teams: Record<string, string>; transactions: Array<{ transaction_id: string }> };
    expect(data.window).toEqual({ mode: 'explicit_week', weeks: [7] });
    expect(data.count).toBe(1);
    expect(data.transactions[0]?.transaction_id).toBe('t1');
    expect(data.teams).toEqual({ '1': 'Team One' });
  });

  it.each(scenarios)('$label triggers trade fallback when empty trade items detected', async ({ sport, gameId, handlers }) => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    getLeagueContextMock.mockResolvedValue({ scoringPeriodId: 10, teams: {} });
    fetchMTransactions2Mock.mockResolvedValue({ truncated: false, transactions: [
      {
        transaction_id: '400',
        type: 'trade',
        status: 'complete',
        timestamp: 1700300000000,
        date: '2023-11-18',
        week: 9,
        team_ids: ['1'],
        players_added: [],
        players_dropped: [],
        faab_bid: null,
      },
    ] } as never);
    fetchTransactionsMock.mockResolvedValue([] as never);

    const params: ToolParams = { sport, league_id: '123', season_year: 2025 };
    const result = await handlers.get_transactions({} as never, params, 'Bearer x', `cid-fallback-${sport}`);

    expect(result.success).toBe(true);
    expect(fetchTransactionsMock).toHaveBeenCalledWith(gameId, '123', 2025, { s2: 'token', swid: '{swid}' }, expect.any(Array));
    expect(mergeTradeDetailsMock).toHaveBeenCalled();
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
