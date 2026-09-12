import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { assertTransactionsSeasonSupported, executeEspnTransactionOperation, fetchEspnTransactionsByWeeks, fetchEspnMTransactions2, normalizeMTransactions2, mergeTradePlayerDetails, getEspnLeagueContext, fetchEspnPlayersByIds } from '../espn-transactions';
import type { EspnMTransaction, NormalizedTransaction } from '../espn-transactions';
import { getCurrentSeasonYear } from '../season';

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
    it('returns scoringPeriodId and teams map from the league context views', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        scoringPeriodId: 7,
        currentMatchupPeriod: 7,
        teams: [
          { id: 1, location: 'Gotham', nickname: 'Knights' },
          { id: 2, name: 'Team Two' },
          { id: 3 },
        ],
      }));
      const ctx = await getEspnLeagueContext('ffl', '123', 2025, { s2: 'x', swid: '{y}' });
      expect(ctx.scoringPeriodId).toBe(7);
      expect(ctx.currentMatchupPeriod).toBe(7);
      expect(ctx.teams).toEqual({
        '1': 'Gotham Knights',
        '2': 'Team Two',
        '3': 'Team 3',
      });
      // Football does not need the daily matchup-score view.
      const url = mockFetch.mock.calls[0]?.[0] as string;
      expect(url).toContain('view=mSettings&view=mTeam');
      expect(url).not.toContain('view=mMatchupScore');
    });

    it('derives baseball matchup windows from score-period keys and adds the current day', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        scoringPeriodId: 127,
        currentMatchupPeriod: 17,
        schedule: [
          {
            matchupPeriodId: 15,
            home: { pointsByScoringPeriod: { 104: 1, 105: 2, 117: 3 } },
            away: { pointsByScoringPeriod: { 104: 4, 105: 5, 117: 6 } },
          },
          {
            matchupPeriodId: 16,
            home: { pointsByScoringPeriod: { 118: 1, 124: 2 } },
          },
          {
            matchupPeriodId: 17,
            home: { pointsByScoringPeriod: { 125: 1, 126: 2 } },
          },
        ],
        teams: [],
      }));

      const ctx = await getEspnLeagueContext(
        'flb',
        '30201',
        2026,
        { s2: 'x', swid: '{y}' },
      );

      expect(ctx.matchupPeriods).toEqual({
        15: [104, 105, 117],
        16: [118, 124],
        17: [125, 126, 127],
      });
      expect(ctx.scheduledMatchupPeriodIds).toEqual([15, 16, 17]);
    });

    it('fails closed when ESPN assigns the current scoring day to another matchup', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        scoringPeriodId: 127,
        currentMatchupPeriod: 17,
        schedule: [{
          matchupPeriodId: 16,
          home: { pointsByScoringPeriod: { 127: 1 } },
        }],
      }));

      await expect(
        getEspnLeagueContext('flb', '30201', 2026, { s2: 'x', swid: '{y}' }),
      ).rejects.toThrow('different matchup period');
    });

    it('fails closed when ESPN omits the current period selectors', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      await expect(
        getEspnLeagueContext('ffl', '123', 2025, { s2: 'x', swid: '{y}' }),
      ).rejects.toThrow('ESPN_INVALID_RESPONSE');
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
      expect(url).toContain('/players?scoringPeriodId=0&view=players_wl');
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

  describe('enrichTransactions', () => {
    it('enriches nested trade sides', async () => {
      const { enrichTransactions } = await import('../espn-transactions');
      const transactions: NormalizedTransaction[] = [
        {
          transaction_id: 'trade-1',
          type: 'trade',
          status: 'complete',
          timestamp: 1700300000000,
          date: '2023-11-18',
          week: 9,
          team_ids: ['1', '2'],
          players_added: [],
          players_dropped: [],
          trade_sides: [
            { team_id: '1', acquired: [{ id: '1002' }], gave_up: [{ id: '1001' }] },
            { team_id: '2', acquired: [{ id: '1001' }], gave_up: [{ id: '1002' }] },
          ],
          faab_bid: null,
        },
      ];
      const playerMap = new Map([
        ['1001', { fullName: 'Player One', defaultPositionId: 1, proTeamId: 10 }],
        ['1002', { fullName: 'Player Two', defaultPositionId: 2, proTeamId: 20 }],
      ]);

      const result = enrichTransactions(
        transactions,
        playerMap,
        (id) => `POS_${id}`,
        (id) => `TEAM_${id}`,
      );

      expect(result[0].trade_sides?.[0]?.acquired[0]).toEqual({
        id: '1002',
        name: 'Player Two',
        position: 'POS_2',
        team: 'TEAM_20',
      });
      expect(result[0].trade_sides?.[0]?.gave_up[0]).toEqual({
        id: '1001',
        name: 'Player One',
        position: 'POS_1',
        team: 'TEAM_10',
      });
      expect(result[0].trade_sides?.[1]?.acquired[0]).toEqual({
        id: '1001',
        name: 'Player One',
        position: 'POS_1',
        team: 'TEAM_10',
      });
      expect(result[0].trade_sides?.[1]?.gave_up[0]).toEqual({
        id: '1002',
        name: 'Player Two',
        position: 'POS_2',
        team: 'TEAM_20',
      });
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
    expect(byId['12']?.faab_bid).toBeNull();
    expect(byId['13']?.type).toBe('drop');
    expect(byId['14']?.type).toBe('drop');
    expect(byId['1']?.type).toBe('trade');
    expect(byId['1']?.trade_sides).toEqual([
      {
        team_id: '2',
        acquired: [],
        gave_up: [{ id: '6' }],
      },
      {
        team_id: '3',
        acquired: [{ id: '6' }],
        gave_up: [],
      },
    ]);
  });

  it('groups trade activity messages into directional trade sides', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({
        topics: [
          {
            id: 99,
            date: 1700300000000,
            scoringPeriodId: 9,
            messages: [
              { id: 101, messageTypeId: 244, targetId: 1001, from: 1, to: 2 },
              { id: 102, messageTypeId: 244, targetId: 1002, from: 2, to: 1 },
            ],
          },
        ],
      }))
      .mockResolvedValueOnce(jsonResponse({ topics: [] }));

    const rows = await fetchEspnTransactionsByWeeks('ffl', '123', 2025, { s2: 'x', swid: '{y}' }, [9]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      transaction_id: '99',
      type: 'trade',
      status: 'complete',
      week: 9,
      team_ids: ['1', '2'],
      players_added: [],
      players_dropped: [],
    });
    expect(rows[0].trade_sides).toEqual([
      {
        team_id: '1',
        acquired: [{ id: '1002' }],
        gave_up: [{ id: '1001' }],
      },
      {
        team_id: '2',
        acquired: [{ id: '1001' }],
        gave_up: [{ id: '1002' }],
      },
    ]);
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
      faab_bid: null,
    });
    expect(rows[1]).toMatchObject({
      transaction_id: '1',
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

    it('classifies FREEAGENT transactions with only drops as type drop', () => {
      const txns: EspnMTransaction[] = [
        {
          id: 101,
          type: 'FREEAGENT',
          status: 'EXECUTED',
          teamId: 3,
          processDate: 1700000000001,
          scoringPeriodId: 7,
          items: [
            { playerId: 4362887, fromTeamId: 3, toTeamId: -1, type: 'DROP' },
          ],
        },
      ];

      const result = normalizeMTransactions2(txns);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        transaction_id: '101',
        type: 'drop',
        status: 'complete',
        team_ids: ['3'],
      });
      expect(result[0].players_added).toEqual([]);
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

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].type).toBe('add');

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

    it('sends only the minimal accepted filter shape — no pagination or sort fields', () => {
      // Regression pin on the FLA-140 root cause: ESPN returns HTTP 400 for
      // ANY x-fantasy-filter carrying limit/offset on this view. filterType
      // must be the only key.
      return (async () => {
        mockFetch.mockResolvedValueOnce(jsonResponse({ transactions: [] }));

        await fetchEspnMTransactions2('ffl', '123', 2025, { s2: 'x', swid: '{y}' }, [7]);

        const init = mockFetch.mock.calls[0]?.[1] as RequestInit;
        const parsed = JSON.parse((init.headers as Record<string, string>)['x-fantasy-filter']);
        expect(Object.keys(parsed)).toEqual(['transactions']);
        expect(Object.keys(parsed.transactions)).toEqual(['filterType']);
        expect(parsed.transactions.limit).toBeUndefined();
        expect(parsed.transactions.offset).toBeUndefined();
        expect(parsed.transactions.sortDatePublished).toBeUndefined();
      })();
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

      expect(result.transactions).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('returns empty array when no transactions in response', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({}));

      const result = await fetchEspnMTransactions2('ffl', '123', 2025, { s2: 'x', swid: '{y}' }, [7]);

      expect(result.transactions).toHaveLength(0);
    });

    it('issues exactly one unpaginated request per scoring period', async () => {
      // A large unpaginated response comes back in one request — there is no
      // follow-up page or probe traffic (the view cannot be paged).
      const bigResponse = Array.from({ length: 120 }, (_, i) => ({
        id: i + 1, type: 'FREEAGENT', status: 'EXECUTED', teamId: 1,
        processDate: 500000 - i, scoringPeriodId: 7, items: [],
      }));
      mockFetch.mockResolvedValueOnce(jsonResponse({ transactions: bigResponse }));

      const result = await fetchEspnMTransactions2('ffl', '123', 2025, { s2: 'x', swid: '{y}' }, [7]);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result.transactions).toHaveLength(120);
    });

    it('throws immediately when the operation budget is already exhausted', async () => {
      await expect(
        fetchEspnMTransactions2('ffl', '123', 2025, { s2: 'x', swid: '{y}' }, [7], Date.now() - 1),
      ).rejects.toThrow('ESPN_TIMEOUT');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('times out a body read that stalls after headers arrive', async () => {
      // espnFetch's abort timer is cleared once response headers arrive, so a
      // provider stalling mid-body would otherwise hold the structured
      // attempt past its deadline. The body read must race the budget.
      vi.useFakeTimers();
      try {
        mockFetch.mockResolvedValueOnce(
          new Response(new ReadableStream({ start() { /* never closes */ } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        );

        const pending = fetchEspnMTransactions2(
          'ffl', '123', 2025, { s2: 'x', swid: '{y}' }, [7], Date.now() + 2000,
        );
        const outcome = expect(pending).rejects.toThrow('ESPN_TIMEOUT');
        await vi.advanceTimersByTimeAsync(2100);
        await outcome;
      } finally {
        vi.useRealTimers();
      }
    });

    it('fails the whole fetch when any scoring period request fails', async () => {
      // All-or-nothing: a partially covered window must not be served as if
      // complete — the caller falls back to the activity feed instead.
      mockFetch.mockResolvedValueOnce(jsonResponse({ transactions: [] }));
      mockFetch.mockResolvedValueOnce(new Response('nope', { status: 400 }));

      await expect(
        fetchEspnMTransactions2('ffl', '123', 2025, { s2: 'x', swid: '{y}' }, [7, 8]),
      ).rejects.toThrow();
    });

    it('builds directional trade_sides from structured movement items', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
        transactions: [
          {
            id: 555,
            type: 'TRADE_ACCEPT',
            status: 'EXECUTED',
            teamId: 3,
            processDate: 1700000000000,
            scoringPeriodId: 7,
            items: [
              { playerId: 1001, fromTeamId: 3, toTeamId: 5 },
              { playerId: 2002, fromTeamId: 5, toTeamId: 3 },
            ],
          },
        ],
      }));

      const result = await fetchEspnMTransactions2('ffl', '123', 2025, { s2: 'x', swid: '{y}' }, [7]);

      expect(result.transactions).toHaveLength(1);
      const trade = result.transactions[0];
      expect(trade.type).toBe('trade');
      expect(trade.team_ids).toEqual(['3', '5']);
      expect(trade.trade_sides).toEqual([
        {
          team_id: '3',
          acquired: [{ id: '2002' }],
          gave_up: [{ id: '1001' }],
        },
        {
          team_id: '5',
          acquired: [{ id: '1001' }],
          gave_up: [{ id: '2002' }],
        },
      ]);
    });

    it('leaves trade_sides absent when movement items are incomplete', async () => {
      // One item lacks team movement info: emitting half-directional sides
      // would be worse than none, so sides stay absent for the activity-feed
      // merge to fill.
      mockFetch.mockResolvedValueOnce(jsonResponse({
        transactions: [
          {
            id: 556,
            type: 'TRADE_UPHOLD',
            status: 'EXECUTED',
            teamId: 3,
            processDate: 1700000000000,
            scoringPeriodId: 7,
            items: [
              { playerId: 1001, fromTeamId: 3, toTeamId: 5 },
              { playerId: 2002, type: 'ADD', toTeamId: 3 },
            ],
          },
        ],
      }));

      const result = await fetchEspnMTransactions2('ffl', '123', 2025, { s2: 'x', swid: '{y}' }, [7]);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].type).toBe('trade_uphold');
      expect(result.transactions[0].trade_sides).toBeUndefined();
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

    it('fills directional trade sides from activity feed rows', () => {
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
          players_added: [],
          players_dropped: [],
          trade_sides: [
            {
              team_id: '1',
              acquired: [{ id: '2002' }],
              gave_up: [{ id: '2001' }],
            },
            {
              team_id: '3',
              acquired: [{ id: '2001' }],
              gave_up: [{ id: '2002' }],
            },
          ],
          faab_bid: null,
        },
      ];

      const result = mergeTradePlayerDetails(mTxns, activityTxns);
      expect(result[0].trade_sides).toEqual(activityTxns[0].trade_sides);
      expect(result[0].team_ids).toEqual(['1', '3']);
    });

    it('fills missing sides on mixed rows while preserving their flat player lists', () => {
      // The FLA-140 mixed-completeness case: a structured trade row with flat
      // players but no directional sides still takes sides from the activity
      // feed — but its own flat lists are never overwritten.
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
          trade_sides: [
            { team_id: '3', acquired: [{ id: '3001' }], gave_up: [{ id: '3002' }] },
            { team_id: '7', acquired: [{ id: '3002' }], gave_up: [{ id: '3001' }] },
          ],
          faab_bid: null,
        },
      ];

      const result = mergeTradePlayerDetails(mTxns, activityTxns);
      expect(result[0].players_added).toEqual([{ id: '3001' }]);
      expect(result[0].players_dropped).toEqual([{ id: '3002' }]);
      expect(result[0].trade_sides).toEqual(activityTxns[0].trade_sides);
      expect(result[0].team_ids).toEqual(['3', '7']);
    });

    it('leaves trades with populated directional sides untouched', () => {
      const sides = [
        { team_id: '3', acquired: [{ id: '3001' }], gave_up: [{ id: '3002' }] },
        { team_id: '7', acquired: [{ id: '3002' }], gave_up: [{ id: '3001' }] },
      ];
      const mTxns: NormalizedTransaction[] = [
        {
          transaction_id: '500',
          type: 'trade',
          status: 'complete',
          timestamp: 1700400000000,
          date: '2023-11-19',
          week: 10,
          team_ids: ['3', '7'],
          players_added: [],
          players_dropped: [],
          trade_sides: sides,
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
          trade_sides: [
            { team_id: '3', acquired: [{ id: '9999' }], gave_up: [{ id: '8888' }] },
            { team_id: '7', acquired: [{ id: '8888' }], gave_up: [{ id: '9999' }] },
          ],
          faab_bid: null,
        },
      ];

      const result = mergeTradePlayerDetails(mTxns, activityTxns);
      expect(result[0].trade_sides).toEqual(sides);
      expect(result[0].players_added).toEqual([]);
    });

    it('treats empty trade sides as missing player data', () => {
      const mTxns: NormalizedTransaction[] = [
        {
          transaction_id: '501',
          type: 'trade',
          status: 'complete',
          timestamp: 1700400000000,
          date: '2023-11-19',
          week: 10,
          team_ids: ['3'],
          players_added: [],
          players_dropped: [],
          trade_sides: [
            { team_id: '3', acquired: [], gave_up: [] },
            { team_id: '7', acquired: [], gave_up: [] },
          ],
          faab_bid: null,
        },
      ];

      const activityTxns: NormalizedTransaction[] = [
        {
          transaction_id: 'act-trade-empty-side-fill',
          type: 'trade',
          status: 'complete',
          timestamp: 1700400000000,
          date: '2023-11-19',
          week: 10,
          team_ids: ['3', '7'],
          players_added: [],
          players_dropped: [],
          trade_sides: [
            { team_id: '3', acquired: [{ id: '7001' }], gave_up: [{ id: '7002' }] },
            { team_id: '7', acquired: [{ id: '7002' }], gave_up: [{ id: '7001' }] },
          ],
          faab_bid: null,
        },
      ];

      const result = mergeTradePlayerDetails(mTxns, activityTxns);
      expect(result[0].trade_sides).toEqual(activityTxns[0].trade_sides);
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

  describe('assertTransactionsSeasonSupported', () => {
    it('throws ESPN_SEASON_NOT_SUPPORTED for a prior season', () => {
      const currentSeason = getCurrentSeasonYear('baseball');
      expect(() => assertTransactionsSeasonSupported('baseball', currentSeason - 1)).toThrow(
        `ESPN_SEASON_NOT_SUPPORTED: ESPN only provides transactions for the current season (season_year=${currentSeason}). Prior-season transaction data is unavailable. Retry with the current season only if the user meant the ongoing season.`
      );
    });

    it('allows the current season', () => {
      const currentSeason = getCurrentSeasonYear('football');
      expect(() => assertTransactionsSeasonSupported('football', currentSeason)).not.toThrow();
    });

    it('allows a future season', () => {
      const currentSeason = getCurrentSeasonYear('basketball');
      expect(() => assertTransactionsSeasonSupported('basketball', currentSeason + 1)).not.toThrow();
    });
  });

  describe('executeEspnTransactionOperation count cap', () => {
    it('flags possibly_truncated and reports returned_rows when matching transactions exceed count', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({
          scoringPeriodId: 3,
          currentMatchupPeriod: 3,
          teams: [],
        }))
        .mockResolvedValueOnce(jsonResponse({
          transactions: [
            {
              id: 20,
              type: 'FREEAGENT',
              status: 'EXECUTED',
              teamId: 1,
              processDate: Date.parse('2026-09-20T16:00:00Z'),
              scoringPeriodId: 3,
              items: [],
            },
            {
              id: 21,
              type: 'FREEAGENT',
              status: 'EXECUTED',
              teamId: 1,
              processDate: Date.parse('2026-09-20T15:00:00Z'),
              scoringPeriodId: 3,
              items: [],
            },
          ],
        }))
        .mockResolvedValueOnce(jsonResponse({ transactions: [] }));

      const result = await executeEspnTransactionOperation({
        gameId: 'ffl',
        leagueId: '123',
        seasonYear: 2026,
        sport: 'football',
        credentials: { s2: 'x', swid: '{y}' },
        count: 1,
        getPositionName: String,
        getProTeamAbbrev: String,
      });

      expect(result.transactions).toHaveLength(1);
      expect(result.window.returned_rows).toBe(1);
      expect(result.truncated).toBe(true);
      expect(result.limitations.possibly_truncated).toBe(true);
    });

    it('leaves possibly_truncated unset when matching transactions fit within count', async () => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({
          scoringPeriodId: 3,
          currentMatchupPeriod: 3,
          teams: [],
        }))
        .mockResolvedValueOnce(jsonResponse({
          transactions: [
            {
              id: 30,
              type: 'FREEAGENT',
              status: 'EXECUTED',
              teamId: 1,
              processDate: Date.parse('2026-09-20T16:00:00Z'),
              scoringPeriodId: 3,
              items: [],
            },
          ],
        }))
        .mockResolvedValueOnce(jsonResponse({ transactions: [] }));

      const result = await executeEspnTransactionOperation({
        gameId: 'ffl',
        leagueId: '123',
        seasonYear: 2026,
        sport: 'football',
        credentials: { s2: 'x', swid: '{y}' },
        count: 25,
        getPositionName: String,
        getProTeamAbbrev: String,
      });

      expect(result.transactions).toHaveLength(1);
      expect(result.window.returned_rows).toBe(1);
      expect(result.truncated).toBe(false);
      expect(result.limitations.possibly_truncated).toBeUndefined();
    });

    it('leaves possibly_truncated unset when matching transactions exactly equal count (boundary, not >=)', async () => {
      const items = Array.from({ length: 25 }, (_, i) => ({
        id: 100 + i,
        type: 'FREEAGENT',
        status: 'EXECUTED',
        teamId: 1,
        processDate: Date.parse('2026-09-20T16:00:00Z') - i * 1000,
        scoringPeriodId: 3,
        items: [],
      }));

      mockFetch
        .mockResolvedValueOnce(jsonResponse({
          scoringPeriodId: 3,
          currentMatchupPeriod: 3,
          teams: [],
        }))
        .mockResolvedValueOnce(jsonResponse({ transactions: items }))
        .mockResolvedValueOnce(jsonResponse({ transactions: [] }));

      const result = await executeEspnTransactionOperation({
        gameId: 'ffl',
        leagueId: '123',
        seasonYear: 2026,
        sport: 'football',
        credentials: { s2: 'x', swid: '{y}' },
        count: 25,
        getPositionName: String,
        getProTeamAbbrev: String,
      });

      expect(result.transactions).toHaveLength(25);
      expect(result.window.returned_rows).toBe(25);
      expect(result.truncated).toBe(false);
      expect(result.limitations.possibly_truncated).toBeUndefined();
    });
  });
});
