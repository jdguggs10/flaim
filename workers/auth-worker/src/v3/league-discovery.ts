/**
 * ESPN Fantasy League Discovery (via Fan API)
 * ---------------------------------------------------------------------------
 * Given a user's SWID and espn_s2 cookies, query the ESPN Fan API to discover
 * all fantasy leagues the user is a member of across all sports.
 *
 * This implementation uses fan.api.espn.com which returns all leagues in a
 * single API call, replacing the broken mUserLeagues endpoint.
 */
import {
  AutomaticLeagueDiscoveryFailed,
  EspnAuthenticationFailed,
  EspnCredentialsRequired,
  DiscoveredEspnLeague,
  gameIdToSport
} from '../espn-types';
import { getLeagueInfo } from './get-league-info';
import { getLeagueTeams } from './get-league-teams';

// =============================================================================
// FAN API TYPES
// =============================================================================

/**
 * ESPN Fan API preference entry for fantasy leagues
 */
interface FanApiPreference {
  id: string;
  type: { code: string; name?: string };
  metaData: {
    entry: {
      entryId: number;
      gameId: number;
      seasonId: number;
      entryMetadata: {
        teamName: string;
        teamAbbrev?: string;
      };
      groups: Array<{
        groupId: number;
        groupName: string;
        groupSize?: number;
      }>;
    };
  };
}

/**
 * ESPN Fan API response structure
 */
interface FanApiResponse {
  id: string;
  preferences?: FanApiPreference[];
}

// =============================================================================
// CONSTANTS
// =============================================================================

const FAN_API_BASE = 'https://fan.api.espn.com/apis/v2/fans';

/**
 * Map numeric gameId from Fan API to string gameId used internally
 */
const NUMERIC_TO_GAME_ID: Record<number, string> = {
  1: 'ffl',  // Football
  2: 'flb',  // Baseball
  3: 'fba',  // Basketball
  4: 'fhl',  // Hockey
};

/**
 * Discover all leagues for a user across all supported sports.
 * Uses the ESPN Fan API which returns all leagues in a single call.
 *
 * @param swid - ESPN SWID cookie value
 * @param s2 - ESPN espn_s2 cookie value
 * @returns Array of discovered leagues
 */
export async function discoverLeaguesV3(swid: string, s2: string): Promise<DiscoveredEspnLeague[]> {
  if (!swid || !s2) {
    throw new EspnCredentialsRequired('Both SWID and espn_s2 cookies are required');
  }

  // Normalize SWID to ensure brace format {UUID}
  // Fan API requires braces; some callers may pass bare UUID or extra whitespace
  const cleanedSwid = swid.trim().replace(/[{}]/g, '');
  if (!cleanedSwid) {
    throw new EspnCredentialsRequired('SWID is required');
  }
  const normalizedSwid = `{${cleanedSwid}}`;

  // Build Fan API URL with normalized SWID
  const url = `${FAN_API_BASE}/${encodeURIComponent(normalizedSwid)}?displayEvents=true`;

  console.log(`🔍 Discovering leagues via Fan API...`);

  try {
    const res = await fetch(url, {
      headers: {
        Cookie: `SWID=${normalizedSwid}; espn_s2=${s2}`,
        // Headers recommended for parity with ESPN's live site
        'x-p13n-swid': cleanedSwid,
        'X-Personalization-Source': 'ESPN.com - FAM',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    console.log(`📡 Fan API Response: ${res.status} ${res.statusText}`);

    if (res.status === 401 || res.status === 403) {
      throw new EspnAuthenticationFailed('ESPN authentication failed – invalid or expired cookies');
    }

    if (!res.ok) {
      throw new AutomaticLeagueDiscoveryFailed(`Fan API returned ${res.status}: ${res.statusText}`);
    }

    const json: FanApiResponse = await res.json();

    // Filter for fantasy leagues only (type.code === 'fantasy')
    const fantasyPrefs = json.preferences?.filter(
      (p) => p.type?.code === 'fantasy' && p.metaData?.entry?.groups?.length > 0
    ) ?? [];

    console.log(`📦 Fan API returned ${fantasyPrefs.length} fantasy leagues`);

    if (fantasyPrefs.length === 0) {
      throw new AutomaticLeagueDiscoveryFailed('No fantasy leagues found for the supplied credentials');
    }

    // Map preferences to DiscoveredEspnLeague format
    const leagues: DiscoveredEspnLeague[] = [];

    for (const pref of fantasyPrefs) {
      try {
        const entry = pref.metaData.entry;
        const group = entry.groups[0];

        // Map numeric gameId to string format
        const gameId = NUMERIC_TO_GAME_ID[entry.gameId];
        if (!gameId) {
          console.warn(`⚠️ Unknown gameId ${entry.gameId}, skipping league ${group.groupId}`);
          continue;
        }

        leagues.push({
          gameId,
          leagueId: String(group.groupId),
          leagueName: group.groupName,
          seasonId: entry.seasonId,
          teamId: entry.entryId,
          teamName: entry.entryMetadata?.teamName ?? '',
        });
      } catch (error) {
        console.error(`Error processing preference ${pref.id}:`, error instanceof Error ? error.message : 'Unknown error');
        continue;
      }
    }

    if (leagues.length === 0) {
      throw new AutomaticLeagueDiscoveryFailed('No fantasy leagues found for the supplied credentials');
    }

    console.log(`✅ Discovered ${leagues.length} leagues total`);
    return leagues;

  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new AutomaticLeagueDiscoveryFailed('Fan API request timed out');
    }

    if (error instanceof EspnAuthenticationFailed || error instanceof AutomaticLeagueDiscoveryFailed) {
      throw error;
    }

    console.error('⚠️ Error discovering leagues:', error);
    throw new AutomaticLeagueDiscoveryFailed(
      error instanceof Error ? error.message : 'Unknown error during league discovery'
    );
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
 * Note: isDefault has been removed - defaults are now stored in user_preferences table per-sport
 */
export type CurrentSeasonLeague = DiscoveredLeague;

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
  league: DiscoveredEspnLeague,
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
