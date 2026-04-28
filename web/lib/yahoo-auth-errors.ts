import { YahooAuthWorkerErrorCode } from '@flaim/worker-shared';

export interface YahooDiscoverErrorResponse {
  error?: string;
  error_description?: string;
  retryable?: boolean;
}

// Any future auth-worker error that requires a reconnect must be listed here;
// otherwise retryable: true will route it to the temporary notice path.
const YAHOO_RECONNECT_ERRORS = new Set<string>(['not_connected', 'refresh_failed']);
// Includes OAuth callback redirect codes; yahoo-client's credentials API classifier is intentionally narrower.
const YAHOO_TRANSIENT_AUTH_ERRORS = new Set<string>([
  YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE,
  YahooAuthWorkerErrorCode.TOKEN_REFRESH_VALIDATION_UNAVAILABLE,
  YahooAuthWorkerErrorCode.TOKEN_EXCHANGE_UNAVAILABLE,
]);

const YAHOO_TRANSIENT_AUTH_FALLBACK =
  'Yahoo is temporarily unavailable while refreshing your connection. Please try again in a few minutes.';

export function getYahooConnectErrorMessage(error: string, description: string | null): string {
  switch (error) {
    case 'token_refresh_validation_failed':
      return 'Yahoo connection did not complete because the refresh token could not be validated. Please connect Yahoo again.';
    case YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE:
      return YAHOO_TRANSIENT_AUTH_FALLBACK;
    case YahooAuthWorkerErrorCode.TOKEN_REFRESH_VALIDATION_UNAVAILABLE:
      return 'Yahoo connection could not be validated because Yahoo was temporarily unavailable. Please try again in a few minutes.';
    case YahooAuthWorkerErrorCode.TOKEN_EXCHANGE_UNAVAILABLE:
      return 'Yahoo connection could not be started because Yahoo was temporarily unavailable. Please try again in a few minutes.';
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
  };
}

export function isYahooTransientAuthError(error?: string): boolean {
  return typeof error === 'string' && YAHOO_TRANSIENT_AUTH_ERRORS.has(error);
}

export function isYahooTransientAuthResponse(data: { error?: string; retryable?: boolean }): boolean {
  // retryable is an internal auth-worker contract, but any reconnect-required error must stay in
  // YAHOO_RECONNECT_ERRORS so a future retryable flag cannot suppress the reconnect prompt.
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

export function getYahooTransientAuthMessage(data: { error?: string; error_description?: string }): string {
  if (data.error && isYahooTransientAuthError(data.error)) {
    return getYahooConnectErrorMessage(data.error, data.error_description || null);
  }

  return data.error_description || YAHOO_TRANSIENT_AUTH_FALLBACK;
}
