const SLEEPER_BASE_URL = 'https://api.sleeper.app/v1';

interface SleeperFetchOptions {
  timeout?: number;
}

/**
 * Make a request to the Sleeper API (public, no auth needed)
 */
export async function sleeperFetch(
  path: string,
  options: SleeperFetchOptions = {}
): Promise<Response> {
  const { timeout = 10000 } = options;
  const url = `${SLEEPER_BASE_URL}${path}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    console.log(`[sleeper-api] Fetching: ${path}`);
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'flaim-sleeper-client/1.0',
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('SLEEPER_TIMEOUT: Request timed out');
    }
    throw error;
  }
}

/**
 * Handle Sleeper API error responses
 */
export function handleSleeperError(response: Response): never {
  switch (response.status) {
    case 404:
      throw new Error('SLEEPER_NOT_FOUND: League or resource not found');
    case 429:
      throw new Error('SLEEPER_RATE_LIMIT: Too many requests. Please wait.');
    case 400:
      throw new Error('SLEEPER_BAD_REQUEST: Invalid request');
    default:
      throw new Error(`SLEEPER_API_ERROR: Sleeper returned ${response.status}`);
  }
}

/**
 * Map Sleeper sport string to Flaim canonical sport
 */
export function sleeperSportToFlaim(sport: string): string {
  switch (sport) {
    case 'nfl': return 'football';
    case 'nba': return 'basketball';
    default: return sport;
  }
}

/**
 * Map Flaim canonical sport to Sleeper sport string
 */
export function flaimSportToSleeper(sport: string): string {
  switch (sport) {
    case 'football': return 'nfl';
    case 'basketball': return 'nba';
    default: return sport;
  }
}
