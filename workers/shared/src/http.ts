// Yahoo 999 responses rarely include Retry-After. The 15-minute fallback is
// intentionally conservative for automatic retry loops; tune from telemetry if
// it proves too harsh for interactive Yahoo reconnect/discovery UX.
export const YAHOO_DEFAULT_RATE_LIMIT_RETRY_AFTER_SECONDS = 15 * 60;
export const YAHOO_DEFAULT_TRANSIENT_RETRY_AFTER_SECONDS = 5 * 60;
export const YAHOO_REFRESH_IN_PROGRESS_RETRY_AFTER_SECONDS = 5;
export const YAHOO_STALE_RETRY_AFTER_DATE_SECONDS = 30;

export function parseRetryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined;

  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return seconds > 0 ? seconds : undefined;
  }
  // Numeric-looking malformed values like "120s" should not fall through to Date.parse.
  if (/^[+-]?\d/.test(trimmed)) {
    return undefined;
  }

  const retryAt = Date.parse(trimmed);
  if (Number.isFinite(retryAt)) {
    const delta = Math.ceil((retryAt - Date.now()) / 1000);
    // A stale or clock-skewed HTTP-date means the delay has already elapsed;
    // keep a short retry hint instead of falling back to a longer Yahoo default.
    return Math.max(YAHOO_STALE_RETRY_AFTER_DATE_SECONDS, delta);
  }

  return undefined;
}

export function isYahooRateLimitStatus(status?: number): boolean {
  return status === 429 || status === 999;
}

export function isYahooTransientHttpStatus(status?: number): boolean {
  return isYahooRateLimitStatus(status) || (typeof status === 'number' && status >= 500);
}

export function defaultYahooRetryAfterSeconds(status?: number): number | undefined {
  if (isYahooRateLimitStatus(status)) {
    return YAHOO_DEFAULT_RATE_LIMIT_RETRY_AFTER_SECONDS;
  }
  if (typeof status === 'number' && status >= 500) {
    return YAHOO_DEFAULT_TRANSIENT_RETRY_AFTER_SECONDS;
  }
  return undefined;
}

export function retryAfterSecondsFromHeaders(
  headers: Pick<Headers, 'get'>,
  status?: number,
  fallback?: number
): number | undefined {
  return parseRetryAfterSeconds(headers.get('Retry-After')) ?? defaultYahooRetryAfterSeconds(status) ?? fallback;
}

export type YahooApiFailureKind =
  | 'auth_error'
  | 'access_denied'
  | 'not_found'
  | 'bad_request'
  | 'rate_limited'
  | 'transient'
  | 'unexpected';

export interface YahooApiFailureClassification {
  kind: YahooApiFailureKind;
  upstreamStatus: number;
  status: 400 | 401 | 403 | 404 | 429 | 502 | 503;
  retryable: boolean;
  retryAfter?: number;
}

export function classifyYahooApiFailure(
  response: Pick<Response, 'headers' | 'status'>
): YahooApiFailureClassification {
  const { status: upstreamStatus } = response;
  const retryable = isYahooTransientHttpStatus(upstreamStatus);
  const retryAfter = retryable
    ? retryAfterSecondsFromHeaders(response.headers, upstreamStatus)
    : undefined;

  if (upstreamStatus === 400) {
    return { kind: 'bad_request', upstreamStatus, status: 400, retryable: false };
  }
  if (upstreamStatus === 401) {
    return { kind: 'auth_error', upstreamStatus, status: 401, retryable: false };
  }
  if (upstreamStatus === 403) {
    return { kind: 'access_denied', upstreamStatus, status: 403, retryable: false };
  }
  if (upstreamStatus === 404) {
    return { kind: 'not_found', upstreamStatus, status: 404, retryable: false };
  }
  if (isYahooRateLimitStatus(upstreamStatus)) {
    return { kind: 'rate_limited', upstreamStatus, status: 429, retryable: true, retryAfter };
  }
  if (typeof upstreamStatus === 'number' && upstreamStatus >= 500) {
    return { kind: 'transient', upstreamStatus, status: 503, retryable: true, retryAfter };
  }

  return { kind: 'unexpected', upstreamStatus, status: 502, retryable: false };
}

// Since July 2026 Yahoo gates its Fantasy Sports API behind an approval program
// and denies unapproved apps platform-wide with a 403 whose body says the
// *application* is not authorized (as opposed to a resource-level 403 such as
// "not allowed to view this league"). Both Yahoo doors — league discovery in
// auth-worker and league data in yahoo-client — hit the same wall, so the
// detection and the words live here and are used by both. Self-limiting: the
// branch stops matching the moment Yahoo stops sending this denial string.
export function isYahooAppLevelDenialBody(body: string): boolean {
  return body.includes('application is not authorized');
}

/**
 * What an AI client (or the web app) should relay when Yahoo denies the app
 * itself. Names Yahoo, says it is platform-wide, says it is not the user's
 * account or connection, and says what still works — so a reader does not go
 * hunting for a bug on their side. `data` is for reads of an already-connected
 * league; `discovery` is for connect/refresh, where the extra sentence tells a
 * NEW Yahoo user that their connection is saved and nothing needs redoing.
 */
export const YAHOO_APP_REVIEW_OUTAGE_MESSAGE = {
  data:
    'Yahoo is currently reviewing third-party app access to its Fantasy Sports API, and Yahoo league data is temporarily unavailable in all third-party apps, including this one. This is not a problem with the user\'s account, connection, or league. ESPN and Sleeper leagues are unaffected.',
  discovery:
    'Yahoo is currently reviewing third-party app access to its Fantasy Sports API, and Yahoo league discovery is temporarily unavailable in all third-party apps, including this one. This is not a problem with the user\'s account or connection — the Yahoo connection is saved and their leagues will appear on the next refresh once Yahoo restores access; no reconnect is needed. ESPN and Sleeper leagues are unaffected.',
} as const;
