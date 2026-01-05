/**
 * Season Year Utilities
 *
 * Provides deterministic season year calculation based on sport and date.
 * Uses America/New_York timezone for consistency with ESPN fantasy seasons.
 *
 * Rollover rules:
 * - Baseball: defaults to previous year until Feb 1, then current year
 * - Football: defaults to previous year until Jun 1, then current year
 */

export type SeasonSport = 'baseball' | 'football';

/**
 * Month when each sport's season year rolls over (1-indexed).
 * Before this month: use previous year. On/after: use current year.
 */
const ROLLOVER_MONTHS: Record<SeasonSport, number> = {
  baseball: 2, // Feb 1
  football: 6, // Jun 1
};

/**
 * Calculate the default season year for a sport based on the current date.
 *
 * @param sport - The sport type ('baseball' or 'football')
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
 * Get the rollover date description for a sport (for UI display).
 *
 * @param sport - The sport type
 * @returns Human-readable description of when the season year changes
 */
export function getSeasonRolloverDescription(sport: SeasonSport): string {
  switch (sport) {
    case 'baseball':
      return 'Defaults to last season until Feb 1';
    case 'football':
      return 'Defaults to last season until Jun 1';
    default:
      return '';
  }
}
