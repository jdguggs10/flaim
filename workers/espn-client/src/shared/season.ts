/**
 * Season Year Translation for ESPN
 *
 * Flaim stores canonical start-year (e.g., 2024 for the 2024-25 NBA season).
 * ESPN's API expects end-year for basketball/hockey (e.g., 2025).
 * This function converts canonical → ESPN-native.
 */
export function toEspnSeasonYear(canonicalYear: number, sport: string): number {
  if (sport === 'basketball' || sport === 'hockey') {
    return canonicalYear + 1;
  }
  return canonicalYear;
}
