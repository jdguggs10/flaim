import type { YahooCredentials } from './auth';

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
      throw new Error('YAHOO_TIMEOUT: Request timed out');
    }
    throw error;
  }
}

/**
 * Handle Yahoo API error responses
 */
export function handleYahooError(response: Response): never {
  switch (response.status) {
    case 401:
      throw new Error('YAHOO_AUTH_ERROR: Yahoo token expired or invalid');
    case 403:
      throw new Error('YAHOO_ACCESS_DENIED: Access denied to this resource');
    case 404:
      throw new Error('YAHOO_NOT_FOUND: League or resource not found');
    case 429:
      throw new Error('YAHOO_RATE_LIMITED: Too many requests. Please wait.');
    default:
      throw new Error(`YAHOO_API_ERROR: Yahoo returned ${response.status}`);
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
