import { describe, expect, it } from 'vitest';
import { buildYahooTransactionsPath, buildYahooPendingTransactionsPath, normalizeYahooTransactions } from '../yahoo-transactions';

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

  it('builds pending transactions path with team_key and types', () => {
    expect(buildYahooPendingTransactionsPath('449.l.123', '449.l.123.t.3', ['waiver'], 10)).toBe(
      '/league/449.l.123/transactions;types=waiver;team_key=449.l.123.t.3;count=10',
    );
    expect(buildYahooPendingTransactionsPath('449.l.123', '449.l.123.t.3', ['pending_trade'], 0)).toBe(
      '/league/449.l.123/transactions;types=pending_trade;team_key=449.l.123.t.3;count=1',
    );
  });

  it('canonicalType recognizes pending_trade', () => {
    const raw = {
      fantasy_content: {
        league: [
          { league_key: '449.l.123' },
          {
            transactions: {
              0: {
                transaction: [
                  { transaction_key: '449.l.123.tr.5' },
                  { type: 'pending_trade' },
                  { status: 'proposed' },
                  { timestamp: '1700200000' },
                  { trader_team_key: '449.l.123.t.1', tradee_team_key: '449.l.123.t.5' },
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
      type: 'pending_trade',
      status: 'unknown',
      team_ids: ['449.l.123.t.1', '449.l.123.t.5'],
    });
  });

  it('extracts waiver_priority from pending waiver transaction', () => {
    const raw = {
      fantasy_content: {
        league: [
          { league_key: '449.l.123' },
          {
            transactions: {
              0: {
                transaction: [
                  { transaction_key: '449.l.123.tr.6' },
                  { type: 'waiver' },
                  { status: 'pending' },
                  { timestamp: '1700300000' },
                  { waiver_priority: '3', faab_bid: '25' },
                  {
                    players: {
                      0: {
                        player: [
                          [{ player_id: '99' }, { name: { full: 'Waiver Target' } }],
                          { transaction_data: { type: 'add', faab_bid: '25' } },
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
      type: 'waiver',
      status: 'pending',
      waiver_priority: 3,
      faab_bid: 25,
    });
    expect(normalized[0].players_added).toEqual([{ id: '99', name: 'Waiver Target' }]);
  });
});
