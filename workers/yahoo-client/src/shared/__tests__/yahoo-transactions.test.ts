import { describe, expect, it } from 'vitest';
import { buildYahooTransactionsPath, normalizeYahooTransactions } from '../yahoo-transactions';

describe('yahoo-transactions', () => {
  it('builds matrix-param path with count clamp', () => {
    expect(buildYahooTransactionsPath('449.l.123', 0)).toBe('/league/449.l.123/transactions;types=add,drop,trade;count=1');
    expect(buildYahooTransactionsPath('449.l.123', 999)).toBe('/league/449.l.123/transactions;types=add,drop,trade;count=100');
  });

  it('normalizes add/drop transactions from numeric-keyed Yahoo JSON', () => {
    const raw = {
      fantasy_content: {
        league: [
          { league_key: '449.l.123' },
          {
            transactions: {
              0: {
                transaction: [
                  { transaction_key: '449.l.123.tr.1' },
                  { type: 'add' },
                  { status: 'successful' },
                  { timestamp: '1700000000' },
                  {
                    players: {
                      0: {
                        player: [
                          [
                            { player_id: '12' },
                            { name: { full: 'Sample Player' } },
                          ],
                          { transaction_data: { type: 'add' } },
                        ],
                      },
                      count: 1,
                    },
                  },
                ],
              },
              count: 1,
            },
          },
        ],
      },
    };

    const normalized = normalizeYahooTransactions(raw);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({
      transaction_id: '449.l.123.tr.1',
      type: 'add',
      status: 'complete',
      timestamp: 1700000000000,
    });
    expect(normalized[0].players_added).toEqual([{ id: '12', name: 'Sample Player' }]);
  });

  it('extracts faab_bid when transaction_data includes waiver bid info', () => {
    const raw = {
      fantasy_content: {
        league: [
          { league_key: '449.l.123' },
          {
            transactions: {
              0: {
                transaction: [
                  { transaction_key: '449.l.123.tr.2' },
                  { type: 'add' },
                  { status: 'successful' },
                  { timestamp: '1700100000' },
                  {
                    players: {
                      0: {
                        player: [
                          [{ player_id: '34' }],
                          { transaction_data: { type: 'add', source_type: 'waivers', faab_bid: '18' } },
                        ],
                      },
                      count: 1,
                    },
                  },
                ],
              },
              count: 1,
            },
          },
        ],
      },
    };

    const normalized = normalizeYahooTransactions(raw);
    expect(normalized).toHaveLength(1);
    expect(normalized[0]?.faab_bid).toBe(18);
  });
});
