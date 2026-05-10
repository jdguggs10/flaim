import type { YahooCredentials } from './auth';
import {
  YAHOO_DEFAULT_TRANSIENT_RETRY_AFTER_SECONDS,
  classifyYahooApiFailure,
} from '@flaim/worker-shared';
import { YahooClientError } from './errors';

const YAHOO_BASE_URL = 'https://fantasysports.yahooapis.com/fantasy/v2';

interface YahooFetchOptions {
  credentials: YahooCredentials;
  timeout?: number;
}

/**
 * Make a request to the Yahoo Fantasy API
 * @param path - API path (e.g., /league/449.l.12345/standings)
 * @param options - Request options including credentials and timeout
 */
export async function yahooFetch(
  path: string,
  options: YahooFetchOptions
): Promise<Response> {
  const { credentials, timeout = 10000 } = options;

  // Always request JSON format
  const separator = path.includes('?') ? '&' : '?';
  const url = `${YAHOO_BASE_URL}${path}${separator}format=json`;

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${credentials.accessToken}`,
    'Accept': 'application/json',
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    console.log(`[yahoo-api] Fetching: ${path}`);
    const response = await fetch(url, {
      headers,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new YahooClientError({
        code: 'YAHOO_TIMEOUT',
        message: 'Request timed out',
        status: 503,
        retryable: true,
        retryAfter: YAHOO_DEFAULT_TRANSIENT_RETRY_AFTER_SECONDS,
      });
    }
    throw error;
  }
}

/**
 * Handle Yahoo API error responses
 */
export function handleYahooError(response: Response): never {
  const classification = classifyYahooApiFailure(response);
  switch (classification.kind) {
    case 'auth_error':
      throw new YahooClientError({
        code: 'YAHOO_AUTH_ERROR',
        message: 'Yahoo token expired or invalid',
        status: classification.status,
      });
    case 'access_denied':
      throw new YahooClientError({
        code: 'YAHOO_ACCESS_DENIED',
        message: 'Access denied to this resource',
        status: classification.status,
      });
    case 'not_found':
      throw new YahooClientError({
        code: 'YAHOO_NOT_FOUND',
        message: 'League or resource not found',
        status: classification.status,
      });
    case 'rate_limited':
      throw new YahooClientError({
        code: 'YAHOO_RATE_LIMITED',
        message: 'Too many requests. Please wait.',
        status: classification.status,
        retryable: classification.retryable,
        retryAfter: classification.retryAfter,
      });
    default:
      console.error(`[yahoo-api] Unexpected Yahoo status: ${classification.upstreamStatus}`);
      throw new YahooClientError({
        code: 'YAHOO_API_ERROR',
        message: 'An unexpected error occurred with Yahoo. Please try again.',
        status: classification.status,
        retryable: classification.retryable,
        retryAfter: classification.retryAfter,
      });
  }
}

/**
 * Require credentials to be present
 */
export function requireCredentials(
  credentials: YahooCredentials | null,
  context: string
): asserts credentials is YahooCredentials {
  if (!credentials) {
    throw new Error(
      `YAHOO_NOT_CONNECTED: Yahoo account not connected. ` +
      `Connect Yahoo at /leagues to use ${context}.`
    );
  }
}
