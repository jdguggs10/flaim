/**
 * ESPN Fantasy League Discovery (v3 API)
 * ---------------------------------------------------------------------------
 * Given a user's SWID and espn_s2 cookies, query the v3 Fantasy API for each
 * supported sport (football, baseball, basketball, hockey) for the current
 * season and return the leagues the user is a member of.
 *
 * This implementation uses the new getLeagueInfo function for more reliable
 * league discovery and information retrieval.
 */
import { 
  AutomaticLeagueDiscoveryFailed, 
  EspnAuthenticationFailed, 
  EspnCredentialsRequired,
  GambitLeague,
  ESPN_GAME_IDS,
  type SportName
} from '../espn-types';
import { getLeagueInfo } from './get-league-info';

const V3_BASE = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games';

/**
 * Discover all leagues for a user across all supported sports
 * @param swid - ESPN SWID cookie value
 * @param s2 - ESPN espn_s2 cookie value
 * @returns Array of discovered leagues
 */
export async function discoverLeaguesV3(swid: string, s2: string): Promise<GambitLeague[]> {
  if (!swid || !s2) {
    throw new EspnCredentialsRequired('Both SWID and espn_s2 cookies are required');
  }

  const season = new Date().getFullYear();
  const leagues: GambitLeague[] = [];

  // Try each supported sport
  for (const [gameId, sport] of Object.entries(ESPN_GAME_IDS) as [string, SportName][]) {
    try {
      console.log(`🔍 Querying ${sport} leagues...`);
      
      // First, try to get the user's leagues for this sport
      const url = `${V3_BASE}/${gameId}/seasons/${season}?view=mUserLeagues`;
      const res = await fetch(url, {
        headers: {
          Cookie: `SWID=${swid}; espn_s2=${s2}`,
          "User-Agent": "flaim-league-discovery/1.0",
          Accept: "application/json",
          'X-Fantasy-Source': 'kona',
          'X-Fantasy-Platform': 'kona-web-2.0.0'
        },
        signal: AbortSignal.timeout(7000) // 7 second timeout
      });

      console.log(`📡 ${sport} API Response: ${res.status} ${res.statusText}`);

      if (res.status === 401 || res.status === 403) {
        throw new EspnAuthenticationFailed('ESPN authentication failed – invalid or expired cookies');
      }

      if (!res.ok) {
        console.warn(`v3 discovery: ${sport} responded ${res.status}`);
        continue;
      }

      const json = await res.json() as { leagues?: Array<{
        id: string | number;
        name?: string;
        seasonId?: number;
        members?: Array<{
          teamId?: string | number;
          id?: string | number;
          teamName?: string;
          nickname?: string;
        }>;
      }> };
      
      if (!json?.leagues || !Array.isArray(json.leagues)) {
        console.log(`No leagues found for ${sport}`);
        continue;
      }

      // Process each league
      for (const league of json.leagues) {
        if (!league?.id) continue;
        
        try {
          // Get detailed league info using our new function
          const leagueInfo = await getLeagueInfo(
            swid,
            s2,
            String(league.id),
            season
          );
          
          if (!leagueInfo) continue;
          
          // Find the user's team in this league
          const member = Array.isArray(league.members) && league.members[0] ? league.members[0] : {};
          const teamId = member.teamId ?? member.id;
          const teamName = member.teamName ?? member.nickname;
          
          if (!teamId) continue;
          
          leagues.push({
            gameId,
            leagueId: String(league.id),
            leagueName: leagueInfo.leagueName || String(league.name || 'Unnamed League'),
            seasonId: leagueInfo.seasonYear || Number(league.seasonId || season),
            teamId: Number(teamId),
            teamName: String(teamName || '')
          });
          
        } catch (error) {
          console.error(`Error fetching details for league ${league.id}:`, error instanceof Error ? error.message : 'Unknown error');
          // Continue with next league even if one fails
          continue;
        }
      }
      
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        console.warn(`⏱️  Request timed out for ${sport}`);
        continue;
      }
      
      if (error instanceof EspnAuthenticationFailed) {
        throw error; // Re-throw auth errors
      }
      
      console.error(`⚠️  Error discovering ${sport} leagues:`, error);
    }
  }

  if (leagues.length === 0) {
    throw new AutomaticLeagueDiscoveryFailed('No fantasy leagues found for the supplied credentials');
  }

  return leagues;
}

export async function discoverLeaguesV3Safe(swid: string, s2: string) {
  try {
    const leagues = await discoverLeaguesV3(swid, s2);
    return { success: true, leagues };
  } catch (e: any) {
    return { success: false, leagues: [], error: e?.message ?? 'Unknown error' };
  }
}
