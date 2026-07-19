// workers/espn-client/src/shared/scoring-period.ts
//
// Resolves a calendar date to an ESPN scoringPeriodId for daily sports
// (baseball/basketball/hockey), where one scoring period == one Eastern-time
// calendar day. The mapping is derived from the public proTeamSchedules_wl
// season calendar and validated as a constant day-offset across every
// game-bearing period; resolution is then pure arithmetic, so off-days
// (e.g. the All-Star break) resolve without a game entry. Any invariant
// violation fails closed rather than guessing.
import { espnFetch, handleEspnError } from './espn-api';
import { ErrorCode } from '@flaim/worker-shared';

interface ScoringPeriodAnchor {
  /** dayIndex(ET date of a period's games) − scoringPeriodId; constant per season. */
  epochDayOffset: number;
  firstScoringPeriod: number;
  lastScoringPeriod: number;
}

interface ProTeamSchedulesResponse {
  settings?: {
    proTeams?: Array<{
      proGamesByScoringPeriod?: Record<string, Array<{ date?: number }>>;
    }>;
  };
}

const ET_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function etDateOf(epochMs: number): string {
  return ET_DATE_FORMAT.format(new Date(epochMs));
}

function dayIndexOf(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

function dateOfDayIndex(dayIndex: number): string {
  return new Date(dayIndex * 86_400_000).toISOString().slice(0, 10);
}

// Anchors are cached for the isolate's lifetime by design: the day↔period
// mapping is calendar-structural (a rescheduled game moves between periods;
// it does not move a period's calendar date), so a season's anchor does not
// go stale. Promises are cached so concurrent cold-isolate misses share one
// calendar fetch; failed builds are evicted so later requests can retry.
const anchorCache = new Map<string, Promise<ScoringPeriodAnchor>>();

/** Test hook: clear the per-isolate anchor cache. */
export function clearScoringPeriodAnchorCache(): void {
  anchorCache.clear();
}

async function buildAnchor(gameId: string, espnYear: number): Promise<ScoringPeriodAnchor> {
  const response = await espnFetch(
    `/seasons/${espnYear}?view=proTeamSchedules_wl`,
    gameId,
    { timeout: 10000 }
  );
  if (!response.ok) {
    handleEspnError(response);
  }

  const data = await response.json() as ProTeamSchedulesResponse;
  const proTeams = data.settings?.proTeams ?? [];

  const periodDates = new Map<number, Set<string>>();
  for (const team of proTeams) {
    for (const [periodKey, games] of Object.entries(team.proGamesByScoringPeriod ?? {})) {
      const period = Number(periodKey);
      if (!Number.isInteger(period) || !Array.isArray(games)) continue;
      for (const game of games) {
        if (typeof game.date !== 'number') continue;
        let dates = periodDates.get(period);
        if (!dates) {
          dates = new Set<string>();
          periodDates.set(period, dates);
        }
        dates.add(etDateOf(game.date));
      }
    }
  }

  if (periodDates.size === 0) {
    throw new Error(
      `${ErrorCode.ESPN_INVALID_RESPONSE}: ESPN season calendar for ${gameId} ${espnYear} contained no scoring-period games; cannot resolve dates to scoring periods`
    );
  }

  let epochDayOffset: number | undefined;
  let firstScoringPeriod = Number.POSITIVE_INFINITY;
  let lastScoringPeriod = Number.NEGATIVE_INFINITY;

  for (const [period, dates] of periodDates) {
    if (dates.size > 1) {
      throw new Error(
        `${ErrorCode.ESPN_INVALID_RESPONSE}: ESPN scoring period ${period} for ${gameId} ${espnYear} spans multiple calendar dates (${[...dates].sort().join(', ')}); the one-day/one-period invariant does not hold`
      );
    }
    const offset = dayIndexOf([...dates][0]) - period;
    if (epochDayOffset === undefined) {
      epochDayOffset = offset;
    } else if (offset !== epochDayOffset) {
      throw new Error(
        `${ErrorCode.ESPN_INVALID_RESPONSE}: ESPN season calendar for ${gameId} ${espnYear} violates the constant day-offset invariant at scoring period ${period}; refusing to resolve dates to scoring periods`
      );
    }
    firstScoringPeriod = Math.min(firstScoringPeriod, period);
    lastScoringPeriod = Math.max(lastScoringPeriod, period);
  }

  return { epochDayOffset: epochDayOffset as number, firstScoringPeriod, lastScoringPeriod };
}

/**
 * Resolve a calendar-valid YYYY-MM-DD date (ET) to the scoringPeriodId for a
 * daily sport's season. Out-of-season dates throw a corrective
 * INVALID_ROSTER_SNAPSHOT_SELECTOR error with the season's date range.
 */
export async function resolveScoringPeriodForDate(
  gameId: string,
  espnYear: number,
  date: string
): Promise<{ scoringPeriodId: number }> {
  const cacheKey = `${gameId}:${espnYear}`;
  let anchorPromise = anchorCache.get(cacheKey);
  if (!anchorPromise) {
    anchorPromise = buildAnchor(gameId, espnYear).catch((error) => {
      anchorCache.delete(cacheKey);
      throw error;
    });
    anchorCache.set(cacheKey, anchorPromise);
  }
  const anchor = await anchorPromise;

  const scoringPeriodId = dayIndexOf(date) - anchor.epochDayOffset;
  if (scoringPeriodId < anchor.firstScoringPeriod || scoringPeriodId > anchor.lastScoringPeriod) {
    const firstDate = dateOfDayIndex(anchor.firstScoringPeriod + anchor.epochDayOffset);
    const lastDate = dateOfDayIndex(anchor.lastScoringPeriod + anchor.epochDayOffset);
    throw new Error(
      `${ErrorCode.INVALID_ROSTER_SNAPSHOT_SELECTOR}: as_of_date ${date} is outside this season (${firstDate} through ${lastDate}). Pass a date within the season, or omit both selectors for the current roster.`
    );
  }

  return { scoringPeriodId };
}
