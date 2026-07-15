import type { YahooCredentials } from './auth';
import {
  ErrorCode,
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
export async function handleYahooError(response: Response): Promise<never> {
  const classification = classifyYahooApiFailure(response);
  // Yahoo's error body, read lazily for diagnostics — only the bad_request and
  // unexpected branches below use it, so the retryable hot paths (429/503) skip
  // the extra body read. Callers invoke this on `!response.ok` before `.json()`,
  // so the body is still unconsumed here.
  const readErrorBody = () =>
    response.text().then((b) => b.slice(0, 500)).catch(() => '');
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
        upstreamStatus: classification.upstreamStatus,
        retryable: classification.retryable,
        retryAfter: classification.retryAfter,
      });
    case 'transient':
      throw new YahooClientError({
        code: ErrorCode.YAHOO_TRANSIENT_ERROR,
        message: 'Yahoo is temporarily unavailable. Please try again later.',
        status: classification.status,
        upstreamStatus: classification.upstreamStatus,
        retryable: classification.retryable,
        retryAfter: classification.retryAfter,
      });
    case 'bad_request':
      console.error(`[yahoo-api] Yahoo ${classification.upstreamStatus} body: ${await readErrorBody()}`);
      throw new YahooClientError({
        code: ErrorCode.YAHOO_BAD_REQUEST,
        message: 'Yahoo rejected the request (400).',
        status: classification.status,
        upstreamStatus: classification.upstreamStatus,
        retryable: false,
      });
    default:
      console.error(`[yahoo-api] Unexpected Yahoo status: ${classification.upstreamStatus}`);
      console.error(`[yahoo-api] Yahoo ${classification.upstreamStatus} body: ${await readErrorBody()}`);
      throw new YahooClientError({
        code: 'YAHOO_API_ERROR',
        message: 'An unexpected error occurred with Yahoo. Please try again.',
        status: classification.status,
        upstreamStatus: classification.upstreamStatus,
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
