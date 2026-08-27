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
import { getLeagueInfo, getLeagueInfoSafe } from './get-league-info';
import { getLeagueTeams } from './get-league-teams';
import { toCanonicalYear, toPlatformYear } from '../season-utils';

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
export async function discoverLeaguesV3(swid: string, s2: string, signal?: AbortSignal): Promise<DiscoveredEspnLeague[]> {
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
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    });

    console.log(`📡 Fan API Response: ${res.status} ${res.statusText}`);

    if (res.status === 401 || res.status === 403) {
      throw new EspnAuthenticationFailed('ESPN authentication failed');
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
  refreshed: number;
}

/**
 * Result from discoverHistoricalSeasons
 */
interface HistoricalResult {
  found: number;        // Seasons where user was a member
  added: number;        // Successfully added to DB
  alreadySaved: number; // Already existed in DB
  refreshed: number;    // Existing rows refreshed with latest ESPN metadata
}

/**
 * Result from discoverAndSaveLeagues
 */
export interface DiscoverAndSaveResult {
  discovered: DiscoveredLeague[];
  currentSeason: SeasonCounts;
  pastSeasons: SeasonCounts;
  savedLeagues?: DiscoveredEspnLeague[];
}

/**
 * Current-season discovery is deliberately separate from history planning.
 * The request path can safely return this result while a durable workflow
 * later decides which historical seasons still need work.
 */
export interface DiscoverAndSaveCurrentResult {
  discovered: DiscoveredLeague[];
  currentSeason: SeasonCounts;
  savedLeagues: DiscoveredEspnLeague[];
}

class EspnLeagueWriteLeaseLostError extends Error {}

