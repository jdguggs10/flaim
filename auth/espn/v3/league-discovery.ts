/**
 * ESPN Fantasy League Discovery (v3 API)
 * ---------------------------------------------------------------------------
 * Given a user's SWID and espn_s2 cookies, query the v3 Fantasy API for each
 * supported sport (football, baseball, basketball, hockey) for the current
 * season and return the leagues the user is a member of.
 *
 * This supersedes the previous Gambit–based discovery which only covered
 * Pick'em/Challenge games.
 */
import { 
  AutomaticLeagueDiscoveryFailed, 
  EspnAuthenticationFailed, 
  EspnCredentialsRequired,
  GambitLeague,
  ESPN_GAME_IDS 
} from '../types.js';

const V3_BASE = 'https://fantasy.espn.com/apis/v3/games';

export async function discoverLeaguesV3(swid: string, s2: string): Promise<GambitLeague[]> {
  if (!swid || !s2) {
    throw new EspnCredentialsRequired('Both SWID and espn_s2 cookies are required');
  }

  const season = new Date().getFullYear();
  const leagues: GambitLeague[] = [];

  for (const [gameId, sport] of Object.entries(ESPN_GAME_IDS)) {
    const url = `${V3_BASE}/${gameId}/seasons/${season}?view=mUserLeagues`;

    console.log(`🔍 Querying ${sport} leagues: ${url}`);
    console.log(`🍪 Using cookies: SWID=${swid.substring(0, 10)}... espn_s2=${s2.substring(0, 20)}...`);
    
    // Create AbortController for 7-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);

    try {
      const res = await fetch(url, {
        headers: {
          Cookie: `SWID=${swid}; espn_s2=${s2}`,
          "User-Agent": "flaim-league-discovery/1.0",
          Accept: "application/json"
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      console.log(`📡 ${sport} API Response: ${res.status} ${res.statusText}`);

      if (res.status === 401 || res.status === 403) {
        throw new EspnAuthenticationFailed('ESPN authentication failed – invalid or expired cookies');
      }

      if (!res.ok) {
        // Non-fatal: continue to next sport
        console.warn(`v3 discovery: ${sport} responded ${res.status}`);
        continue;
      }

      let json: any;
      const responseText = await res.text();
      console.log(`📝 ${sport} Response (first 200 chars): ${responseText.substring(0, 200)}`);
      
      try {
        json = JSON.parse(responseText);
      } catch (parseError) {
        console.error(`❌ Failed to parse JSON for ${sport}:`, parseError);
        if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
          throw new EspnAuthenticationFailed('ESPN returned HTML instead of JSON - likely authentication failure. Please verify your cookies are current and valid.');
        }
        throw new Error(`Invalid JSON response from ESPN ${sport} API`);
      }

      if (!json?.leagues || !Array.isArray(json.leagues)) {
        continue;
      }

      for (const l of json.leagues) {
        const { id: leagueId, name: leagueName, seasonId } = l;
        const member = Array.isArray(l.members) && l.members[0] ? l.members[0] : {};
        const teamId = member.teamId ?? member.id;
        const teamName = member.teamName ?? member.nickname;

        if (!leagueId || !teamId) continue;

        leagues.push({
          gameId,
          leagueId: String(leagueId),
          leagueName: String(leagueName ?? 'Unnamed League'),
          seasonId: Number(seasonId ?? season),
          teamId: Number(teamId),
          teamName: String(teamName ?? '')
        });
      }
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn(`⏰ Timeout fetching ${sport} leagues - try again`);
        // Non-fatal: continue to next sport
        continue;
      }
      
      // Re-throw other errors
      throw error;
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
