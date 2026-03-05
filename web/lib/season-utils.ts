type SeasonSport = 'baseball' | 'football' | 'basketball' | 'hockey';

const ROLLOVER_MONTHS: Record<SeasonSport, number> = {
  baseball: 2,    // Feb 1
  football: 7,    // Jul 1
  basketball: 8,  // Aug 1
  hockey: 8,      // Aug 1
};

/**
 * Returns the current season year for a sport using America/New_York time.
 * Mirrors the canonical logic in workers/auth-worker/src/season-utils.ts.
 * Always returns the START year of the season.
 */
export function getDefaultSeasonYear(sport: SeasonSport, now = new Date()): number {
  const ny = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);

  const year = Number(ny.find((p) => p.type === 'year')?.value);
  const month = Number(ny.find((p) => p.type === 'month')?.value);

  const rolloverMonth = ROLLOVER_MONTHS[sport] ?? 1;
  return month < rolloverMonth ? year - 1 : year;
}
