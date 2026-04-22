/**
 * Backward-compatible auth-worker wrapper for shared season helpers.
 *
 * The actual implementation lives in `@flaim/worker-shared` so browser-safe
 * and worker-safe consumers share the same source of truth.
 */
export {
  getDefaultSeasonYear,
  isCurrentSeason,
  toCanonicalYear,
  toPlatformYear,
  getSeasonLabel,
} from '@flaim/worker-shared';
export type { SeasonSport } from '@flaim/worker-shared';
