import type { EspnPlayerStat } from '../types';

export interface FreeAgentScoring {
  /** Fantasy points scored so far this season; null when ESPN reports none. */
  seasonPoints: number | null;
  /** ESPN's own per-game average for the season; null when ESPN reports none. */
  pointsPerGame: number | null;
  /** ESPN's projected full-season fantasy points; null when ESPN reports none. */
  projectedSeasonPoints: number | null;
}

const SEASON_SPLIT_TYPE_ID = 0;
const ACTUAL_STAT_SOURCE_ID = 0;
const PROJECTED_STAT_SOURCE_ID = 1;

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * ESPN returns several splits per season (season total, single scoring period,
 * recent-window rollups) in no guaranteed order, so the season split is pinned
 * explicitly. Entries that omit statSplitTypeId fall back to the scoring period
 * ESPN uses for season totals rather than to list position.
 */
function selectSeasonEntry(
  stats: EspnPlayerStat[],
  seasonId: number,
  statSourceId: number
): EspnPlayerStat | undefined {
  const candidates = stats.filter(
    (entry) => entry?.seasonId === seasonId && entry?.statSourceId === statSourceId
  );
  return (
    candidates.find((entry) => entry.statSplitTypeId === SEASON_SPLIT_TYPE_ID) ??
    candidates.find(
      (entry) =>
        entry.statSplitTypeId === undefined &&
        (entry.scoringPeriodId === undefined || entry.scoringPeriodId === 0)
    )
  );
}

export function summarizeFreeAgentScoring(
  stats: EspnPlayerStat[] | undefined,
  seasonId: number
): FreeAgentScoring {
  const entries = Array.isArray(stats) ? stats : [];
  if (!Number.isFinite(seasonId)) {
    return { seasonPoints: null, pointsPerGame: null, projectedSeasonPoints: null };
  }

  const actual = selectSeasonEntry(entries, seasonId, ACTUAL_STAT_SOURCE_ID);
  const projected = selectSeasonEntry(entries, seasonId, PROJECTED_STAT_SOURCE_ID);

  return {
    seasonPoints: finiteOrNull(actual?.appliedTotal),
    pointsPerGame: finiteOrNull(actual?.appliedAverage),
    projectedSeasonPoints: finiteOrNull(projected?.appliedTotal),
  };
}
