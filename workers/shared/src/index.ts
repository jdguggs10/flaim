/**
 * @flaim/worker-shared
 *
 * Shared utilities for Flaim Cloudflare Workers
 */

// Types
export type {
  BaseEnvWithAuth,
  EspnCredentials,
  LeagueConfig,
  CorsOptions,
} from './types.js';

// CORS utilities
export {
  createCorsHeaders,
  handleCorsPreflightResponse,
  isCorsPreflightRequest,
} from './cors.js';

// URL utilities
export {
  stripPrefix,
  getPathname,
} from './prefix-strip.js';

// Auth-worker fetch helper
export { authWorkerFetch } from './auth-fetch.js';
