/**
 * Sanitized mBoxscore shape captured from ESPN football. Values are synthetic
 * while preserving lineup IDs, nullability, zero and negative weekly scores.
 */
export function buildFootballMatchupPlayerDetailFixture() {
  return {
    teams: [
      { id: 11, location: 'Sample', nickname: 'Home' },
      { id: 22, name: 'Sample Away' },
    ],
    schedule: [
      {
        matchupPeriodId: 7,
        winner: 'HOME',
        home: {
          teamId: 11,
          totalPoints: 0,
          totalProjectedPointsLive: 0,
          pointsByScoringPeriod: { '7': 0 },
          rosterForCurrentScoringPeriod: {
            entries: [
              {
                playerId: 101,
                lineupSlotId: 0,
                playerPoolEntry: {
                  appliedStatTotal: 0,
                  player: { id: 101, fullName: 'Sample Starter' },
                },
              },
              {
                playerId: 102,
                lineupSlotId: 20,
                playerPoolEntry: {
                  appliedStatTotal: -1.5,
                  player: { id: 102, fullName: 'Sample Bench' },
                },
              },
              {
                playerId: 103,
                lineupSlotId: 7,
                playerPoolEntry: {
                  player: { id: 103, fullName: null },
                },
              },
            ],
          },
          // This shape is deliberately ignored. ESPN has returned it with
          // misleading lineup slots, so only current-scoring-period rows are
          // valid player-detail input.
          rosterForMatchupPeriod: {
            entries: [{ lineupSlotId: 0 }],
          },
        },
        away: {
          teamId: 22,
          totalPoints: 12.5,
          totalProjectedPoints: 11.25,
          rosterForCurrentScoringPeriod: {
            entries: [
              {
                playerId: 201,
                lineupSlotId: 21,
                playerPoolEntry: {
                  appliedStatTotal: 3,
                  player: { id: 201, fullName: 'Sample IR' },
                },
              },
            ],
          },
        },
      },
    ],
  };
}
