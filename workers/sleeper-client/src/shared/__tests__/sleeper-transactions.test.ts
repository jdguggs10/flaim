import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { fetchSleeperTransactionsByWeeks, getSleeperCurrentWeek } from '../sleeper-transactions';

const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('sleeper-transactions', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('gets current week from state endpoint', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ week: 9 }));
    const week = await getSleeperCurrentWeek('/state/nfl');
    expect(week).toBe(9);
  });

  it('fetches and normalizes transactions across weeks', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([
        {
          transaction_id: 'a1',
          type: 'trade',
          status: 'complete',
          status_updated: 100,
          leg: 8,
          roster_ids: [1, 2],
          adds: null,
          drops: null,
          draft_picks: [],
        },
      ]))
      .mockResolvedValueOnce(jsonResponse([
        {
          transaction_id: 'b1',
          type: 'waiver',
          status: 'complete',
          status_updated: 200,
          leg: 9,
          roster_ids: [3],
          adds: { '123': 3 },
          drops: { '456': 3 },
          settings: { waiver_bid: 17 },
        },
      ]));

    const rows = await fetchSleeperTransactionsByWeeks('league', [8, 9]);
    expect(rows).toHaveLength(2);
    expect(rows[0].transaction_id).toBe('b1');
    expect(rows[0].type).toBe('waiver');
    expect(rows[0].faab_bid).toBe(17);
    expect(rows[0].players_added).toEqual([{ id: '123', name: undefined, position: undefined, team: undefined }]);
  });

  it('enriches player adds/drops when resolver provides metadata', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([
      {
        transaction_id: 'x1',
        type: 'waiver',
        status: 'complete',
        status_updated: 200,
        leg: 9,
        adds: { '123': 3 },
        drops: { '456': 3 },
      },
    ]));

    const rows = await fetchSleeperTransactionsByWeeks('league', [9], (playerId) => {
      if (playerId === '123') return { name: 'Josh Allen', position: 'QB', team: 'BUF' };
      return undefined;
    });

    expect(rows[0].players_added).toEqual([{ id: '123', name: 'Josh Allen', position: 'QB', team: 'BUF' }]);
    expect(rows[0].players_dropped).toEqual([{ id: '456', name: undefined, position: undefined, team: undefined }]);
  });
});
