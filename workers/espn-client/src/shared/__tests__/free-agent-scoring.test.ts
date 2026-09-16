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
