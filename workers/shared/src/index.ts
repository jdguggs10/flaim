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

// Auth-worker fetch helper
export { authWorkerFetch } from './auth-fetch.js';

// Internal service auth utilities
export {
  INTERNAL_SERVICE_TOKEN_HEADER,
  hasValidInternalServiceToken,
  isProductionLikeEnvironment,
  requireInternalServiceToken,
  withInternalServiceToken,
} from './internal-service.js';

// Error utilities
export { ErrorCode, extractErrorCode } from './errors.js';
export type { ErrorCodeValue, ExecuteResponse } from './errors.js';

// Logging
export { logEvalEvent } from './logging.js';
export type { TraceLogEvent } from './logging.js';

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
