import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { footballHandlers } from '../handlers';
import type { ToolParams } from '../../../types';
import { getCredentials } from '../../../shared/auth';
import { fetchEspnTransactionsByWeeks, getEspnLeagueContext, fetchEspnPlayersByIds, enrichTransactions } from '../../../shared/espn-transactions';

vi.mock('../../../shared/auth', () => ({
  getCredentials: vi.fn(),
}));

vi.mock('../../../shared/espn-transactions', () => ({
  getEspnLeagueContext: vi.fn(),
  fetchEspnTransactionsByWeeks: vi.fn(),
  fetchEspnPlayersByIds: vi.fn(),
  enrichTransactions: vi.fn((txns) => txns),
}));

describe('football get_transactions handler', () => {
  const getCredentialsMock = getCredentials as MockedFunction<typeof getCredentials>;
  const getLeagueContextMock = getEspnLeagueContext as MockedFunction<typeof getEspnLeagueContext>;
  const fetchTransactionsMock = fetchEspnTransactionsByWeeks as MockedFunction<typeof fetchEspnTransactionsByWeeks>;
  const fetchPlayersByIdsMock = fetchEspnPlayersByIds as MockedFunction<typeof fetchEspnPlayersByIds>;
  const enrichTransactionsMock = enrichTransactions as MockedFunction<typeof enrichTransactions>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses current+previous week window when week is omitted', async () => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    getLeagueContextMock.mockResolvedValue({ scoringPeriodId: 10, teams: { '1': 'Team One' } });
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
    expect(getLeagueContextMock).toHaveBeenCalledWith('ffl', '123', 2025, { s2: 'token', swid: '{swid}' });
    expect(fetchTransactionsMock).toHaveBeenCalledWith('ffl', '123', 2025, { s2: 'token', swid: '{swid}' }, [10, 9]);

    if (!result.success) return;
    const data = result.data as { count: number; window: { mode: string; weeks: number[] }; teams: Record<string, string> };
    expect(data.count).toBe(2);
    expect(data.window).toEqual({ mode: 'recent_two_weeks', weeks: [10, 9] });
    expect(data.teams).toEqual({ '1': 'Team One' });
  });

  it('applies explicit week, type filter, and count clamp', async () => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    getLeagueContextMock.mockResolvedValue({ scoringPeriodId: 10, teams: { '1': 'Team One' } });
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

  it('enriches player names from global player endpoint when player IDs are present', async () => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    getLeagueContextMock.mockResolvedValue({ scoringPeriodId: 8, teams: {} });
    fetchTransactionsMock.mockResolvedValue([
      {
        transaction_id: 'a1',
        type: 'add',
        status: 'complete',
        timestamp: 1000,
        week: 8,
        players_added: [{ id: '3054211' }],
        players_dropped: [{ id: '4362887' }],
      },
    ] as never);
    fetchPlayersByIdsMock.mockResolvedValue(
      new Map([
        ['3054211', { fullName: 'Josh Allen', defaultPositionId: 1, proTeamId: 2 }],
        ['4362887', { fullName: 'Geno Smith', defaultPositionId: 1, proTeamId: 26 }],
      ]) as never,
    );
    enrichTransactionsMock.mockImplementation((txns, playerMap, _getPos, _getTeam) => {
      return txns.map((t) => ({
        ...t,
        players_added: t.players_added?.map((p: { id: string }) => ({
          ...p,
          name: (playerMap as Map<string, { fullName?: string }>).get(p.id)?.fullName,
        })),
        players_dropped: t.players_dropped?.map((p: { id: string }) => ({
          ...p,
          name: (playerMap as Map<string, { fullName?: string }>).get(p.id)?.fullName,
        })),
      }));
    });

    const params: ToolParams = {
      sport: 'football',
      league_id: '123',
      season_year: 2025,
      week: 8,
    };

    const result = await footballHandlers.get_transactions({} as never, params, 'Bearer x', 'cid-enrich');

    expect(result.success).toBe(true);
    expect(fetchPlayersByIdsMock).toHaveBeenCalledWith('ffl', 2025, ['3054211', '4362887']);
    expect(enrichTransactionsMock).toHaveBeenCalled();

    if (!result.success) return;
    const data = result.data as { transactions: Array<{ players_added?: Array<{ id: string; name?: string }> }> };
    expect(data.transactions[0]?.players_added?.[0]?.name).toBe('Josh Allen');
  });

  it('degrades gracefully when player enrichment fetch fails', async () => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    getLeagueContextMock.mockResolvedValue({ scoringPeriodId: 8, teams: {} });
    fetchTransactionsMock.mockResolvedValue([
      {
        transaction_id: 'a1',
        type: 'add',
        status: 'complete',
        timestamp: 1000,
        week: 8,
        players_added: [{ id: '3054211' }],
      },
    ] as never);
    fetchPlayersByIdsMock.mockRejectedValue(new Error('ESPN API error'));

    const params: ToolParams = {
      sport: 'football',
      league_id: '123',
      season_year: 2025,
      week: 8,
    };

    const result = await footballHandlers.get_transactions({} as never, params, 'Bearer x', 'cid-degrade');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as { count: number; transactions: Array<{ players_added?: Array<{ id: string; name?: string }> }> };
    expect(data.count).toBe(1);
    expect(data.transactions[0]?.players_added?.[0]?.id).toBe('3054211');
    expect(data.transactions[0]?.players_added?.[0]?.name).toBeUndefined();
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
