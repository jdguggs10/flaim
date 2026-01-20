// workers/espn-client/src/shared/espn-api.ts
import type { EspnCredentials } from '@flaim/worker-shared';

const ESPN_BASE_URL = 'https://lm-api-reads.fantasy.espn.com/apis/v3';

interface EspnFetchOptions {
  credentials?: EspnCredentials | null;
  timeout?: number;
  headers?: Record<string, string>;
}

/**
 * Make a request to the ESPN Fantasy API
 * @param path - API path after /games/{gameId} (e.g., /seasons/2025/segments/0/leagues/123)
 * @param gameId - ESPN game ID (flb for baseball, ffl for football, etc.)
 * @param options - Request options including credentials and timeout
 */
export async function espnFetch(
  path: string,
  gameId: string,
  options: EspnFetchOptions = {}
): Promise<Response> {
  const { credentials, timeout = 5000, headers: additionalHeaders = {} } = options;

  const url = `${ESPN_BASE_URL}/games/${gameId}${path}`;

  const headers: Record<string, string> = {
    'User-Agent': 'espn-client/1.0',
    'Accept': 'application/json',
    'X-Fantasy-Source': 'kona',
    'X-Fantasy-Platform': 'kona-web-2.0.0',
    ...additionalHeaders,
  };

  if (credentials) {
    headers['Cookie'] = `SWID=${credentials.swid}; espn_s2=${credentials.s2}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Handle ESPN API error responses and throw appropriate errors
 */
export function handleEspnError(response: Response): never {
  switch (response.status) {
    case 401:
      throw new Error('ESPN_COOKIES_EXPIRED: ESPN session expired. Update credentials at /settings/espn');
    case 403:
      throw new Error('ESPN_ACCESS_DENIED: Access denied to this league. Set up ESPN credentials at /settings/espn');
    case 404:
      throw new Error('ESPN_NOT_FOUND: League or resource not found');
    case 429:
      throw new Error('ESPN_RATE_LIMIT: Too many requests to ESPN. Please wait and try again.');
    default:
      throw new Error(`ESPN_API_ERROR: ESPN returned ${response.status}`);
  }
}

/**
 * Utility to check if credentials are required and available
 */
export function requireCredentials(
  credentials: EspnCredentials | null,
  context: string
): asserts credentials is EspnCredentials {
  if (!credentials) {
    throw new Error(
      `ESPN_CREDENTIALS_NOT_FOUND: ESPN credentials required for ${context}. ` +
      `Add your espn_s2 and SWID cookies at /settings/espn`
    );
  }
}
