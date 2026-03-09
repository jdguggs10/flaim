import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { fetchEspnTransactionsByWeeks, fetchEspnMTransactions2, normalizeMTransactions2, mergeTradePlayerDetails, getEspnLeagueContext, fetchEspnPlayersByIds } from '../espn-transactions';
import type { EspnMTransaction, NormalizedTransaction } from '../espn-transactions';

const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('espn-transactions', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('getEspnLeagueContext', () => {
    it('returns scoringPeriodId and teams map from mSettings+mTeam', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        scoringPeriodId: 7,
        teams: [
          { id: 1, location: 'Gotham', nickname: 'Knights' },
          { id: 2, name: 'Team Two' },
          { id: 3 },
        ],
      }));
      const ctx = await getEspnLeagueContext('ffl', '123', 2025, { s2: 'x', swid: '{y}' });
      expect(ctx.scoringPeriodId).toBe(7);
      expect(ctx.teams).toEqual({
        '1': 'Gotham Knights',
        '2': 'Team Two',
        '3': 'Team 3',
      });
      // Verify URL includes both views
      const url = mockFetch.mock.calls[0]?.[0] as string;
      expect(url).toContain('view=mSettings&view=mTeam');
    });

    it('defaults scoringPeriodId to 1 when missing', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      const ctx = await getEspnLeagueContext('ffl', '123', 2025, { s2: 'x', swid: '{y}' });
      expect(ctx.scoringPeriodId).toBe(1);
      expect(ctx.teams).toEqual({});
    });
  });

  describe('fetchEspnPlayersByIds', () => {
    it('fetches players from global endpoint with top-level filterIds', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse([
        { id: 3054211, fullName: 'Josh Allen', defaultPositionId: 1, proTeamId: 2 },
        { id: 4362887, fullName: 'Geno Smith', defaultPositionId: 1, proTeamId: 26 },
      ]));

      const map = await fetchEspnPlayersByIds('ffl', 2025, ['3054211', '4362887']);

      expect(map.size).toBe(2);
      expect(map.get('3054211')?.fullName).toBe('Josh Allen');
      expect(map.get('4362887')?.fullName).toBe('Geno Smith');

      const url = mockFetch.mock.calls[0]?.[0] as string;
      expect(url).toContain('/players?view=players_wl');
      expect(url).not.toContain('/leagues/');

      const init = mockFetch.mock.calls[0]?.[1] as RequestInit;
      const filterHeader = (init.headers as Record<string, string>)?.['x-fantasy-filter'];
      const parsed = JSON.parse(filterHeader);
      expect(parsed.filterIds.value).toEqual([3054211, 4362887]);
    });

    it('returns empty map for empty playerIds', async () => {
      const map = await fetchEspnPlayersByIds('ffl', 2025, []);
      expect(map.size).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns empty map when fetch fails', async () => {
      mockFetch.mockResolvedValueOnce(new Response('error', { status: 500 }));
      const map = await fetchEspnPlayersByIds('ffl', 2025, ['123']);
      expect(map.size).toBe(0);
    });
  });

  it('maps all six message type IDs to correct transaction types', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({
        topics: [
          {
            id: 1,
            date: 9000,
            scoringPeriodId: 5,
            messages: [
              { id: 10, messageTypeId: 178, targetId: 1, to: 3 },   // FA added → add
              { id: 11, messageTypeId: 179, targetId: 2, to: 3 },   // dropped (FA add) → drop
              { id: 12, messageTypeId: 180, targetId: 3, from: 10, to: 4 }, // waiver added → waiver
              { id: 13, messageTypeId: 181, targetId: 4, to: 4 },   // dropped (waiver) → drop
              { id: 14, messageTypeId: 239, targetId: 5, for: 2 },  // dropped (trade) → drop
              { id: 15, messageTypeId: 244, targetId: 6, from: 2, to: 3 }, // traded → trade
            ],
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({ topics: [] }));

    const rows = await fetchEspnTransactionsByWeeks('ffl', '123', 2025, { s2: 'x', swid: '{y}' }, [5]);
    expect(rows).toHaveLength(6);

    const byId = Object.fromEntries(rows.map((r) => [r.transaction_id, r]));
    expect(byId['10']?.type).toBe('add');
    expect(byId['11']?.type).toBe('drop');
    expect(byId['12']?.type).toBe('waiver');
    expect(byId['12']?.faab_bid).toBe(10);
    expect(byId['13']?.type).toBe('drop');
    expect(byId['14']?.type).toBe('drop');
    expect(byId['15']?.type).toBe('trade');
  });

  it('normalizes activity feed rows across pages and weeks', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({
        topics: [
          {
            id: 1,
            date: 2000,
            scoringPeriodId: 6,
            messages: [
              { id: 10, messageTypeId: 180, targetId: 1, from: 12, to: 3 },
              { id: 11, messageTypeId: 244, targetId: 2, from: 3, to: 4 },
            ],
          },
          {
            id: 2,
            date: 1000,
            scoringPeriodId: 4,
            messages: [
              { id: 12, messageTypeId: 178, targetId: 3, to: 2 },
            ],
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({ topics: [] }));

    const rows = await fetchEspnTransactionsByWeeks('ffl', '123', 2025, { s2: 'x', swid: '{y}' }, [6, 7]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      transaction_id: '10',
      type: 'waiver',
      status: 'complete',
      week: 6,
      faab_bid: 12,
    });
    expect(rows[1]).toMatchObject({
      transaction_id: '11',
      type: 'trade',
      week: 6,
    });
  });

  describe('normalizeMTransactions2', () => {
    it('normalizes a FREEAGENT add with player items', () => {
      const txns: EspnMTransaction[] = [
        {
          id: 100,
          type: 'FREEAGENT',
          status: 'EXECUTED',
          teamId: 3,
          processDate: 1700000000000,
          scoringPeriodId: 7,
          items: [
            { playerId: 3054211, fromTeamId: -1, toTeamId: 3, type: 'ADD' },
            { playerId: 4362887, fromTeamId: 3, toTeamId: -1, type: 'DROP' },
          ],
        },
      ];

      const result = normalizeMTransactions2(txns);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        transaction_id: '100',
        type: 'add',
        status: 'complete',
        timestamp: 1700000000000,
        week: 7,
        team_ids: ['3'],
        faab_bid: null,
      });
      expect(result[0].players_added).toEqual([{ id: '3054211' }]);
      expect(result[0].players_dropped).toEqual([{ id: '4362887' }]);
    });

    it('normalizes a WAIVER with FAAB bid amount', () => {
      const txns: EspnMTransaction[] = [
        {
          id: 200,
          type: 'WAIVER',
          status: 'EXECUTED',
          teamId: 5,
          bidAmount: 42,
          processDate: 1700100000000,
          scoringPeriodId: 8,
          items: [
            { playerId: 1001, fromTeamId: -1, toTeamId: 5, type: 'ADD' },
          ],
        },
      ];

      const result = normalizeMTransactions2(txns);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: 'waiver',
        status: 'complete',
        faab_bid: 42,
        team_ids: ['5'],
      });
      expect(result[0].players_added).toEqual([{ id: '1001' }]);
    });

    it('normalizes a WAIVER_ERROR as failed_bid', () => {
      const txns: EspnMTransaction[] = [
        {
          id: 300,
          type: 'WAIVER_ERROR',
          status: 'FAILED_INVALIDPLAYERSOURCE',
          teamId: 2,
          bidAmount: 15,
          processDate: 1700200000000,
          scoringPeriodId: 8,
          items: [
            { playerId: 1001, fromTeamId: -1, toTeamId: 2, type: 'ADD' },
          ],
        },
      ];

      const result = normalizeMTransactions2(txns);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: 'failed_bid',
        status: 'failed',
        faab_bid: 15,
        team_ids: ['2'],
      });
    });

    it('normalizes TRADE_ACCEPT with empty items gracefully', () => {
      const txns: EspnMTransaction[] = [
        {
          id: 400,
          type: 'TRADE_ACCEPT',
          status: 'EXECUTED',
          teamId: 1,
          processDate: 1700300000000,
          scoringPeriodId: 9,
          items: [],
        },
      ];

      const result = normalizeMTransactions2(txns);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: 'trade',
        status: 'complete',
        team_ids: ['1'],
      });
      expect(result[0].players_added).toEqual([]);
      expect(result[0].players_dropped).toEqual([]);
    });

    it('normalizes TRADE_PROPOSAL as trade_proposal with pending status', () => {
      const txns: EspnMTransaction[] = [
        {
          id: 500,
          type: 'TRADE_PROPOSAL',
          status: 'PENDING',
          teamId: 3,
          proposedDate: 1700400000000,
          scoringPeriodId: 10,
          items: [
            { playerId: 2001, fromTeamId: 3, toTeamId: 7, type: 'ADD' },
            { playerId: 2002, fromTeamId: 7, toTeamId: 3, type: 'ADD' },
          ],
        },
      ];

      const result = normalizeMTransactions2(txns);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: 'trade_proposal',
        status: 'pending',
        team_ids: ['3'],
      });
      expect(result[0].players_added!.length + result[0].players_dropped!.length).toBe(2);
    });

    it('normalizes TRADE_DECLINE and TRADE_VETO', () => {
      const txns: EspnMTransaction[] = [
        {
          id: 600,
          type: 'TRADE_DECLINE',
          status: 'EXECUTED',
          teamId: 4,
          processDate: 1700500000000,
          scoringPeriodId: 10,
          items: [
            { playerId: 3001, fromTeamId: 4, toTeamId: 8, type: 'ADD' },
          ],
        },
        {
          id: 700,
          type: 'TRADE_VETO',
          status: 'EXECUTED',
          teamId: 5,
          processDate: 1700600000000,
          scoringPeriodId: 10,
          items: [],
        },
      ];

      const result = normalizeMTransactions2(txns);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ type: 'trade_veto', status: 'complete' });
      expect(result[1]).toMatchObject({ type: 'trade_decline', status: 'complete' });
    });

    it('normalizes TRADE_UPHOLD as trade_uphold', () => {
      const txns: EspnMTransaction[] = [
        {
          id: 800,
          type: 'TRADE_UPHOLD',
          status: 'EXECUTED',
          teamId: 6,
          processDate: 1700700000000,
          scoringPeriodId: 11,
          items: [],
        },
      ];

      const result = normalizeMTransactions2(txns);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        type: 'trade_uphold',
        status: 'complete',
        team_ids: ['6'],
      });
    });

    it('uses proposedDate when processDate is missing', () => {
      const txns: EspnMTransaction[] = [
        {
          id: 900,
          type: 'TRADE_PROPOSAL',
          status: 'PENDING',
          teamId: 1,
          proposedDate: 1700800000000,
          scoringPeriodId: 12,
          items: [],
        },
      ];

      const result = normalizeMTransactions2(txns);
      expect(result[0].timestamp).toBe(1700800000000);
    });

    it('skips transactions with unrecognized type', () => {
      const txns: EspnMTransaction[] = [
        { id: 999, type: 'UNKNOWN_TYPE', teamId: 1, processDate: 1000, scoringPeriodId: 1 },
      ];

      const result = normalizeMTransactions2(txns);
      expect(result).toHaveLength(0);
    });

    it('sorts results by timestamp descending', () => {
      const txns: EspnMTransaction[] = [
        { id: 1, type: 'FREEAGENT', status: 'EXECUTED', teamId: 1, processDate: 1000, scoringPeriodId: 1, items: [] },
        { id: 2, type: 'FREEAGENT', status: 'EXECUTED', teamId: 1, processDate: 3000, scoringPeriodId: 1, items: [] },
        { id: 3, type: 'FREEAGENT', status: 'EXECUTED', teamId: 1, processDate: 2000, scoringPeriodId: 1, items: [] },
      ];

      const result = normalizeMTransactions2(txns);
      expect(result.map((r) => r.transaction_id)).toEqual(['2', '3', '1']);
    });
  });

  describe('fetchEspnMTransactions2', () => {
    it('fetches mTransactions2 with correct URL and filter header', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({
          transactions: [
            {
              id: 100,
              type: 'FREEAGENT',
              status: 'EXECUTED',
              teamId: 3,
              processDate: 1700000000000,
              scoringPeriodId: 7,
              items: [{ playerId: 1001, fromTeamId: -1, toTeamId: 3, type: 'ADD' }],
            },
          ],
        }));

      const result = await fetchEspnMTransactions2('ffl', '123', 2025, { s2: 'x', swid: '{y}' }, [7]);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('add');

      const url = mockFetch.mock.calls[0]?.[0] as string;
      expect(url).toContain('/leagues/123');
      expect(url).toContain('view=mTransactions2');
      expect(url).toContain('scoringPeriodId=7');

      const init = mockFetch.mock.calls[0]?.[1] as RequestInit;
      const filterHeader = (init.headers as Record<string, string>)?.['x-fantasy-filter'];
      const parsed = JSON.parse(filterHeader);
      expect(parsed.transactions.filterType.value).toContain('WAIVER');
      expect(parsed.transactions.filterType.value).toContain('FREEAGENT');
      expect(parsed.transactions.filterType.value).toContain('TRADE_ACCEPT');
    });

    it('iterates multiple weeks and deduplicates by transaction ID', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        transactions: [
          { id: 100, type: 'FREEAGENT', status: 'EXECUTED', teamId: 3, processDate: 2000, scoringPeriodId: 7, items: [] },
        ],
      }));
      mockFetch.mockResolvedValueOnce(jsonResponse({
        transactions: [
          { id: 100, type: 'FREEAGENT', status: 'EXECUTED', teamId: 3, processDate: 2000, scoringPeriodId: 7, items: [] },
          { id: 200, type: 'WAIVER', status: 'EXECUTED', teamId: 5, processDate: 3000, scoringPeriodId: 8, items: [], bidAmount: 10 },
        ],
      }));

      const result = await fetchEspnMTransactions2('ffl', '123', 2025, { s2: 'x', swid: '{y}' }, [7, 8]);

      expect(result).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('returns empty array when no transactions in response', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      const result = await fetchEspnMTransactions2('ffl', '123', 2025, { s2: 'x', swid: '{y}' }, [7]);

      expect(result).toHaveLength(0);
    });

    it('paginates when a page is full (50 transactions)', async () => {
      // Page 1: exactly 50 transactions → triggers page 2
      const fullPage = Array.from({ length: 50 }, (_, i) => ({
        id: i + 1, type: 'FREEAGENT', status: 'EXECUTED', teamId: 1,
        processDate: 50000 - i, scoringPeriodId: 7, items: [],
      }));
      mockFetch.mockResolvedValueOnce(jsonResponse({ transactions: fullPage }));
      // Page 2: partial page → stops
      mockFetch.mockResolvedValueOnce(jsonResponse({
        transactions: [
          { id: 999, type: 'WAIVER', status: 'EXECUTED', teamId: 2, processDate: 1, scoringPeriodId: 7, items: [] },
        ],
      }));

      const result = await fetchEspnMTransactions2('ffl', '123', 2025, { s2: 'x', swid: '{y}' }, [7]);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(51);

      // Verify offset was sent on second call
      const secondInit = mockFetch.mock.calls[1]?.[1] as RequestInit;
      const filter = JSON.parse((secondInit.headers as Record<string, string>)['x-fantasy-filter']);
      expect(filter.transactions.offset).toBe(50);
    });
  });

  describe('mergeTradePlayerDetails', () => {
    it('fills empty players on trade/trade_uphold from activity feed rows', () => {
      const mTxns: NormalizedTransaction[] = [
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
      ];

      const activityTxns: NormalizedTransaction[] = [
        {
          transaction_id: 'act-trade-1',
          type: 'trade',
          status: 'complete',
          timestamp: 1700300000000,
          date: '2023-11-18',
          week: 9,
          team_ids: ['1', '3'],
          players_added: [{ id: '2001' }],
          players_dropped: [{ id: '2002' }],
          faab_bid: null,
        },
      ];

      const result = mergeTradePlayerDetails(mTxns, activityTxns);
      expect(result).toHaveLength(1);
      expect(result[0].players_added).toEqual([{ id: '2001' }]);
      expect(result[0].players_dropped).toEqual([{ id: '2002' }]);
      expect(result[0].team_ids).toEqual(['1', '3']);
    });

    it('does not overwrite trade transactions that already have player items', () => {
      const mTxns: NormalizedTransaction[] = [
        {
          transaction_id: '500',
          type: 'trade',
          status: 'complete',
          timestamp: 1700400000000,
          date: '2023-11-19',
          week: 10,
          team_ids: ['3'],
          players_added: [{ id: '3001' }],
          players_dropped: [{ id: '3002' }],
          faab_bid: null,
        },
      ];

      const activityTxns: NormalizedTransaction[] = [
        {
          transaction_id: 'act-trade-other',
          type: 'trade',
          status: 'complete',
          timestamp: 1700400000000,
          date: '2023-11-19',
          week: 10,
          team_ids: ['3', '7'],
          players_added: [{ id: '9999' }],
          players_dropped: [{ id: '8888' }],
          faab_bid: null,
        },
      ];

      const result = mergeTradePlayerDetails(mTxns, activityTxns);
      expect(result[0].players_added).toEqual([{ id: '3001' }]);
      expect(result[0].players_dropped).toEqual([{ id: '3002' }]);
    });

    it('matches by team overlap and does not reuse the same activity trade', () => {
      const mTxns: NormalizedTransaction[] = [
        {
          transaction_id: '401',
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
        {
          transaction_id: '402',
          type: 'trade',
          status: 'complete',
          timestamp: 1700300005000, // 5s later
          date: '2023-11-18',
          week: 9,
          team_ids: ['5'],
          players_added: [],
          players_dropped: [],
          faab_bid: null,
        },
      ];

      const activityTxns: NormalizedTransaction[] = [
        {
          transaction_id: 'act-1',
          type: 'trade',
          status: 'complete',
          timestamp: 1700300000000,
          date: '2023-11-18',
          week: 9,
          team_ids: ['1', '3'],
          players_added: [{ id: 'p1' }],
          players_dropped: [{ id: 'p2' }],
          faab_bid: null,
        },
        {
          transaction_id: 'act-2',
          type: 'trade',
          status: 'complete',
          timestamp: 1700300005000,
          date: '2023-11-18',
          week: 9,
          team_ids: ['5', '8'],
          players_added: [{ id: 'p3' }],
          players_dropped: [{ id: 'p4' }],
          faab_bid: null,
        },
      ];

      const result = mergeTradePlayerDetails(mTxns, activityTxns);
      // Trade 401 (team 1) matches act-1 (teams 1,3)
      expect(result[0].players_added).toEqual([{ id: 'p1' }]);
      expect(result[0].team_ids).toEqual(['1', '3']);
      // Trade 402 (team 5) matches act-2 (teams 5,8) — act-1 already consumed
      expect(result[1].players_added).toEqual([{ id: 'p3' }]);
      expect(result[1].team_ids).toEqual(['5', '8']);
    });

    it('leaves non-trade transactions untouched', () => {
      const mTxns: NormalizedTransaction[] = [
        {
          transaction_id: '100',
          type: 'add',
          status: 'complete',
          timestamp: 1700000000000,
          date: '2023-11-14',
          week: 7,
          players_added: [{ id: '1001' }],
          players_dropped: [],
          faab_bid: null,
        },
      ];

      const result = mergeTradePlayerDetails(mTxns, []);
      expect(result).toEqual(mTxns);
    });
  });
});