export async function discoverAndSaveCurrentLeagues(
  userId: string,
  swid: string,
  s2: string,
  storage: EspnSupabaseStorage,
  leaseOwner?: string
): Promise<DiscoverAndSaveCurrentResult> {
  const leagues = await discoverLeaguesV3(swid, s2);

  const discovered: DiscoveredLeague[] = [];
  const currentSeason: SeasonCounts = { found: 0, added: 0, alreadySaved: 0, refreshed: 0 };
  const savedLeagues: DiscoveredEspnLeague[] = [];

  for (const league of leagues) {
    try {
      const sport = gameIdToSport(league.gameId);
      if (!sport) {
        console.warn(`Unknown gameId: ${league.gameId}`);
        continue;
      }

      const canonicalSeasonYear = toCanonicalYear(league.seasonId, sport, 'espn');
      currentSeason.found++;
      const updates = {
        leagueName: league.leagueName,
        teamId: String(league.teamId),
        teamName: league.teamName,
      };
      let saved = false;

      if (leaseOwner) {
        const outcome = await storage.persistLeagueWithLease(userId, leaseOwner, {
          leagueId: league.leagueId,
          sport: sport as 'football' | 'baseball' | 'basketball' | 'hockey',
          leagueName: league.leagueName,
          teamId: String(league.teamId),
          teamName: league.teamName,
          seasonYear: canonicalSeasonYear,
        });
        if (outcome === 'lease_lost') throw new EspnLeagueWriteLeaseLostError('ESPN refresh lease lost');
        if (outcome === 'added') {
          saved = true;
          currentSeason.added++;
        } else if (outcome === 'refreshed') {
          saved = true;
          currentSeason.refreshed++;
          currentSeason.alreadySaved++;
        }
      } else if (await storage.leagueExists(userId, sport, league.leagueId, canonicalSeasonYear)) {
        saved = await storage.updateLeague(userId, league.leagueId, sport, canonicalSeasonYear, updates);
        if (saved) currentSeason.refreshed++;
        currentSeason.alreadySaved++;
      } else {
        const added = await storage.addLeague(userId, {
          leagueId: league.leagueId,
          sport: sport as 'football' | 'baseball' | 'basketball' | 'hockey',
          leagueName: league.leagueName,
          teamId: String(league.teamId),
          teamName: league.teamName,
          seasonYear: canonicalSeasonYear,
        });
        if (added.success) {
          saved = true;
          currentSeason.added++;
        } else if (added.code === 'DUPLICATE') {
          // A concurrent request won the insert race. Treat it as an existing
          // current row only after the targeted refresh succeeds.
          saved = await storage.updateLeague(userId, league.leagueId, sport, canonicalSeasonYear, updates);
          currentSeason.alreadySaved++;
          if (saved) currentSeason.refreshed++;
        } else {
          console.error(`Failed to add league ${league.leagueId}:`, added.error);
        }
      }

      // A current-row write is the prerequisite for history. Do not leak a
      // failed write into the durable plan or the immediate UI response.
      if (!saved) continue;
      discovered.push({
        sport: sport as 'football' | 'baseball' | 'basketball' | 'hockey',
        leagueId: league.leagueId,
        leagueName: league.leagueName,
        teamId: String(league.teamId),
        teamName: league.teamName,
        seasonYear: canonicalSeasonYear,
      });
      savedLeagues.push(league);
    } catch (error) {
      if (error instanceof EspnLeagueWriteLeaseLostError) throw error;
      console.error(`Error processing league ${league.leagueId}:`, error);
    }
  }

  return { discovered, currentSeason, savedLeagues };
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
  storage: EspnSupabaseStorage,
  leaseOwner?: string
): Promise<DiscoverAndSaveResult> {
  const { discovered, currentSeason, savedLeagues } = await discoverAndSaveCurrentLeagues(
    userId, swid, s2, storage, leaseOwner
  );
  const pastSeasons: SeasonCounts = { found: 0, added: 0, alreadySaved: 0, refreshed: 0 };

  // 3. Discover historical seasons only after every current season is saved
  for (const league of savedLeagues) {
    try {
      const histResult = await discoverHistoricalSeasons(
        userId,
        league,
        swid,
        s2,
        storage,
        leaseOwner
      );
      pastSeasons.found += histResult.found;
      pastSeasons.added += histResult.added;
      pastSeasons.alreadySaved += histResult.alreadySaved;
      pastSeasons.refreshed += histResult.refreshed;
    } catch (error) {
      console.error(`Error discovering history for league ${league.leagueId}:`, error);
      continue;
    }
  }

  return {
    discovered,
    currentSeason,
    pastSeasons,
    savedLeagues,
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
  storage: EspnSupabaseStorage,
  leaseOwner?: string
): Promise<HistoricalResult> {
  const result: HistoricalResult = { found: 0, added: 0, alreadySaved: 0, refreshed: 0 };
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

    for (const canonicalYear of previousSeasons) {
      try {
        const espnYear = toPlatformYear(canonicalYear, sport, 'espn');

        // FIRST: Validate membership - only count if user was a member
        const teams = await getLeagueTeams(swid, s2, league.leagueId, espnYear, league.gameId);
        const historicalTeam = teams.find(t => t.teamId === String(league.teamId));

        if (!historicalTeam) {
          // User wasn't in this season - don't count it at all
          console.log(`Skipping season ${canonicalYear} for league ${league.leagueId}: teamId ${league.teamId} not found`);
          continue;
        }

        // User was a member - count it as found
        result.found++;

        if (leaseOwner) {
          const historicalInfo = await getLeagueInfoSafe(swid, s2, league.leagueId, espnYear, league.gameId);
          const outcome = await storage.persistLeagueWithLease(userId, leaseOwner, {
            leagueId: league.leagueId,
            sport: sport as 'football' | 'baseball' | 'basketball' | 'hockey',
            leagueName: historicalInfo?.leagueName || league.leagueName,
            teamId: historicalTeam.teamId,
            teamName: historicalTeam.teamName || league.teamName,
            seasonYear: canonicalYear,
          });
          if (outcome === 'lease_lost') throw new EspnLeagueWriteLeaseLostError('ESPN refresh lease lost');
          if (outcome === 'added') result.added++;
          if (outcome === 'refreshed') {
            result.alreadySaved++;
            result.refreshed++;
          }
          continue;
        }

        // Check if already saved (DB stores canonical year)
        const exists = await storage.leagueExists(userId, sport, league.leagueId, canonicalYear);
        if (exists) {
          // Heal prior bad writes where historical seasons inherited current-season metadata.
          const historicalInfo = await getLeagueInfoSafe(swid, s2, league.leagueId, espnYear, league.gameId);
          const updates = {
            ...(historicalInfo?.leagueName ? { leagueName: historicalInfo.leagueName } : {}),
            teamId: historicalTeam.teamId,
            teamName: historicalTeam.teamName || league.teamName,
          };
          const refreshed = await storage.updateLeague(userId, league.leagueId, sport, canonicalYear, updates);
          if (refreshed) {
            result.refreshed++;
          }
          result.alreadySaved++;
          continue;
        }

        // Get league info for historical season (for league name) using ESPN-native year.
        const historicalInfo = await getLeagueInfo(swid, s2, league.leagueId, espnYear, league.gameId);

        const addResult = await storage.addLeague(userId, {
          leagueId: league.leagueId,
          sport: sport as 'football' | 'baseball' | 'basketball' | 'hockey',
          leagueName: historicalInfo?.leagueName || league.leagueName,
          teamId: historicalTeam.teamId,
          teamName: historicalTeam.teamName || league.teamName,
          seasonYear: canonicalYear,
        });

        if (addResult.success) {
          result.added++;
        } else if (addResult.code !== 'DUPLICATE') {
          console.error(`Failed to add historical season ${canonicalYear} for league ${league.leagueId}:`, addResult.error);
        }

      } catch (seasonError) {
        if (seasonError instanceof EspnLeagueWriteLeaseLostError) throw seasonError;
        // Per-season error handling - continue with other seasons
        console.error(`Error fetching season ${canonicalYear} for league ${league.leagueId}:`, seasonError);
        continue;
      }
    }

  } catch (error) {
    if (error instanceof EspnLeagueWriteLeaseLostError) throw error;
    // If we can't get league info at all, just log and return
    console.error(`Failed to discover history for league ${league.leagueId}:`, error);
  }

  return result;
}
