/**
 * Season Year Translation for ESPN
 *
 * Flaim stores canonical start-year (e.g., 2024 for the 2024-25 NBA season).
 * ESPN's API expects end-year for basketball/hockey (e.g., 2025).
 * This function converts canonical → ESPN-native.
 *
 * Called by index.ts at the /execute boundary — handlers receive ESPN year, not canonical.
 * Use fromEspnSeasonYear() inside handlers when canonical year is needed (e.g., seasonPhase
 * comparisons, response echoes).
 */
export function toEspnSeasonYear(canonicalYear: number, sport: string): number {
  if (sport === 'basketball' || sport === 'hockey') {
    return canonicalYear + 1;
  }
  return canonicalYear;
}

/** Inverse of toEspnSeasonYear — converts ESPN-native year back to canonical start year. */
export function fromEspnSeasonYear(espnYear: number, sport: string): number {
  if (sport === 'basketball' || sport === 'hockey') {
    return espnYear - 1;
  }
  return espnYear;
}

/**
 * Month (1-indexed) when each sport's season year rolls over to the next season.
 * Before this month: the current season is the previous year.
 * Mirrors the canonical rollover rules in workers/auth-worker/src/season-utils.ts.
 */
const SEASON_ROLLOVER_MONTH: Record<string, number> = {
  baseball: 2,    // Feb 1 — ~10 weeks before Opening Day
  football: 7,    // Jul 1 — ~10 weeks before NFL kickoff
  basketball: 8,  // Aug 1 — ~10 weeks before NBA opening night
  hockey: 8,      // Aug 1 — ~10 weeks before NHL opening night
};

/**
 * Returns the canonical start-year of the current season for a sport,
 * using America/New_York time. Cross-calendar sports (basketball, hockey)
 * stay on the prior year until August, so January 2026 correctly returns
 * 2025 for football and 2025 for basketball/hockey until rollover.
 */
export function getCurrentSeasonYear(sport: string, now = new Date()): number {
  const ny = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);

  const year = Number(ny.find((p) => p.type === 'year')?.value);
  const month = Number(ny.find((p) => p.type === 'month')?.value);
  const rollover = SEASON_ROLLOVER_MONTH[sport] ?? 1;
  return month < rollover ? year - 1 : year;
}
