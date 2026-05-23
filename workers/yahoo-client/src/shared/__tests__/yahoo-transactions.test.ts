import { describe, expect, it } from 'vitest';
import { buildYahooTransactionsPath, buildYahooPendingTransactionsPath, normalizeYahooTransactions } from '../yahoo-transactions';

describe('yahoo-transactions', () => {
  it('builds matrix-param path with count clamp', () => {
    expect(buildYahooTransactionsPath('449.l.123', 0)).toBe('/league/449.l.123/transactions;types=add,drop,add%2Fdrop,trade;count=1');
    expect(buildYahooTransactionsPath('449.l.123', 999)).toBe('/league/449.l.123/transactions;types=add,drop,add%2Fdrop,trade;count=100');
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

  it('normalizes player details when Yahoo returns transaction_data as an array', () => {
    const raw = {
      fantasy_content: {
        league: [
          { league_key: '449.l.123' },
          {
            transactions: {
              0: {
                transaction: [
                  { transaction_key: '449.l.123.tr.3' },
                  { type: 'add' },
                  { status: 'successful' },
                  { timestamp: '1700000000' },
                  {
                    players: {
                      0: {
                        player: [
                          [
                            { player_key: '449.p.9999' },
                            { player_id: '9999' },
                            { name: { full: 'Array Add Player' } },
                            { display_position: 'SP' },
                            { editorial_team_abbr: 'SD' },
                          ],
                          {
                            transaction_data: [
                              { type: 'add' },
                              { source_type: 'freeagents' },
                              { destination_type: 'team' },
                            ],
                          },
                        ],
                      },
                      1: {
                        player: [
                          [
                            { player_id: '8888' },
                            { name: { full: 'Array Drop Player' } },
                            { display_position: 'RP' },
                            { editorial_team_abbr: 'SEA' },
                          ],
                          {
                            transaction_data: [
                              { type: 'drop' },
                              { source_type: 'team' },
                              { destination_type: 'waivers' },
                            ],
                          },
                        ],
                      },
                      count: 2,
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
    expect(normalized[0].players_added).toEqual([
      { id: '9999', name: 'Array Add Player', position: 'SP', team: 'SD' },
    ]);
    expect(normalized[0].players_dropped).toEqual([
      { id: '8888', name: 'Array Drop Player', position: 'RP', team: 'SEA' },
    ]);
  });

  it('normalizes completed add/drop transactions and extracts team attribution from player transaction data', () => {
    const raw = {
      fantasy_content: {
        league: [
          { league_key: '449.l.123' },
          {
            transactions: {
              0: {
                transaction: [
                  { transaction_key: '449.l.123.tr.4' },
                  { type: 'add/drop' },
                  { status: 'successful' },
                  { timestamp: '1700000000' },
                  {
                    players: {
                      0: {
                        player: [
                          [
                            { player_id: '9999' },
                            { name: { full: 'Waiver Add Player' } },
                            { display_position: 'SP' },
                            { editorial_team_abbr: 'SD' },
                          ],
                          {
                            transaction_data: [
                              { type: 'add' },
                              { source_type: 'waivers' },
                              { destination_team_key: '449.l.123.t.6' },
                              { faab_bid: '11' },
                            ],
                          },
                        ],
                      },
                      1: {
                        player: [
                          [
                            { player_id: '8888' },
                            { name: { full: 'Waiver Drop Player' } },
                            { display_position: 'RP' },
                            { editorial_team_abbr: 'SEA' },
                          ],
                          {
                            transaction_data: [
                              { type: 'drop' },
                              { source_team_key: '449.l.123.t.6' },
                              { destination_type: 'waivers' },
                            ],
                          },
                        ],
                      },
                      count: 2,
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
      transaction_id: '449.l.123.tr.4',
      type: 'add',
      faab_bid: 11,
      team_ids: ['449.l.123.t.6'],
    });
    expect(normalized[0].players_added).toEqual([
      { id: '9999', name: 'Waiver Add Player', position: 'SP', team: 'SD' },
    ]);
    expect(normalized[0].players_dropped).toEqual([
      { id: '8888', name: 'Waiver Drop Player', position: 'RP', team: 'SEA' },
    ]);
  });

  it('extracts team attribution for standalone adds', () => {
    const raw = {
      fantasy_content: {
        league: [
          { league_key: '449.l.123' },
          {
            transactions: {
              0: {
                transaction: [
                  { transaction_key: '449.l.123.tr.7' },
                  { type: 'add' },
                  { status: 'successful' },
                  { timestamp: '1700000000' },
                  {
                    players: {
                      0: {
                        player: [
                          [{ player_id: '7777' }, { name: { full: 'Standalone Add' } }],
                          { transaction_data: { type: 'add', destination_team_key: '449.l.123.t.3' } },
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
      transaction_id: '449.l.123.tr.7',
      type: 'add',
      team_ids: ['449.l.123.t.3'],
    });
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
