/**
 * Canonical error codes used across all Flaim workers.
 *
 * Convention: thrown errors use format "CODE: Human message".
 * Use extractErrorCode() to parse the code from caught errors.
 */
export const ErrorCode = {
  // Auth
  AUTH_FAILED: 'AUTH_FAILED',
  CREDENTIALS_MISSING: 'CREDENTIALS_MISSING',
  INSUFFICIENT_SCOPE: 'INSUFFICIENT_SCOPE',
  INTERNAL_AUTH_NOT_CONFIGURED: 'INTERNAL_AUTH_NOT_CONFIGURED',
  INTERNAL_AUTH_REQUIRED: 'INTERNAL_AUTH_REQUIRED',

  // Platform routing
  PLATFORM_NOT_SUPPORTED: 'PLATFORM_NOT_SUPPORTED',
  PLATFORM_ERROR: 'PLATFORM_ERROR',
  ROUTING_ERROR: 'ROUTING_ERROR',

  // Sport/tool
  NOT_SUPPORTED: 'NOT_SUPPORTED',
  INVALID_SPORT: 'INVALID_SPORT',
  SPORT_NOT_SUPPORTED: 'SPORT_NOT_SUPPORTED',
  UNKNOWN_TOOL: 'UNKNOWN_TOOL',
  MISSING_PARAM: 'MISSING_PARAM',

  // ESPN-specific
  ESPN_COOKIES_EXPIRED: 'ESPN_COOKIES_EXPIRED',
  ESPN_ACCESS_DENIED: 'ESPN_ACCESS_DENIED',
  ESPN_NOT_FOUND: 'ESPN_NOT_FOUND',
  ESPN_RATE_LIMIT: 'ESPN_RATE_LIMIT',
  ESPN_API_ERROR: 'ESPN_API_ERROR',
  ESPN_INVALID_RESPONSE: 'ESPN_INVALID_RESPONSE',
  ESPN_CREDENTIALS_NOT_FOUND: 'ESPN_CREDENTIALS_NOT_FOUND',
  ESPN_ERROR: 'ESPN_ERROR',
  ESPN_TIMEOUT: 'ESPN_TIMEOUT',

  // Yahoo-specific
  YAHOO_AUTH_ERROR: 'YAHOO_AUTH_ERROR',
  YAHOO_ACCESS_DENIED: 'YAHOO_ACCESS_DENIED',
  YAHOO_NOT_FOUND: 'YAHOO_NOT_FOUND',
  YAHOO_RATE_LIMITED: 'YAHOO_RATE_LIMITED',
  YAHOO_API_ERROR: 'YAHOO_API_ERROR',
  YAHOO_NOT_CONNECTED: 'YAHOO_NOT_CONNECTED',
  YAHOO_TIMEOUT: 'YAHOO_TIMEOUT',

  // Sleeper-specific
  SLEEPER_NOT_FOUND: 'SLEEPER_NOT_FOUND',
  SLEEPER_RATE_LIMIT: 'SLEEPER_RATE_LIMIT',
  SLEEPER_BAD_REQUEST: 'SLEEPER_BAD_REQUEST',
  SLEEPER_API_ERROR: 'SLEEPER_API_ERROR',
  SLEEPER_TIMEOUT: 'SLEEPER_TIMEOUT',

  // Data
  LEAGUES_MISSING: 'LEAGUES_MISSING',
  TEAM_ID_MISSING: 'TEAM_ID_MISSING',
  TEAM_KEY_MISSING: 'TEAM_KEY_MISSING',
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',
  DUPLICATE: 'DUPLICATE',

  // Generic
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Extract a machine-readable error code from a caught error.
 * Expects errors thrown in "CODE: message" format.
 */
export function extractErrorCode(error: unknown): string {
  if (error instanceof Error) {
    const match = error.message.match(/^([A-Z_]+):/);
    if (match) return match[1];
  }
  return ErrorCode.INTERNAL_ERROR;
}

/**
 * Standard error response shape used by platform clients and gateway.
 */
export interface ExecuteResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  code?: string;
}
