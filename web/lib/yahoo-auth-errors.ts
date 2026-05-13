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
  YahooAuthWorkerErrorCode.TOKEN_REFRESH_VALIDATION_UNAVAILABLE,
  YahooAuthWorkerErrorCode.TOKEN_EXCHANGE_UNAVAILABLE,
  YahooAuthWorkerErrorCode.YAHOO_API_TEMPORARILY_UNAVAILABLE,
]);

const YAHOO_TRANSIENT_AUTH_FALLBACK =
  'Yahoo is temporarily unavailable. Try again in a few minutes.';

export function formatYahooRetryAfter(retryAfterSeconds?: number): string | null {
  if (typeof retryAfterSeconds !== 'number' || !Number.isFinite(retryAfterSeconds) || retryAfterSeconds <= 0) {
    return null;
  }

  if (retryAfterSeconds < 60) {
    const roundedSeconds = Math.ceil(retryAfterSeconds);
    return `${roundedSeconds} second${roundedSeconds === 1 ? '' : 's'}`;
  }

  const roundedMinutes = Math.ceil(retryAfterSeconds / 60);
  return `about ${roundedMinutes} minute${roundedMinutes === 1 ? '' : 's'}`;
}

function appendRetryAfter(message: string, retryAfterSeconds?: number): string {
  const retryAfter = formatYahooRetryAfter(retryAfterSeconds);
  if (!retryAfter) {
    return message;
  }

  const messageWithoutGenericRetry = message
    .replace(/ Please try again in a few minutes\.$/, '')
    .replace(/ Try again in a few minutes\.$/, '');
  return `${messageWithoutGenericRetry} Try again in ${retryAfter}.`;
}

export function getYahooConnectErrorMessage(
  error: string,
  description: string | null,
  retryAfterSeconds?: number
): string {
  switch (error) {
    case 'token_refresh_validation_failed':
      return 'Yahoo connection did not complete because the refresh token could not be validated. Please connect Yahoo again.';
    case YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE:
      return appendRetryAfter(YAHOO_TRANSIENT_AUTH_FALLBACK, retryAfterSeconds);
    case YahooAuthWorkerErrorCode.TOKEN_REFRESH_VALIDATION_UNAVAILABLE:
      return appendRetryAfter('Yahoo connection could not be validated because Yahoo was temporarily unavailable. Try again in a few minutes.', retryAfterSeconds);
    case YahooAuthWorkerErrorCode.TOKEN_EXCHANGE_UNAVAILABLE:
      return appendRetryAfter('Yahoo connection could not be started because Yahoo was temporarily unavailable. Try again in a few minutes.', retryAfterSeconds);
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

  return appendRetryAfter(data.error_description || YAHOO_TRANSIENT_AUTH_FALLBACK, data.retry_after);
}
