import { YahooAuthWorkerErrorCode } from '@flaim/worker-shared';

export interface YahooDiscoverErrorResponse {
  error?: string;
  error_description?: string;
  retryable?: boolean;
  retry_after?: number;
}

// Any future auth-worker error that requires a reconnect must be listed here;
// otherwise retryable: true will route it to the temporary notice path.
const YAHOO_RECONNECT_ERRORS = new Set<string>(['not_connected', 'refresh_failed']);
// Includes OAuth callback redirect codes; yahoo-client's credentials API classifier is intentionally narrower.
const YAHOO_TRANSIENT_AUTH_ERRORS = new Set<string>([
  YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE,
  YahooAuthWorkerErrorCode.TOKEN_EXCHANGE_UNAVAILABLE,
  YahooAuthWorkerErrorCode.YAHOO_API_TEMPORARILY_UNAVAILABLE,
]);

const YAHOO_GENERIC_RETRY_COPY = 'Try again in a few minutes.';
const YAHOO_TRANSIENT_AUTH_BASE = 'Yahoo is temporarily unavailable.';

export function formatYahooRetryAfter(retryAfterSeconds?: number): string | null {
  if (typeof retryAfterSeconds !== 'number' || !Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
    return null;
  }

  if (retryAfterSeconds < 60) {
    const roundedSeconds = Math.ceil(retryAfterSeconds);
    return `${roundedSeconds} second${roundedSeconds === 1 ? '' : 's'}`;
  }

  if (retryAfterSeconds >= 60 * 60) {
    const roundedHours = Math.max(1, Math.round(retryAfterSeconds / (60 * 60)));
    return `about ${roundedHours} hour${roundedHours === 1 ? '' : 's'}`;
  }

  const roundedMinutes = Math.max(1, Math.round(retryAfterSeconds / 60));
  return `about ${roundedMinutes} minute${roundedMinutes === 1 ? '' : 's'}`;
}

export function parseYahooRetryAfterSeconds(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  const trimmedValue = value.trim();
  if (!/^\d+$/.test(trimmedValue)) {
    return undefined;
  }

  const parsed = Number.parseInt(trimmedValue, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function retryCopy(retryAfterSeconds?: number): string {
  const retryAfter = formatYahooRetryAfter(retryAfterSeconds);
  return retryAfter ? `Try again in ${retryAfter}.` : YAHOO_GENERIC_RETRY_COPY;
}

function appendRetryCopy(message: string, retryAfterSeconds?: number): string {
  return `${message} ${retryCopy(retryAfterSeconds)}`;
}

export function getYahooConnectErrorMessage(
  error: string,
  description: string | null,
  retryAfterSeconds?: number
): string {
  switch (error) {
    case YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE:
      return appendRetryCopy(YAHOO_TRANSIENT_AUTH_BASE, retryAfterSeconds);
    case YahooAuthWorkerErrorCode.TOKEN_EXCHANGE_UNAVAILABLE:
      return appendRetryCopy('Yahoo connection could not be started because Yahoo was temporarily unavailable.', retryAfterSeconds);
    case 'token_exchange_failed':
      return description || 'Yahoo connection failed while exchanging the authorization code. Please try again.';
    case 'oauth_denied':
      return 'Yahoo connection was canceled.';
    default:
      return description || 'Yahoo connection failed. Please try again.';
  }
}

export function parseYahooDiscoverErrorResponse(data: unknown): YahooDiscoverErrorResponse {
  if (!data || typeof data !== 'object') {
    return {};
  }

  const record = data as Record<string, unknown>;
  return {
    error: typeof record.error === 'string' ? record.error : undefined,
    error_description: typeof record.error_description === 'string' ? record.error_description : undefined,
    retryable: typeof record.retryable === 'boolean' ? record.retryable : undefined,
    retry_after: typeof record.retry_after === 'number' ? record.retry_after : undefined,
  };
}

export function isYahooTransientAuthError(error?: string): boolean {
  return typeof error === 'string' && YAHOO_TRANSIENT_AUTH_ERRORS.has(error);
}

// INVARIANT: Any new auth-worker error code that requires reconnect MUST be added
// to YAHOO_RECONNECT_ERRORS above, or retryable: true will suppress the reconnect prompt.
export function isYahooTransientAuthResponse(data: { error?: string; retryable?: boolean }): boolean {
  const reconnectError = typeof data.error === 'string' && YAHOO_RECONNECT_ERRORS.has(data.error);
  return !reconnectError && (isYahooTransientAuthError(data.error) || data.retryable === true);
}

export function isYahooReconnectRequired(status: number, data: { error?: string; retryable?: boolean }): boolean {
  if (isYahooTransientAuthResponse(data)) {
    return false;
  }

  return (
    status === 401 ||
    status === 403 ||
    (typeof data.error === 'string' && YAHOO_RECONNECT_ERRORS.has(data.error))
  );
}

export function getYahooTransientAuthMessage(data: { error?: string; error_description?: string; retry_after?: number }): string {
  if (data.error && isYahooTransientAuthError(data.error)) {
    return getYahooConnectErrorMessage(data.error, data.error_description || null, data.retry_after);
  }

  if (data.error_description) {
    return data.retry_after !== undefined
      ? appendRetryCopy(data.error_description, data.retry_after)
      : data.error_description;
  }

  return appendRetryCopy(YAHOO_TRANSIENT_AUTH_BASE, data.retry_after);
}
