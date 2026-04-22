export {
  getDefaultSeasonYear,
  getSeasonLabel,
  isCurrentSeason,
  toCanonicalYear,
  toPlatformYear,
} from '@flaim/worker-shared';
export type { SeasonSport } from '@flaim/worker-shared';

import { getDefaultSeasonYear } from '@flaim/worker-shared';
import type { SeasonSport } from '@flaim/worker-shared';

export function getPreviousSeasonYear(sport: SeasonSport, now = new Date()): number {
  return getDefaultSeasonYear(sport, now) - 1;
}

export function getSeasonYearOptions(
  sport: SeasonSport,
  minYear = 2000,
  now = new Date()
): number[] {
  const currentSeasonYear = getDefaultSeasonYear(sport, now);
  return Array.from({ length: currentSeasonYear - minYear + 1 }, (_, index) => currentSeasonYear - index);
}
