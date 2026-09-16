import { describe, expect, it } from 'vitest';
import { summarizeFreeAgentScoring } from '../free-agent-scoring';
import type { EspnPlayerStat } from '../../types';

const SEASON_ID = 2024;

describe('summarizeFreeAgentScoring', () => {
  it('selects the season actual/projected entries even when weekly entries are listed first, and is order-independent', () => {
    const weeklyActual: EspnPlayerStat = {
      seasonId: SEASON_ID,
      statSourceId: 0,
      statSplitTypeId: 1,
      scoringPeriodId: 7,
      appliedTotal: 999,
      appliedAverage: 999,
    };
    const seasonActual: EspnPlayerStat = {
      seasonId: SEASON_ID,
      statSourceId: 0,
      statSplitTypeId: 0,
      scoringPeriodId: 0,
      appliedTotal: 150.5,
      appliedAverage: 15.05,
    };
    const weeklyProjected: EspnPlayerStat = {
      seasonId: SEASON_ID,
      statSourceId: 1,
      statSplitTypeId: 1,
      scoringPeriodId: 7,
      appliedTotal: 888,
      appliedAverage: 888,
    };
    const seasonProjected: EspnPlayerStat = {
      seasonId: SEASON_ID,
      statSourceId: 1,
      statSplitTypeId: 0,
      scoringPeriodId: 0,
      appliedTotal: 200.25,
      appliedAverage: 20.025,
    };

    const stats = [weeklyActual, seasonActual, weeklyProjected, seasonProjected];
    const expected = {
      seasonPoints: 150.5,
      pointsPerGame: 15.05,
      projectedSeasonPoints: 200.25,
    };

    expect(summarizeFreeAgentScoring(stats, SEASON_ID)).toEqual(expected);
    expect(summarizeFreeAgentScoring([...stats].reverse(), SEASON_ID)).toEqual(expected);
  });

  it('ignores season-split entries from a different seasonId even when they are the only season-split entries present', () => {
    const otherSeasonActual: EspnPlayerStat = {
      seasonId: SEASON_ID - 1,
      statSourceId: 0,
      statSplitTypeId: 0,
      scoringPeriodId: 0,
      appliedTotal: 150.5,
      appliedAverage: 15.05,
    };
    const otherSeasonProjected: EspnPlayerStat = {
      seasonId: SEASON_ID - 1,
      statSourceId: 1,
      statSplitTypeId: 0,
      scoringPeriodId: 0,
      appliedTotal: 200.25,
      appliedAverage: 20.025,
    };

    expect(summarizeFreeAgentScoring([otherSeasonActual, otherSeasonProjected], SEASON_ID)).toEqual({
      seasonPoints: null,
      pointsPerGame: null,
      projectedSeasonPoints: null,
    });
  });

  it('falls back to scoringPeriodId 0 (or absent) when statSplitTypeId is entirely absent, not to a weekly entry', () => {
    const legacySeasonActual: EspnPlayerStat = {
      seasonId: SEASON_ID,
      statSourceId: 0,
      scoringPeriodId: 0,
      appliedTotal: 150.5,
      appliedAverage: 15.05,
    };
    const legacyWeeklyActual: EspnPlayerStat = {
      seasonId: SEASON_ID,
      statSourceId: 0,
      scoringPeriodId: 7,
      appliedTotal: 999,
      appliedAverage: 999,
    };

    expect(summarizeFreeAgentScoring([legacyWeeklyActual, legacySeasonActual], SEASON_ID)).toEqual({
      seasonPoints: 150.5,
      pointsPerGame: 15.05,
      projectedSeasonPoints: null,
    });

    const legacySeasonActualNoScoringPeriod: EspnPlayerStat = {
      seasonId: SEASON_ID,
      statSourceId: 0,
      appliedTotal: 75,
      appliedAverage: 7.5,
    };

    expect(
      summarizeFreeAgentScoring([legacyWeeklyActual, legacySeasonActualNoScoringPeriod], SEASON_ID)
    ).toEqual({
      seasonPoints: 75,
      pointsPerGame: 7.5,
      projectedSeasonPoints: null,
    });
  });

  it('yields null for missing/undefined/null appliedTotal and appliedAverage, and for non-finite values, without treating a real 0 as null', () => {
    const missingFields: EspnPlayerStat = {
      seasonId: SEASON_ID,
      statSourceId: 0,
      statSplitTypeId: 0,
      scoringPeriodId: 0,
    };
    expect(summarizeFreeAgentScoring([missingFields], SEASON_ID)).toEqual({
      seasonPoints: null,
      pointsPerGame: null,
      projectedSeasonPoints: null,
    });

    const explicitNulls: EspnPlayerStat = {
      seasonId: SEASON_ID,
      statSourceId: 0,
      statSplitTypeId: 0,
      scoringPeriodId: 0,
      appliedTotal: null,
      appliedAverage: null,
    };
    expect(summarizeFreeAgentScoring([explicitNulls], SEASON_ID)).toEqual({
      seasonPoints: null,
      pointsPerGame: null,
      projectedSeasonPoints: null,
    });

    const nonFinite: EspnPlayerStat = {
      seasonId: SEASON_ID,
      statSourceId: 0,
      statSplitTypeId: 0,
      scoringPeriodId: 0,
      appliedTotal: Number.NaN,
      appliedAverage: Number.POSITIVE_INFINITY,
    };
    expect(summarizeFreeAgentScoring([nonFinite], SEASON_ID)).toEqual({
      seasonPoints: null,
      pointsPerGame: null,
      projectedSeasonPoints: null,
    });

    const zeroValues: EspnPlayerStat = {
      seasonId: SEASON_ID,
      statSourceId: 0,
      statSplitTypeId: 0,
      scoringPeriodId: 0,
      appliedTotal: 0,
      appliedAverage: 0,
    };
    expect(summarizeFreeAgentScoring([zeroValues], SEASON_ID)).toEqual({
      seasonPoints: 0,
      pointsPerGame: 0,
      projectedSeasonPoints: null,
    });
  });

  /**
   * The fixtures above are hand-built. These two mirror entries copied from
   * live ESPN responses (games/{game}/seasons/2026/players?view=kona_player_info,
   * the same view the free-agent handler requests), because the hand-built ones
   * all assumed applied totals are present and so could not catch a sport that
   * omits them.
   */
  describe('live ESPN entry shapes', () => {
    const LIVE_SEASON = 2026;

    it('reads the season and projected totals from real football entries, selecting them by composite id', () => {
      // Football entries do carry applied totals; the weekly splits that sort
      // ahead of the season ones must not be picked up.
      const stats: EspnPlayerStat[] = [
        {
          id: '11202613',
          externalId: '202613',
          seasonId: 2026,
          statSourceId: 1,
          statSplitTypeId: 1,
          scoringPeriodId: 13,
          stats: { '93': 0.000283, '94': 0.003531662 },
        },
        {
          id: '1120261',
          externalId: '20261',
          seasonId: 2026,
          statSourceId: 1,
          statSplitTypeId: 1,
          scoringPeriodId: 1,
          appliedTotal: 0.66485046,
          stats: { '93': 0.0000632 },
        },
        {
          id: '102026',
          externalId: '2026',
          seasonId: 2026,
          statSourceId: 1,
          statSplitTypeId: 0,
          scoringPeriodId: 0,
          appliedTotal: 11.2629927,
          appliedAverage: 0.6625289821764706,
          stats: { '93': 0.00483 },
        },
        {
          id: '002026',
          externalId: '2026',
          seasonId: 2026,
          statSourceId: 0,
          statSplitTypeId: 0,
          scoringPeriodId: 0,
          appliedTotal: 3.0,
          appliedAverage: 3.0,
          stats: { '53': 1 },
        },
        {
          id: '01401872930',
          externalId: '20261',
          seasonId: 2026,
          statSourceId: 0,
          statSplitTypeId: 1,
          scoringPeriodId: 1,
          appliedTotal: 3.0,
          stats: { '53': 1 },
        },
      ];

      expect(summarizeFreeAgentScoring(stats, LIVE_SEASON)).toEqual({
        seasonPoints: 3.0,
        pointsPerGame: 3.0,
        projectedSeasonPoints: 11.2629927,
      });
    });

    it('yields all-null for real baseball entries, which carry no applied totals at all', () => {
      // Regression guard for the shape that produced null for every live
      // baseball free agent: the season split is present and selectable
      // (id "002026", statSplitTypeId 0, scoringPeriodId 0) — ESPN simply
      // applies no fantasy points to it. Every stat entry in the live
      // baseball response looked like this, so no selection rule can
      // recover a number here.
      const stats: EspnPlayerStat[] = [
        {
          id: '002026',
          externalId: '2026',
          seasonId: 2026,
          statSourceId: 0,
          statSplitTypeId: 0,
          scoringPeriodId: 0,
          stats: { '0': 12, '1': 3 },
        },
        {
          id: '032026',
          externalId: '2026',
          seasonId: 2026,
          statSourceId: 0,
          statSplitTypeId: 3,
          scoringPeriodId: 0,
          stats: { '0': 4 },
        },
        {
          id: '012026',
          externalId: '2026',
          seasonId: 2026,
          statSourceId: 0,
          statSplitTypeId: 1,
          scoringPeriodId: 0,
          stats: { '0': 1 },
        },
        {
          id: '102026',
          externalId: '2026',
          seasonId: 2026,
          statSourceId: 1,
          statSplitTypeId: 0,
          scoringPeriodId: 0,
          stats: { '0': 500 },
        },
        {
          id: '002025',
          externalId: '2025',
          seasonId: 2025,
          statSourceId: 0,
          statSplitTypeId: 0,
          scoringPeriodId: 0,
          stats: { '0': 550 },
        },
      ];

      expect(summarizeFreeAgentScoring(stats, LIVE_SEASON)).toEqual({
        seasonPoints: null,
        pointsPerGame: null,
        projectedSeasonPoints: null,
      });
    });

    it('never selects a prior-season or single-period entry whose composite id shares the season digits', () => {
      // "0120264" (period 4 of 2026) and "002025" both contain "2026"/"2025"
      // digit runs; only the exact composite id may match.
      const stats: EspnPlayerStat[] = [
        {
          id: '002025',
          seasonId: 2025,
          statSourceId: 0,
          statSplitTypeId: 0,
          scoringPeriodId: 0,
          appliedTotal: 999,
          appliedAverage: 99,
        },
        {
          id: '0120264',
          seasonId: 2026,
          statSourceId: 0,
          statSplitTypeId: 1,
          scoringPeriodId: 4,
          appliedTotal: 888,
          appliedAverage: 88,
        },
      ];

      expect(summarizeFreeAgentScoring(stats, LIVE_SEASON)).toEqual({
        seasonPoints: null,
        pointsPerGame: null,
        projectedSeasonPoints: null,
      });
    });
  });

  it('returns all-null for undefined stats, an empty array, and an array with no matching entries', () => {
    const allNull = { seasonPoints: null, pointsPerGame: null, projectedSeasonPoints: null };

    expect(summarizeFreeAgentScoring(undefined, SEASON_ID)).toEqual(allNull);
    expect(summarizeFreeAgentScoring([], SEASON_ID)).toEqual(allNull);

    const noMatch: EspnPlayerStat = {
      seasonId: SEASON_ID,
      statSourceId: 2,
      statSplitTypeId: 0,
      scoringPeriodId: 0,
      appliedTotal: 50,
      appliedAverage: 5,
    };
    expect(summarizeFreeAgentScoring([noMatch], SEASON_ID)).toEqual(allNull);
  });
});
