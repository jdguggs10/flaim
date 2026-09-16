import type { EspnPlayerStat } from '../types';

/**
 * All three fields are null whenever the season entry carries no applied
 * totals. ESPN omits appliedTotal/appliedAverage when it applies no points
 * scoring to an entry — observed on every baseball entry, where category and
 * rotisserie leagues are the norm — so null is an expected state, not an error.
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
 * explicitly rather than taken by list position. The composite `id` encodes
 * source and split together and is present on every observed entry; the
 * explicit field match is a fallback for an entry that omits `id`. An entry
 * with neither is not a season split we can identify, so it is skipped.
 */
function selectSeasonEntry(
  stats: EspnPlayerStat[],
  seasonId: number,
  statSourceId: number
): EspnPlayerStat | undefined {
  const seasonEntryId = `${statSourceId}${SEASON_SPLIT_TYPE_ID}${seasonId}`;
  return (
    stats.find((entry) => entry?.id === seasonEntryId) ??
    stats.find(
      (entry) =>
        entry?.seasonId === seasonId &&
        entry?.statSourceId === statSourceId &&
        entry?.statSplitTypeId === SEASON_SPLIT_TYPE_ID
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
