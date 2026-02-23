export function buildYahooTransactionsFixture(nowMs: number): unknown {
  const nowSeconds = Math.floor(nowMs / 1000);
  const oneDayAgo = nowSeconds - (24 * 60 * 60);
  const twentyDaysAgo = nowSeconds - (20 * 24 * 60 * 60);

  return {
    fantasy_content: {
      league: [
        { league_key: '449.l.123' },
        {
          transactions: {
            0: {
              transaction: [
                { transaction_key: '449.l.123.tr.recent-add' },
                { type: 'add' },
                { status: 'successful' },
                { timestamp: String(oneDayAgo) },
                {
                  players: {
                    0: {
                      player: [
                        [{ player_id: '12' }, { name: { full: 'Recent Add Player' } }],
                        { transaction_data: { type: 'add', source_type: 'waivers', faab_bid: '12' } },
                      ],
                    },
                    count: 1,
                  },
                },
              ],
            },
            1: {
              transaction: [
                { transaction_key: '449.l.123.tr.old-trade' },
                { type: 'trade' },
                { status: 'successful' },
                { timestamp: String(twentyDaysAgo) },
              ],
            },
            2: {
              transaction: [
                { transaction_key: '449.l.123.tr.missing-ts' },
                { type: 'add' },
                { status: 'successful' },
                {
                  players: {
                    0: {
                      player: [
                        [{ player_id: '44' }, { name: { full: 'Missing Timestamp Player' } }],
                        { transaction_data: { type: 'add' } },
                      ],
                    },
                    count: 1,
                  },
                },
              ],
            },
            count: 3,
          },
        },
      ],
    },
  };
}
