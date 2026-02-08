/**
 * Season Year Utilities for Auth Worker
 *
 * Provides deterministic season year calculation based on sport and date.
 * Uses America/New_York timezone for consistency with ESPN fantasy seasons.
 *
 * Canonical form: season_year always stores the START year of the season.
 * Historical rationale: docs/archive/season-year-problem.md.
 *
 * Rollover rules (when the "current season" flips to next year):
 * - Baseball: Feb 1 (~10 weeks before Opening Day late March)
 * - Football: Jul 1 (~10 weeks before NFL kickoff early September)
 * - Basketball: Aug 1 (~10 weeks before NBA opening night late October)
 * - Hockey: Aug 1 (~10 weeks before NHL opening night early October)
 */

export type SeasonSport = 'baseball' | 'football' | 'basketball' | 'hockey';

/**
 * Month when each sport's season year rolls over (1-indexed).
 * Before this month: use previous year. On/after: use current year.
 */
const ROLLOVER_MONTHS: Record<SeasonSport, number> = {
  baseball: 2,    // Feb 1
  football: 7,    // Jul 1
  basketball: 8,  // Aug 1
  hockey: 8,      // Aug 1
};

/**
 * Calculate the default season year for a sport based on the current date.
 *
 * @param sport - The sport type
 * @param now - Optional date to use (defaults to current time)
 * @returns The season year (e.g., 2025)
 *
 * @example
 * // On Jan 4, 2026:
 * getDefaultSeasonYear('baseball') // => 2025 (before Feb 1)
 * getDefaultSeasonYear('football') // => 2025 (before Jun 1)
 *
 * // On Feb 1, 2026:
 * getDefaultSeasonYear('baseball') // => 2026
 *
 * // On Jun 1, 2026:
 * getDefaultSeasonYear('football') // => 2026
 */
export function getDefaultSeasonYear(sport: SeasonSport, now = new Date()): number {
  // Use Intl.DateTimeFormat to get date parts in America/New_York timezone
  const ny = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);

  const year = Number(ny.find((p) => p.type === 'year')?.value);
  const month = Number(ny.find((p) => p.type === 'month')?.value);

  const rolloverMonth = ROLLOVER_MONTHS[sport] || 1;
  return month < rolloverMonth ? year - 1 : year;
}

/**
 * Check if a given season year is the "current" season for a sport.
 * Used to filter leagues for the default dropdown.
 *
 * @param sport - The sport type
 * @param seasonYear - The season year to check
 * @param now - Optional date to use (defaults to current time)
 * @returns True if this is the current season for the sport
 */
export function isCurrentSeason(sport: SeasonSport, seasonYear: number, now = new Date()): boolean {
  const currentSeason = getDefaultSeasonYear(sport, now);
  return seasonYear === currentSeason;
}

/**
 * Normalize a platform-specific season year to Flaim's canonical form (start year).
 *
 * ESPN uses the END year for NBA/NHL (e.g., 2025 for the 2024-25 season).
 * All other platform/sport combinations already use the start year.
 */
export function toCanonicalYear(platformYear: number, sport: string, platform: string): number {
  if ((sport === 'basketball' || sport === 'hockey') && platform === 'espn') {
    return platformYear - 1;
  }
  return platformYear;
}

/**
 * Convert Flaim's canonical season year (start year) to a platform-native value.
 *
 * ESPN expects the END year for NBA/NHL (e.g., 2025 for the 2024-25 season).
 * All other platform/sport combinations expect the start year as-is.
 */
export function toPlatformYear(canonicalYear: number, sport: string, platform: string): number {
  if ((sport === 'basketball' || sport === 'hockey') && platform === 'espn') {
    return canonicalYear + 1;
  }
  return canonicalYear;
}

/**
 * Get a human-readable season label from a canonical start year.
 *
 * Cross-year sports (basketball, hockey) return "2024-25" format.
 * Single-year sports (baseball) and football return "2025" format.
 */
export function getSeasonLabel(canonicalYear: number, sport: string): string {
  if (sport === 'basketball' || sport === 'hockey') {
    return `${canonicalYear}-${String(canonicalYear + 1).slice(2)}`;
  }
  return String(canonicalYear);
}
