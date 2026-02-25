import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { fetchEspnTransactionsByWeeks, getEspnLeagueContext, fetchEspnPlayersByIds } from '../espn-transactions';

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
});
