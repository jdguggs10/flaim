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

      // DEBUG: Log credentials being used (masked)
      console.log(`🔑 Using SWID: ${swid.substring(0, 10)}... (len=${swid.length}), s2: ${s2.substring(0, 10)}... (len=${s2.length})`);

      // First, try to get the user's leagues for this sport
      const url = `${V3_BASE}/${gameId}/seasons/${season}?view=mUserLeagues`;
      const res = await fetch(url, {
        headers: {
          Cookie: `SWID=${swid}; espn_s2=${s2}`,
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
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

      // DEBUG: Log raw ESPN response structure
      console.log(`📦 ESPN raw response for ${sport}:`, JSON.stringify(json, null, 2).substring(0, 500));

      if (!json?.leagues || !Array.isArray(json.leagues)) {
        console.log(`No leagues found for ${sport}`);
        continue;
      }

      // DEBUG: Log all league IDs returned by ESPN
      console.log(`🔍 ESPN returned ${json.leagues.length} ${sport} leagues:`, json.leagues.map(l => ({
        id: l.id,
        name: l.name,
        seasonId: l.seasonId,
        memberCount: l.members?.length || 0,
        members: l.members?.map(m => ({ teamId: m.teamId, id: m.id }))
      })));

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

          if (!teamId) {
            console.warn(`⚠️ Skipping league ${league.id} (${league.name}): no teamId found. members:`, league.members);
            continue;
          }
          
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
 * Season counts for granular messaging
 */
export interface SeasonCounts {
  found: number;
  added: number;
  alreadySaved: number;
}

/**
 * Result from discoverHistoricalSeasons
 */
interface HistoricalResult {
  found: number;        // Seasons where user was a member
  added: number;        // Successfully added to DB
  alreadySaved: number; // Already existed in DB
}

/**
 * Result from discoverAndSaveLeagues
 */
export interface DiscoverAndSaveResult {
  discovered: DiscoveredLeague[];
  currentSeason: SeasonCounts;
  pastSeasons: SeasonCounts;
  // Legacy fields (deprecated, kept for backwards compatibility)
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
  const currentSeason: SeasonCounts = { found: 0, added: 0, alreadySaved: 0 };
  const pastSeasons: SeasonCounts = { found: 0, added: 0, alreadySaved: 0 };

  // 2. Process each league with per-league try/catch
  for (const league of leagues) {
    try {
      const sport = gameIdToSport(league.gameId);
      if (!sport) {
        console.warn(`Unknown gameId: ${league.gameId}`);
        continue;
      }

      // Count this league as found
      currentSeason.found++;

      // Check if league already exists
      const exists = await storage.leagueExists(
        userId,
        sport,
        league.leagueId,
        league.seasonId
      );

      if (exists) {
        currentSeason.alreadySaved++;
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
          currentSeason.added++;
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
      const histResult = await discoverHistoricalSeasons(
        userId,
        league,
        swid,
        s2,
        storage
      );
      pastSeasons.found += histResult.found;
      pastSeasons.added += histResult.added;
      pastSeasons.alreadySaved += histResult.alreadySaved;

    } catch (error) {
      // Per-league error handling - continue with other leagues
      console.error(`Error processing league ${league.leagueId}:`, error);
      continue;
    }
  }

  return {
    discovered,
    currentSeason,
    pastSeasons,
    // Legacy fields for backwards compatibility
    added: currentSeason.added,
    skipped: currentSeason.alreadySaved,
    historical: pastSeasons.added,
  };
}

/**
 * Discover and save historical seasons for a single league.
 * Uses the league's seasonYear as the base (not current calendar year).
 * Only counts/adds seasons where the user's teamId exists (validated via ESPN API).
 *
 * @param userId - Clerk user ID
 * @param league - The discovered league
 * @param swid - ESPN SWID cookie
 * @param s2 - ESPN espn_s2 cookie
 * @param storage - Supabase storage instance
 * @returns HistoricalResult with found/added/alreadySaved counts
 */
async function discoverHistoricalSeasons(
  userId: string,
  league: GambitLeague,
  swid: string,
  s2: string,
  storage: EspnSupabaseStorage
): Promise<HistoricalResult> {
  const result: HistoricalResult = { found: 0, added: 0, alreadySaved: 0 };
  const sport = gameIdToSport(league.gameId);
  if (!sport) return result;

  try {
    // Get league info using the LEAGUE'S season year and gameId (not current calendar year, not hardcoded ffl)
    const leagueInfo = await getLeagueInfo(swid, s2, league.leagueId, league.seasonId, league.gameId);

    if (!leagueInfo?.status?.previousSeasons) {
      return result;
    }

    const previousSeasons = leagueInfo.status.previousSeasons;
    console.log(`Found ${previousSeasons.length} historical seasons for league ${league.leagueId}`);

    for (const year of previousSeasons) {
      try {
        // FIRST: Validate membership - only count if user was a member
        const teams = await getLeagueTeams(swid, s2, league.leagueId, year, league.gameId);
        const hasTeam = teams.some(t => t.teamId === String(league.teamId));

        if (!hasTeam) {
          // User wasn't in this season - don't count it at all
          console.log(`Skipping season ${year} for league ${league.leagueId}: teamId ${league.teamId} not found`);
          continue;
        }

        // User was a member - count it as found
        result.found++;

        // Check if already saved
        const exists = await storage.leagueExists(userId, sport, league.leagueId, year);
        if (exists) {
          result.alreadySaved++;
          continue;
        }

        // Get league info for historical season (for league name)
        const historicalInfo = await getLeagueInfo(swid, s2, league.leagueId, year, league.gameId);

        const addResult = await storage.addLeague(userId, {
          leagueId: league.leagueId,
          sport: sport as 'football' | 'baseball' | 'basketball' | 'hockey',
          leagueName: historicalInfo?.leagueName || league.leagueName,
          teamId: String(league.teamId),
          teamName: league.teamName,
          seasonYear: year,
        });

        if (addResult.success) {
          result.added++;
        } else if (addResult.code !== 'DUPLICATE') {
          console.error(`Failed to add historical season ${year} for league ${league.leagueId}:`, addResult.error);
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

  return result;
}
