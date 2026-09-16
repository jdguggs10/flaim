import type { EspnPlayerStat } from '../types';

/**
 * All three fields are null whenever ESPN applies no fantasy scoring to the
 * stat entry. That is not only a missing-data case: ESPN carries appliedTotal
 * and appliedAverage on football stat entries but omits them entirely on
 * baseball ones, because a category or rotisserie league has no single fantasy
 * points number to report. Callers must treat null as "this league does not
 * score in points", not as an error.
 */
export interface FreeAgentScoring {
  /** Fantasy points scored so far this season; null when ESPN applies none. */
  seasonPoints: number | null;
  /** ESPN's own per-game average for the season; null when ESPN applies none. */
  pointsPerGame: number | null;
  /** ESPN's projected full-season fantasy points; null when ESPN applies none. */
  projectedSeasonPoints: number | null;
}

const SEASON_SPLIT_TYPE_ID = 0;
const ACTUAL_STAT_SOURCE_ID = 0;
const PROJECTED_STAT_SOURCE_ID = 1;

/**
 * ESPN reports applied totals and averages as raw floats carrying the full
 * accumulated error of its own arithmetic (0.30000000000000004,
 * 100.33867256000001). Two decimals is past the precision any fantasy site
 * displays, so the noise is rounded off before the value leaves the worker.
 * A legitimate 0 stays 0; a missing or non-finite value stays null.
 */
function finiteOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

/**
 * ESPN returns several splits per season (season total, single scoring period,
 * recent-window rollups) in no guaranteed order, so the season split is pinned
 * explicitly rather than taken by list position.
 *
 * The composite `id` is the primary key because it is the one field observed on
 * every entry of every response, and it encodes source and split together, so a
 * single equality check cannot land on a weekly or recent-window rollup. The
 * field triple is kept as a fallback for entries that omit `id`, and entries
 * that also omit statSplitTypeId fall back to the scoring period ESPN uses for
 * season totals.
 */
function selectSeasonEntry(
  stats: EspnPlayerStat[],
  seasonId: number,
  statSourceId: number
): EspnPlayerStat | undefined {
  const seasonEntryId = `${statSourceId}${SEASON_SPLIT_TYPE_ID}${seasonId}`;
  const byId = stats.find((entry) => entry?.id === seasonEntryId);
  if (byId) return byId;

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

/**
 * The raw per-stat map of the same pinned actual-season entry that
 * `summarizeFreeAgentScoring` derives its scalars from.
 *
 * Sports whose leagues ESPN often does not score in points (baseball, and some
 * basketball and hockey leagues) get all-null scalars, so they still ship this
 * dictionary as their only free-agent performance signal. Reusing
 * `selectSeasonEntry` keeps that dictionary on the deterministic season split
 * rather than whichever entry happens to be listed first.
 */
export function selectActualSeasonStats(
  stats: EspnPlayerStat[] | undefined,
  seasonId: number
): Record<string, number> | undefined {
  const entries = Array.isArray(stats) ? stats : [];
  if (!Number.isFinite(seasonId)) return undefined;

  return selectSeasonEntry(entries, seasonId, ACTUAL_STAT_SOURCE_ID)?.stats;
}
