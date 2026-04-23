/**
 * Browser-safe entry point for @flaim/worker-shared.
 *
 * Re-exports only the symbols that are safe to import from environments
 * without Cloudflare Workers types (notably the Next.js web app). The main
 * `index.ts` transitively pulls in `types.ts`, which references Cloudflare's
 * `Fetcher` type and trips TypeScript in the web project.
 *
 * Web's `tsconfig.json` aliases `@flaim/worker-shared` to this file. Extend
 * this entry when you need to expose additional browser-safe symbols rather
 * than editing the alias.
 *
 * Imports here intentionally omit the `.js` extension: web's Next.js webpack
 * resolves this file at bundle time via the tsconfig path alias, and webpack
 * cannot remap explicit `.js` specifiers to `.ts` sources. Workers-side
 * `tsconfig.json` uses `moduleResolution: bundler`, which also accepts the
 * extension-less form, so both consumers stay happy.
 */
export { isValidRedirectUri } from './oauth-redirect';
export {
  getDefaultSeasonYear,
  isCurrentSeason,
  toCanonicalYear,
  toPlatformYear,
  getSeasonLabel,
} from './season';
export type { SeasonSport } from './season';
