/**
 * Season helpers shared across Flaim workers.
 *
 * Canonical season years always use the START year of the season.
 * Rollover dates use America/New_York so current-season behavior is stable
 * regardless of where the worker runs.
 */

export type SeasonSport = 'baseball' | 'football' | 'basketball' | 'hockey';

const ROLLOVER_MONTHS: Record<SeasonSport, number> = {
  baseball: 2, // Feb 1
  football: 7, // Jul 1
  basketball: 8, // Aug 1
  hockey: 8, // Aug 1
};

const CROSS_YEAR_SPORTS = new Set<SeasonSport>(['basketball', 'hockey']);

function getNewYorkDateParts(now: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);

  const yearPart = parts.find((part) => part.type === 'year')?.value;
  const monthPart = parts.find((part) => part.type === 'month')?.value;

  const year = Number(yearPart);
  const month = Number(monthPart);

  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    throw new Error('Unable to determine America/New_York calendar date');
  }

  return { year, month };
}

function isCrossYearSport(sport: SeasonSport): boolean {
  return CROSS_YEAR_SPORTS.has(sport);
}

/**
 * Return the canonical season year for the provided sport and date.
 */
export function getDefaultSeasonYear(sport: SeasonSport, now = new Date()): number {
  const { year, month } = getNewYorkDateParts(now);
  const rolloverMonth = ROLLOVER_MONTHS[sport];
  return month < rolloverMonth ? year - 1 : year;
}

/**
 * Check whether a season year matches the current canonical season.
 */
export function isCurrentSeason(sport: SeasonSport, seasonYear: number, now = new Date()): boolean {
  return seasonYear === getDefaultSeasonYear(sport, now);
}

/**
 * Convert a platform-native season year to Flaim's canonical start year.
 */
export function toCanonicalYear(platformYear: number, sport: SeasonSport, platform: string): number {
  if (platform === 'espn' && isCrossYearSport(sport)) {
    return platformYear - 1;
  }

  return platformYear;
}

/**
 * Convert a canonical start year to the platform-native season year.
 */
export function toPlatformYear(canonicalYear: number, sport: SeasonSport, platform: string): number {
  if (platform === 'espn' && isCrossYearSport(sport)) {
    return canonicalYear + 1;
  }

  return canonicalYear;
}

/**
 * Format a canonical start year for display.
 */
export function getSeasonLabel(canonicalYear: number, sport: SeasonSport): string {
  if (isCrossYearSport(sport)) {
    return `${canonicalYear}-${String(canonicalYear + 1).slice(2)}`;
  }

  return String(canonicalYear);
}
