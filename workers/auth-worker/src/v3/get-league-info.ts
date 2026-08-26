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
import { getDefaultSeasonYear, toCanonicalYear, toPlatformYear } from '../season-utils';
import { fetchEspnLeagueSeason, unwrapEspnLeaguePayload } from '@flaim/worker-shared';

interface EspnApiLeagueResponse {
  id: string | number;
  name?: string;
  seasonId: number;
  scoringPeriodId?: number;
  firstScoringPeriod?: number;
  finalScoringPeriod?: number;
  status?: {
    currentMatchupPeriod?: number;
    isActive?: boolean;
    previousSeasons?: number[];
    statusType?: {
      type?: string;
    };
  };
  settings?: {
    name?: string;
    size?: number;
  };
  gameId: number;
  gameName?: string;
}

function isEspnApiLeagueResponse(value: unknown): value is EspnApiLeagueResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  const settings = record.settings;
  const settingsName = settings && typeof settings === 'object' && !Array.isArray(settings)
    ? (settings as Record<string, unknown>).name
    : undefined;
  return (
    (typeof record.id === 'string' || typeof record.id === 'number')
    && (typeof record.name === 'string' || typeof settingsName === 'string')
    && typeof record.seasonId === 'number'
    && typeof record.gameId === 'number'
  );
}

// Export the EspnLeagueInfo type for external use
export type { EspnLeagueInfo };

/**
 * Fetches detailed information about an ESPN fantasy league
 * @param swid - ESPN SWID cookie value
 * @param s2 - ESPN espn_s2 cookie value
 * @param leagueId - ESPN league ID
 * @param season - ESPN-native request year. When omitted, defaults from the
 * sport's canonical current season and is translated to ESPN's native year.
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
  season?: number,
  gameId: string = 'ffl'
): Promise<EspnLeagueInfo> {
  if (!swid || !s2) {
    throw new EspnCredentialsRequired('Both SWID and espn_s2 cookies are required');
  }
  if (!leagueId) {
    throw new Error('League ID is required');
  }

  const requestedSport = gameIdToSport(gameId) || 'football';
  const requestSeason =
    season ?? toPlatformYear(getDefaultSeasonYear(requestedSport), requestedSport, 'espn');

  try {
    const canonicalRequestSeason = toCanonicalYear(requestSeason, requestedSport, 'espn');
    const response = await fetchEspnLeagueSeason({
      espnSeasonYear: requestSeason,
      leagueId,
      query: 'view=mSettings',
      historical: canonicalRequestSeason < getDefaultSeasonYear(requestedSport),
    }, (path) => fetch(
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/${gameId}${path}`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'Cookie': `SWID=${swid}; espn_s2=${s2}`,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'X-Fantasy-Source': 'kona',
          'X-Fantasy-Platform': 'kona-web-2.0.0'
        }
      },
    ));
    
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        const errorText = await response.text().catch(() => 'Failed to read error response');
        console.error('Authentication error response:', errorText);
        throw new EspnAuthenticationFailed('ESPN authentication failed');
      }
      if (response.status === 404) {
        throw new EspnLeagueNotFound(`League with ID ${leagueId} not found for season ${requestSeason}`);
      }
      const errorText = await response.text().catch(() => 'Failed to read error response');
      console.error('API error response:', errorText);
      throw new EspnApiError(`ESPN API error: ${response.status} ${response.statusText}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await response.text());
    } catch {
      // Log headers in a TypeScript-compatible way
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      console.error('Response headers:', headers);
      
      throw new EspnApiError('Invalid JSON response from ESPN API');
    }

    const data = unwrapEspnLeaguePayload(parsed);
    if (!isEspnApiLeagueResponse(data)) {
      throw new EspnApiError('Invalid response structure from ESPN API');
    }

    // Map the API response to our EspnLeagueInfo interface
    const sport = requestedSport;
    const canonicalSeasonYear = toCanonicalYear(data.seasonId, sport, 'espn');
    const canonicalPreviousSeasons = (data.status?.previousSeasons || []).map((year) =>
      toCanonicalYear(year, sport, 'espn')
    );
    const leagueName = data.name || data.settings?.name || '';
    
    return {
      leagueId: String(data.id),
      leagueName,
      sport: sport as SportName,
      seasonYear: canonicalSeasonYear,
      gameId: data.gameId.toString(),
      scoringPeriodId: data.scoringPeriodId,
      firstScoringPeriod: data.firstScoringPeriod || 1,
      finalScoringPeriod: data.finalScoringPeriod || 18,
      status: {
        currentMatchupPeriod: data.status?.currentMatchupPeriod || 1,
        isActive: data.status?.isActive || false,
        previousSeasons: canonicalPreviousSeasons
      },
      settings: {
        name: data.settings?.name || leagueName,
        size: data.settings?.size || 0,
        status: data.status?.statusType?.type || 'UNKNOWN',
        season: canonicalSeasonYear,
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
 * @param season - ESPN-native request year. When omitted, derives from the
 * canonical current season for the sport.
 * @param gameId - ESPN game ID (ffl, flb, fba, fhl) - defaults to 'ffl'
 * @returns League info or null if an error occurs
 */
export async function getLeagueInfoSafe(
  swid: string,
  s2: string,
  leagueId: string,
  season?: number,
  gameId: string = 'ffl'
): Promise<EspnLeagueInfo | null> {
  try {
    return await getLeagueInfo(swid, s2, leagueId, season, gameId);
  } catch (error) {
    console.error('Error in getLeagueInfoSafe:', error);
    return null;
  }
}
