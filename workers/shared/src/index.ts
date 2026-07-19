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
  createMcpCorsHeaders,
  handleMcpCorsPreflightResponse,
  createAuthWorkerCorsHeaders,
  handleAuthWorkerCorsPreflightResponse,
} from './cors.js';

// URL utilities
export {
  stripPrefix,
  getPathname,
} from './prefix-strip.js';

// HTTP utilities
export {
  YAHOO_DEFAULT_RATE_LIMIT_RETRY_AFTER_SECONDS,
  YAHOO_DEFAULT_TRANSIENT_RETRY_AFTER_SECONDS,
  YAHOO_REFRESH_IN_PROGRESS_RETRY_AFTER_SECONDS,
  classifyYahooApiFailure,
  defaultYahooRetryAfterSeconds,
  isYahooRateLimitStatus,
  isYahooTransientHttpStatus,
  parseRetryAfterSeconds,
  retryAfterSecondsFromHeaders,
} from './http.js';
export type {
  YahooApiFailureClassification,
  YahooApiFailureKind,
} from './http.js';

// Yahoo public API contract types
export type {
  YahooPublicAccessTokenState,
  YahooPublicCredentialHealth,
  YahooPublicRefreshState,
} from './yahoo.js';

// Season utilities
export {
  getDefaultSeasonYear,
  isCurrentSeason,
  toCanonicalYear,
  toPlatformYear,
  getSeasonLabel,
} from './season.js';
export type { SeasonSport } from './season.js';

// Roster snapshot contract (get_roster week / as_of_date selectors)
export {
  getRosterSelectorCapability,
  isCalendarValidDate,
  validateRosterSnapshotInput,
  resolveRosterSnapshotFromParams,
  rosterSnapshotUnsupportedError,
  malformedRosterSnapshotError,
  toSnapshotMetadata,
} from './roster-snapshot.js';
export type {
  RosterSnapshot,
  RosterSelectorCapability,
  RosterSnapshotValidation,
} from './roster-snapshot.js';

// Auth-worker fetch helper
export { authWorkerFetch } from './auth-fetch.js';

// Internal service auth utilities
export {
  INTERNAL_SERVICE_TOKEN_HEADER,
  hasValidInternalServiceToken,
  isProductionLikeEnvironment,
  requireInternalServiceToken,
  validateInternalService,
  withInternalServiceToken,
} from './internal-service.js';
export type { InternalServiceResult } from './internal-service.js';

// Error utilities
export { ErrorCode, YahooAuthWorkerErrorCode, extractErrorCode } from './errors.js';
export type { ErrorCodeValue, YahooAuthWorkerErrorCodeValue, ExecuteResponse } from './errors.js';

// Logging
export { logEvalEvent, logSetupSignal } from './logging.js';
export type { SetupSignalEvent, TraceLogEvent } from './logging.js';

// Tracing utilities
export {
  CORRELATION_ID_HEADER,
  EVAL_RUN_HEADER,
  EVAL_TRACE_HEADER,
  getCorrelationId,
  getEvalContext,
  withCorrelationId,
  withEvalHeaders,
} from './tracing.js';

// OAuth redirect URI validation
export { isValidRedirectUri } from './oauth-redirect.js';
