// workers/espn-client/src/shared/espn-api.ts
import {
  fetchEspnLeagueSeason,
  unwrapEspnLeaguePayload,
  type EspnCredentials,
} from '@flaim/worker-shared';

const ESPN_BASE_URL = 'https://lm-api-reads.fantasy.espn.com/apis/v3';

interface EspnFetchOptions {
  credentials?: EspnCredentials | null;
  timeout?: number;
  headers?: Record<string, string>;
  league?: {
    leagueId: string;
    espnSeasonYear: number;
    historical: boolean;
  };
}

type EspnRawFetchOptions = Omit<EspnFetchOptions, 'league'>;

async function fetchEspnPath(
  path: string,
  gameId: string,
  options: EspnRawFetchOptions,
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
    return await fetch(url, {
      headers,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('ESPN_TIMEOUT: Request timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
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
  const { league, ...rawOptions } = options;
  if (!league) {
    return fetchEspnPath(path, gameId, rawOptions);
  }

  const queryIndex = path.indexOf('?');
  const query = queryIndex >= 0 ? path.slice(queryIndex + 1) : undefined;
  return fetchEspnLeagueSeason({
    espnSeasonYear: league.espnSeasonYear,
    leagueId: league.leagueId,
    query,
    historical: league.historical,
    modernPath: path,
  }, (candidatePath) => fetchEspnPath(candidatePath, gameId, rawOptions));
}

export async function readEspnLeagueJson<T>(
  response: Response,
  isValid: (value: unknown) => value is T,
): Promise<T | null> {
  const payload: unknown = await response.json();
  const league = unwrapEspnLeaguePayload(payload);
  return isValid(league) ? league : null;
}

/**
 * Handle ESPN API error responses and throw appropriate errors
 */
export function handleEspnError(response: Response): never {
  switch (response.status) {
    case 401:
      throw new Error('ESPN_AUTHENTICATION_FAILED: ESPN authentication failed. Re-sync with the Flaim Chrome extension and confirm the league at https://flaim.app/leagues');
    case 403:
      throw new Error('ESPN_ACCESS_DENIED: Access denied to this league. Re-sync with the Flaim Chrome extension and confirm the league at https://flaim.app/leagues');
    case 404:
      throw new Error('ESPN_NOT_FOUND: League or resource not found');
    case 429:
      throw new Error('ESPN_RATE_LIMIT: Too many requests to ESPN. Please wait and try again.');
    default:
      console.error(`[espn-api] Unexpected ESPN status: ${response.status}`);
      throw new Error('ESPN_API_ERROR: An unexpected error occurred with ESPN. Please try again.');
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
      `Connect ESPN with the Flaim Chrome extension from https://flaim.app/leagues`
    );
  }
}
