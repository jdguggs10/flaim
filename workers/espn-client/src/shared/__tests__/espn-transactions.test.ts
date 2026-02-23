import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { fetchEspnTransactionsByWeeks, getCurrentEspnScoringPeriod } from '../espn-transactions';

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

  it('reads current scoring period from mSettings', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ scoringPeriodId: 7 }));
    const week = await getCurrentEspnScoringPeriod('ffl', '123', 2025, { s2: 'x', swid: '{y}' });
    expect(week).toBe(7);
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
