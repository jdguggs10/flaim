import type { EspnSeasonContext, RoutedToolParams, ToolParams } from '../types';
import {
  getDefaultSeasonYear as sharedGetDefaultSeasonYear,
  toCanonicalYear as sharedToCanonicalYear,
  toPlatformYear as sharedToPlatformYear,
} from '@flaim/worker-shared';

type SeasonSport = Parameters<typeof sharedGetDefaultSeasonYear>[0];

/**
 * Season Year Translation for ESPN
 *
 * Flaim stores canonical start-year (e.g., 2024 for the 2024-25 NBA season).
 * ESPN's API expects end-year for basketball/hockey (e.g., 2025).
 * This function converts canonical → ESPN-native.
 *
 * `/execute` computes this once and attaches it to the internal `seasonContext`.
 */
export function toEspnSeasonYear(canonicalYear: number, sport: SeasonSport): number {
  return sharedToPlatformYear(canonicalYear, sport, 'espn');
}

/** Inverse of toEspnSeasonYear — converts ESPN-native year back to canonical start year. */
export function fromEspnSeasonYear(espnYear: number, sport: SeasonSport): number {
  return sharedToCanonicalYear(espnYear, sport, 'espn');
}

export function normalizeEspnLeagueStatus(status: unknown, sport: SeasonSport): unknown {
  if (!status || typeof status !== 'object') {
    return status;
  }

  const statusRecord = status as Record<string, unknown>;
  const previousSeasons = Array.isArray(statusRecord.previousSeasons)
    ? statusRecord.previousSeasons.map((season) =>
        typeof season === 'number' ? sharedToCanonicalYear(season, sport, 'espn') : season
      )
    : statusRecord.previousSeasons;

  return {
    ...statusRecord,
    previousSeasons,
  };
}

export function createSeasonContext(canonicalYear: number, sport: SeasonSport): EspnSeasonContext {
  return {
    canonicalYear,
    espnYear: toEspnSeasonYear(canonicalYear, sport),
  };
}

export function withSeasonContext(params: ToolParams): RoutedToolParams {
  return {
    ...params,
    seasonContext: createSeasonContext(params.season_year, params.sport),
  };
}

export function getSeasonContext(params: RoutedToolParams): EspnSeasonContext {
  if (!params.seasonContext) {
    throw new Error(
      'Missing seasonContext for routed handler params. Call handlers through /execute or wrap test params with withSeasonContext().'
    );
  }
  return params.seasonContext;
}

/**
 * Returns the canonical start-year of the current season for a sport,
 * using America/New_York time. Cross-calendar sports (basketball, hockey)
 * stay on the prior year until August, so January 2026 correctly returns
 * 2025 for football and 2025 for basketball/hockey until rollover.
 */
export function getCurrentSeasonYear(sport: SeasonSport, now = new Date()): number {
  return sharedGetDefaultSeasonYear(sport, now);
}
