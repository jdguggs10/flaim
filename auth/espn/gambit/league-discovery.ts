/**
 * ESPN League Discovery Service
 * 
 * Uses ESPN's internal gambit dashboard endpoint to automatically discover
 * all fantasy leagues a user belongs to across all sports.
 * 
 * Endpoint: https://gambit-api.fantasy.espn.com/apis/v1/dashboards/espn-en?view=allon
 * This is the same endpoint ESPN's web app uses for the "My Teams" dashboard.
 */

import { GambitLeague, GambitDashboardResponse, LeagueDiscoveryResult, ESPN_GAME_IDS } from './schema.js';
import { AutomaticLeagueDiscoveryFailed, EspnCredentialsRequired, EspnAuthenticationFailed } from './errors.js';

const GAMBIT_DASHBOARD_URL = 'https://gambit-api.fantasy.espn.com/apis/v1/dashboards/espn-en?view=allon';

/**
 * Discover all fantasy leagues for a user via ESPN's gambit dashboard
 * 
 * @param swid ESPN SWID cookie value
 * @param s2 ESPN espn_s2 cookie value
 * @returns Promise<GambitLeague[]> Array of discovered leagues
 * @throws AutomaticLeagueDiscoveryFailed if discovery fails
 * @throws EspnCredentialsRequired if credentials are missing
 * @throws EspnAuthenticationFailed if credentials are invalid
 */
export async function discoverLeagues(swid: string, s2: string): Promise<GambitLeague[]> {
  // Validate credentials
  if (!swid || !s2) {
    throw new EspnCredentialsRequired('Both SWID and espn_s2 cookies are required');
  }

  const startTime = Date.now();
  
  try {
    console.log(`🔍 Discovering leagues for user ${swid.slice(-4)} via gambit dashboard`);
    
    const response = await fetch(GAMBIT_DASHBOARD_URL, {
      headers: {
        'Cookie': `SWID=${swid}; espn_s2=${s2}`,
        'User-Agent': 'flaim-league-discovery/1.0',
        'Accept': 'application/json'
      },
      // Disable CF cache; data is user-specific
      cf: { cacheEverything: false }
    });

    const responseTime = Date.now() - startTime;
    console.log(`⏱️ Gambit dashboard responded in ${responseTime}ms with status ${response.status}`);

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new EspnAuthenticationFailed(
          `ESPN authentication failed (${response.status}): Invalid or expired credentials`
        );
      }
      
      throw new AutomaticLeagueDiscoveryFailed(
        `Dashboard call failed: ${response.status} ${response.statusText}`,
        response.status
      );
    }

    const json: GambitDashboardResponse = await response.json();
    const leagues = json?.fantasyDashboard?.leagues;

    if (!Array.isArray(leagues)) {
      throw new AutomaticLeagueDiscoveryFailed(
        'Invalid dashboard response: leagues not found or not an array'
      );
    }

    if (leagues.length === 0) {
      throw new AutomaticLeagueDiscoveryFailed(
        'No leagues returned from dashboard - user may not be in any active leagues'
      );
    }

    // Parse and validate league data
    const parsedLeagues: GambitLeague[] = [];
    
    for (const league of leagues) {
      try {
        const parsed = parseLeagueFromDashboard(league);
        if (parsed) {
          parsedLeagues.push(parsed);
        }
      } catch (error) {
        console.warn(`⚠️ Failed to parse league data:`, league, error);
        // Continue processing other leagues
      }
    }

    if (parsedLeagues.length === 0) {
      throw new AutomaticLeagueDiscoveryFailed(
        'No valid leagues could be parsed from dashboard response'
      );
    }

    console.log(`🎉 Successfully discovered ${parsedLeagues.length} leagues for user ${swid.slice(-4)}`);
    
    // Log sport breakdown for observability
    const sportCounts = parsedLeagues.reduce((acc, league) => {
      const sport = ESPN_GAME_IDS[league.gameId as keyof typeof ESPN_GAME_IDS] || 'unknown';
      acc[sport] = (acc[sport] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    console.log(`📊 League breakdown:`, sportCounts);

    return parsedLeagues;

  } catch (error) {
    const responseTime = Date.now() - startTime;
    
    if (error instanceof EspnAuthenticationFailed || 
        error instanceof AutomaticLeagueDiscoveryFailed ||
        error instanceof EspnCredentialsRequired) {
      // These are expected errors - log but don't treat as unexpected
      console.log(`❌ League discovery failed after ${responseTime}ms:`, error.message);
      throw error;
    }

    // Unexpected errors
    console.error(`💥 Unexpected error during league discovery after ${responseTime}ms:`, error);
    throw new AutomaticLeagueDiscoveryFailed(
      `Unexpected error during league discovery: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Safe wrapper that returns a result object instead of throwing
 */
export async function discoverLeaguesSafe(swid: string, s2: string): Promise<LeagueDiscoveryResult> {
  try {
    const leagues = await discoverLeagues(swid, s2);
    return {
      success: true,
      leagues
    };
  } catch (error) {
    return {
      success: false,
      leagues: [],
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Parse a single league object from the dashboard response
 */
function parseLeagueFromDashboard(leagueData: any): GambitLeague | null {
  // Validate required fields
  if (!leagueData || typeof leagueData !== 'object') {
    return null;
  }

  const { gameId, leagueId, leagueName, seasonId, teamId, teamName } = leagueData;

  // All fields are required
  if (!gameId || !leagueId || !leagueName || !seasonId || !teamId || !teamName) {
    console.warn('Missing required league fields:', {
      hasGameId: !!gameId,
      hasLeagueId: !!leagueId, 
      hasLeagueName: !!leagueName,
      hasSeasonId: !!seasonId,
      hasTeamId: !!teamId,
      hasTeamName: !!teamName
    });
    return null;
  }

  // Validate game ID is known
  if (!(gameId in ESPN_GAME_IDS)) {
    console.warn(`Unknown ESPN game ID: ${gameId}`);
    // Still include it - might be a new sport
  }

  return {
    gameId: String(gameId),
    leagueId: String(leagueId),
    leagueName: String(leagueName),
    seasonId: Number(seasonId),
    teamId: Number(teamId),
    teamName: String(teamName)
  };
}

/**
 * Filter leagues by sport
 */
export function filterLeaguesBySport(leagues: GambitLeague[], sport: keyof typeof ESPN_GAME_IDS): GambitLeague[] {
  return leagues.filter(league => league.gameId === sport);
}

/**
 * Get sport name from ESPN game ID
 */
export function getSportName(gameId: string): string {
  return ESPN_GAME_IDS[gameId as keyof typeof ESPN_GAME_IDS] || gameId;
}