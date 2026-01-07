/**
 * ESPN League Info Fetcher (v3 API)
 * ---------------------------------------------------------------------------
 * Fetches detailed information about a specific ESPN fantasy league using
 * the v3 Fantasy API.
 */
import { 
  EspnAuthenticationFailed, 
  EspnCredentialsRequired,
  EspnLeagueNotFound,
  EspnApiError,
  SportName,
  gameIdToSport,
  type EspnLeagueInfo
} from '../espn-types';

interface EspnApiLeagueResponse {
  id: string;
  name: string;
  seasonId: number;
  scoringPeriodId: number;
  firstScoringPeriod: number;
  finalScoringPeriod: number;
  status: {
    currentMatchupPeriod: number;
    isActive: boolean;
    previousSeasons: number[];
    statusType: {
      type: string;
    };
  };
  settings: {
    name: string;
    size: number;
  };
  gameId: number;
  gameName: string;
}

// Export the EspnLeagueInfo type for external use
export type { EspnLeagueInfo };

/**
 * Fetches detailed information about an ESPN fantasy league
 * @param swid - ESPN SWID cookie value
 * @param s2 - ESPN espn_s2 cookie value
 * @param leagueId - ESPN league ID
 * @param season - Season year (defaults to current year)
 * @param gameId - ESPN game ID (ffl, flb, fba, fhl) - defaults to 'ffl' for backwards compatibility
 * @returns Promise with league information
 * @throws {EspnAuthenticationFailed} If authentication fails
 * @throws {EspnLeagueNotFound} If league is not found
 * @throws {EspnApiError} For other API errors
 */
export async function getLeagueInfo(
  swid: string,
  s2: string,
  leagueId: string,
  season: number = new Date().getFullYear(),
  gameId: string = 'ffl'
): Promise<EspnLeagueInfo> {
  if (!swid || !s2) {
    throw new EspnCredentialsRequired('Both SWID and espn_s2 cookies are required');
  }
  if (!leagueId) {
    throw new Error('League ID is required');
  }

  // First, try the simpler endpoint with just mSettings view
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/${gameId}/seasons/${season}/segments/0/leagues/${leagueId}?view=mSettings`;
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Cookie': `SWID=${swid}; espn_s2=${s2}`,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'X-Fantasy-Source': 'kona',
        'X-Fantasy-Platform': 'kona-web-2.0.0'
      }
    });

    // Clone the response so we can read it multiple times if needed
    const responseClone = response.clone();
    
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        const errorText = await response.text().catch(() => 'Failed to read error response');
        console.error('Authentication error response:', errorText);
        throw new EspnAuthenticationFailed('ESPN authentication failed - invalid or expired cookies');
      }
      if (response.status === 404) {
        throw new EspnLeagueNotFound(`League with ID ${leagueId} not found for season ${season}`);
      }
      const errorText = await response.text().catch(() => 'Failed to read error response');
      console.error('API error response:', errorText);
      throw new EspnApiError(`ESPN API error: ${response.status} ${response.statusText}`);
    }

    let data: EspnApiLeagueResponse;
    try {
      const responseText = await responseClone.text();
      data = JSON.parse(responseText) as EspnApiLeagueResponse;
    } catch (error) {
      // Log response details for debugging
      const errorText = await response.text().catch(() => 'Failed to read error response');
      console.error('Failed to parse response as JSON. Response text:', errorText);
      
      // Log headers in a TypeScript-compatible way
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      console.error('Response headers:', headers);
      
      throw new EspnApiError('Invalid JSON response from ESPN API');
    }
    
    if (!data || !data.id) {
      throw new EspnApiError('Invalid response structure from ESPN API');
    }

    // Map the API response to our EspnLeagueInfo interface
    const sport = gameIdToSport(gameId) || gameIdToSport(data.gameId.toString()) || 'football';
    
    return {
      leagueId: data.id,
      leagueName: data.name,
      sport: sport as SportName,
      seasonYear: data.seasonId,
      gameId: data.gameId.toString(),
      scoringPeriodId: data.scoringPeriodId,
      firstScoringPeriod: data.firstScoringPeriod || 1,
      finalScoringPeriod: data.finalScoringPeriod || 18,
      status: {
        currentMatchupPeriod: data.status?.currentMatchupPeriod || 1,
        isActive: data.status?.isActive || false,
        previousSeasons: data.status?.previousSeasons || []
      },
      settings: {
        name: data.settings?.name || '',
        size: data.settings?.size || 0,
        status: data.status?.statusType?.type || 'UNKNOWN',
        season: data.seasonId,
        currentMatchupPeriod: data.status?.currentMatchupPeriod || 1,
        gameId: data.gameId,
        gameName: data.gameName || 'Unknown',
        isActive: data.status?.isActive || false
      },
      standings: [],
      teams: []
    };
  } catch (error: unknown) {
    if (error instanceof EspnApiError || 
        error instanceof EspnAuthenticationFailed || 
        error instanceof EspnLeagueNotFound) {
      throw error;
    }
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    throw new EspnApiError(`Failed to fetch league info: ${errorMessage}`);
  }
}

/**
 * Safe wrapper that returns null instead of throwing
 * @param swid - ESPN SWID cookie value
 * @param s2 - ESPN espn_s2 cookie value
 * @param leagueId - ESPN league ID
 * @param season - Season year (defaults to current year)
 * @param gameId - ESPN game ID (ffl, flb, fba, fhl) - defaults to 'ffl'
 * @returns League info or null if an error occurs
 */
export async function getLeagueInfoSafe(
  swid: string,
  s2: string,
  leagueId: string,
  season: number = new Date().getFullYear(),
  gameId: string = 'ffl'
): Promise<EspnLeagueInfo | null> {
  try {
    return await getLeagueInfo(swid, s2, leagueId, season, gameId);
  } catch (error) {
    console.error('Error in getLeagueInfoSafe:', error);
    return null;
  }
}
