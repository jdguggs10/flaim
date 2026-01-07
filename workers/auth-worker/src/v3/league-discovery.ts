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
  type SportName,
  gameIdToSport
} from '../espn-types';
import { getLeagueInfo } from './get-league-info';
import { getLeagueTeams } from './get-league-teams';
import { getDefaultSeasonYear, type SeasonSport } from '../season-utils';

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

  const leagues: GambitLeague[] = [];

  // Try each supported sport
  for (const [gameId, sport] of Object.entries(ESPN_GAME_IDS) as [string, SportName][]) {
    try {
      // Use sport-specific season based on rollover rules (America/New_York timezone)
      const season = getDefaultSeasonYear(sport as SeasonSport);
      console.log(`🔍 Querying ${sport} leagues for season ${season}...`);

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
            season,
            gameId
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

// =============================================================================
// EXTENSION DISCOVERY FUNCTIONS
// =============================================================================

import { EspnSupabaseStorage } from '../supabase-storage';

/**
 * Result type for discovered league (current season, shown in UI)
 */
export interface DiscoveredLeague {
  sport: 'football' | 'baseball' | 'basketball' | 'hockey';
  leagueId: string;
  leagueName: string;
  teamId: string;
  teamName: string;
  seasonYear: number;
}

/**
 * Result type for current season league (for default dropdown)
 */
export interface CurrentSeasonLeague extends DiscoveredLeague {
  isDefault: boolean;
}

/**
 * Result from discoverAndSaveLeagues
 */
export interface DiscoverAndSaveResult {
  discovered: DiscoveredLeague[];
  added: number;
  skipped: number;
  historical: number;
}

/**
 * Discover all leagues for a user and save them to the database.
 * Also discovers historical seasons synchronously.
 *
 * @param userId - Clerk user ID
 * @param swid - ESPN SWID cookie
 * @param s2 - ESPN espn_s2 cookie
 * @param storage - Supabase storage instance
 * @returns Discovery results with counts
 */
export async function discoverAndSaveLeagues(
  userId: string,
  swid: string,
  s2: string,
  storage: EspnSupabaseStorage
): Promise<DiscoverAndSaveResult> {
  // 1. Discover current season leagues
  const leagues = await discoverLeaguesV3(swid, s2);

  const discovered: DiscoveredLeague[] = [];
  let added = 0;
  let skipped = 0;
  let historical = 0;

  // 2. Process each league with per-league try/catch
  for (const league of leagues) {
    try {
      const sport = gameIdToSport(league.gameId);
      if (!sport) {
        console.warn(`Unknown gameId: ${league.gameId}`);
        continue;
      }

      // Check if league already exists
      const exists = await storage.leagueExists(
        userId,
        sport,
        league.leagueId,
        league.seasonId
      );

      if (exists) {
        skipped++;
      } else {
        // Add the league
        const result = await storage.addLeague(userId, {
          leagueId: league.leagueId,
          sport: sport as 'football' | 'baseball' | 'basketball' | 'hockey',
          leagueName: league.leagueName,
          teamId: String(league.teamId),
          teamName: league.teamName,
          seasonYear: league.seasonId,
        });

        if (result.success) {
          added++;
        } else {
          console.error(`Failed to add league ${league.leagueId}:`, result.error);
        }
      }

      // Add to discovered list for UI (regardless of whether it was new or existing)
      discovered.push({
        sport: sport as 'football' | 'baseball' | 'basketball' | 'hockey',
        leagueId: league.leagueId,
        leagueName: league.leagueName,
        teamId: String(league.teamId),
        teamName: league.teamName,
        seasonYear: league.seasonId,
      });

      // 3. Discover historical seasons for this league (synchronously)
      const historicalCount = await discoverHistoricalSeasons(
        userId,
        league,
        swid,
        s2,
        storage
      );
      historical += historicalCount;

    } catch (error) {
      // Per-league error handling - continue with other leagues
      console.error(`Error processing league ${league.leagueId}:`, error);
      continue;
    }
  }

  return { discovered, added, skipped, historical };
}

/**
 * Discover and save historical seasons for a single league.
 * Uses the league's seasonYear as the base (not current calendar year).
 * Only adds seasons where the user's teamId exists (validated via ESPN API).
 *
 * @param userId - Clerk user ID
 * @param league - The discovered league
 * @param swid - ESPN SWID cookie
 * @param s2 - ESPN espn_s2 cookie
 * @param storage - Supabase storage instance
 * @returns Number of historical seasons added
 */
async function discoverHistoricalSeasons(
  userId: string,
  league: GambitLeague,
  swid: string,
  s2: string,
  storage: EspnSupabaseStorage
): Promise<number> {
  let historicalAdded = 0;
  const sport = gameIdToSport(league.gameId);
  if (!sport) return 0;

  try {
    // Get league info using the LEAGUE'S season year and gameId (not current calendar year, not hardcoded ffl)
    const leagueInfo = await getLeagueInfo(swid, s2, league.leagueId, league.seasonId, league.gameId);

    if (!leagueInfo?.status?.previousSeasons) {
      return 0;
    }

    const previousSeasons = leagueInfo.status.previousSeasons;
    console.log(`Found ${previousSeasons.length} historical seasons for league ${league.leagueId}`);

    for (const year of previousSeasons) {
      try {
        // Skip if already exists
        const exists = await storage.leagueExists(userId, sport, league.leagueId, year);
        if (exists) {
          continue;
        }

        // Fetch teams for historical season to validate membership
        const teams = await getLeagueTeams(swid, s2, league.leagueId, year, league.gameId);

        // Only add if user's teamId exists in this historical season
        const hasTeam = teams.some(t => t.teamId === String(league.teamId));
        if (!hasTeam) {
          console.log(`Skipping season ${year} for league ${league.leagueId}: teamId ${league.teamId} not found`);
          continue;
        }

        // Get league info for historical season (for league name)
        const historicalInfo = await getLeagueInfo(swid, s2, league.leagueId, year, league.gameId);

        const result = await storage.addLeague(userId, {
          leagueId: league.leagueId,
          sport: sport as 'football' | 'baseball' | 'basketball' | 'hockey',
          leagueName: historicalInfo?.leagueName || league.leagueName,
          teamId: String(league.teamId),
          teamName: league.teamName,
          seasonYear: year,
        });

        if (result.success) {
          historicalAdded++;
        } else if (result.code !== 'DUPLICATE') {
          console.error(`Failed to add historical season ${year} for league ${league.leagueId}:`, result.error);
        }

      } catch (seasonError) {
        // Per-season error handling - continue with other seasons
        console.error(`Error fetching season ${year} for league ${league.leagueId}:`, seasonError);
        continue;
      }
    }

  } catch (error) {
    // If we can't get league info at all, just log and return
    console.error(`Failed to discover history for league ${league.leagueId}:`, error);
  }

  return historicalAdded;
}
