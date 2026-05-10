export const YAHOO_DEFAULT_RATE_LIMIT_RETRY_AFTER_SECONDS = 15 * 60;
export const YAHOO_DEFAULT_TRANSIENT_RETRY_AFTER_SECONDS = 5 * 60;
export const YAHOO_REFRESH_IN_PROGRESS_RETRY_AFTER_SECONDS = 5;

export function parseRetryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined;

  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds;
  }

  const retryAt = Date.parse(value);
  if (Number.isFinite(retryAt)) {
    const delta = Math.ceil((retryAt - Date.now()) / 1000);
    return Math.max(1, delta);
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
