import { SleeperStorage, type SleeperLeague } from './sleeper-storage';
import { getDefaultSeasonYear } from './season-utils';

const SLEEPER_API = 'https://api.sleeper.app/v1';
const MAX_HISTORY_YEARS = 5;
const MAX_RECURRING_CHAIN_DEPTH = 25;

export interface SleeperConnectEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

interface SleeperApiUser {
  user_id: string;
  username: string | null;
  display_name: string | null;
}

interface SleeperApiLeague {
  league_id: string;
  name: string;
  sport: string;
  season: string;
  previous_league_id: string | null;
}

interface SleeperApiRoster {
  roster_id: number;
  owner_id: string;
}

interface SleeperLeagueResponse {
  id: string;
  sport: string;
  leagueId: string;
  leagueName: string;
  rosterId: number | null;
  seasonYear: number;
  recurringLeagueId: string;
}

function mapSport(sleeperSport: string): string {
  if (sleeperSport === 'nfl') return 'football';
  if (sleeperSport === 'nba') return 'basketball';
  return sleeperSport;
}

async function sleeperGet<T>(path: string): Promise<T> {
  const res = await fetch(`${SLEEPER_API}${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'flaim-auth-worker/1.0' },
  });
  if (!res.ok) throw new Error(`Sleeper API ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

async function resolveRecurringLeagueId(
  leagueId: string,
  cache: Map<string, string>,
  depth = 0,
  visited = new Set<string>()
): Promise<string> {
  const cached = cache.get(leagueId);
  if (cached) return cached;

  if (depth >= MAX_RECURRING_CHAIN_DEPTH || visited.has(leagueId)) {
    cache.set(leagueId, leagueId);
    return leagueId;
  }

  visited.add(leagueId);

  try {
    const league = await sleeperGet<SleeperApiLeague>(`/league/${leagueId}`);
    if (!league.previous_league_id) {
      cache.set(leagueId, leagueId);
      return leagueId;
    }

    const recurringLeagueId = await resolveRecurringLeagueId(league.previous_league_id, cache, depth + 1, visited);
    cache.set(leagueId, recurringLeagueId);
    return recurringLeagueId;
  } catch (error) {
    console.warn(`[sleeper-connect] Failed to resolve recurring league for ${leagueId}:`, error);
    cache.set(leagueId, leagueId);
    return leagueId;
  }
}

async function buildSleeperLeagueResponse(leagues: SleeperLeague[]): Promise<SleeperLeagueResponse[]> {
  const recurringIdCache = new Map<string, string>();
  const responseLeagues: SleeperLeagueResponse[] = [];

  // Process sequentially so chain resolution can reuse cached roots from newer seasons.
  for (const league of leagues) {
    const recurringLeagueId = await resolveRecurringLeagueId(league.leagueId, recurringIdCache);
    responseLeagues.push({
      id: league.id,
      sport: league.sport,
      leagueId: league.leagueId,
      leagueName: league.leagueName,
      rosterId: league.rosterId,
      seasonYear: league.seasonYear,
      recurringLeagueId,
    });
  }

  return responseLeagues;
}

export async function handleSleeperDiscover(
  request: Request,
  env: SleeperConnectEnv,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const body = await request.json() as { username?: string };
    const username = body?.username?.trim();
    if (!username) {
      return new Response(JSON.stringify({ error: 'username is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Resolve username → user_id
    // Sleeper returns HTTP 200 with null body for unknown usernames; throws on 429/5xx
    const sleeperUser = await sleeperGet<SleeperApiUser | null>(`/user/${username}`);
    if (!sleeperUser || !sleeperUser.user_id) {
      return new Response(JSON.stringify({ error: 'Sleeper user not found. Check the username and try again.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Capture as consts so TypeScript retains the non-null narrowing inside closures
    const sleeperUserId = sleeperUser.user_id;
    const sleeperUsername = sleeperUser.username;

    const storage = SleeperStorage.fromEnvironment(env);
    await storage.saveSleeperConnection(userId, sleeperUserId, sleeperUsername ?? username);

    // Discover leagues for current season (NFL + NBA)
    // Use allSettled so a failure in one sport doesn't discard the other
    const [nflResult, nbaResult] = await Promise.allSettled([
      sleeperGet<SleeperApiLeague[]>(`/user/${sleeperUserId}/leagues/nfl/${getDefaultSeasonYear('football')}`),
      sleeperGet<SleeperApiLeague[]>(`/user/${sleeperUserId}/leagues/nba/${getDefaultSeasonYear('basketball')}`),
    ]);
    const nflLeagues = nflResult.status === 'fulfilled' ? nflResult.value : [];
    const nbaLeagues = nbaResult.status === 'fulfilled' ? nbaResult.value : [];
    const hadFetchErrors = nflResult.status === 'rejected' || nbaResult.status === 'rejected';

    const currentLeagues = [...(nflLeagues ?? []), ...(nbaLeagues ?? [])];
    let totalSaved = 0;
    const seasonsDiscovered = new Set<string>();

    // Process each league and traverse history chain
    async function processLeague(league: SleeperApiLeague, depth = 0): Promise<void> {
      if (depth >= MAX_HISTORY_YEARS) return;

      // Find user's roster_id in this league
      let rosterId: number | null = null;
      try {
        const rosters = await sleeperGet<SleeperApiRoster[]>(`/league/${league.league_id}/rosters`);
        const userRoster = rosters?.find((r) => r.owner_id === sleeperUserId);
        rosterId = userRoster?.roster_id ?? null;
      } catch {
        // Non-fatal: save without roster_id
      }

      await storage.saveSleeperLeague({
        clerkUserId: userId,
        leagueId: league.league_id,
        sport: mapSport(league.sport),
        seasonYear: parseInt(league.season, 10) || getDefaultSeasonYear('football'),
        leagueName: league.name,
        rosterId,
        sleeperUserId: sleeperUserId,
      });
      totalSaved++;
      seasonsDiscovered.add(league.season);

      // Traverse previous season
      if (league.previous_league_id) {
        try {
          const prevLeague = await sleeperGet<SleeperApiLeague>(`/league/${league.previous_league_id}`);
          if (prevLeague?.league_id) {
            await processLeague(prevLeague, depth + 1);
          }
        } catch {
          // Non-fatal: history traversal best-effort
        }
      }
    }

    await Promise.all(currentLeagues.map((league) => processLeague(league)));

    return new Response(
      JSON.stringify({
        success: totalSaved > 0 || !hadFetchErrors,
        username: sleeperUsername ?? username,
        leagues_found: totalSaved,
        seasons_discovered: seasonsDiscovered.size,
        ...(hadFetchErrors && totalSaved === 0 ? { warning: 'Some league data could not be fetched. Try reconnecting later.' } : {}),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[handleSleeperDiscover]', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Discovery failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

export async function handleSleeperStatus(
  env: SleeperConnectEnv,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const storage = SleeperStorage.fromEnvironment(env);
    const connection = await storage.getSleeperConnection(userId);
    if (!connection) {
      return new Response(JSON.stringify({ connected: false }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const leagues = await storage.getSleeperLeagues(userId);
    return new Response(
      JSON.stringify({
        connected: true,
        sleeperUserId: connection.sleeperUserId,
        sleeperUsername: connection.sleeperUsername,
        leagueCount: leagues.length,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[handleSleeperStatus]', error);
    return new Response(
      JSON.stringify({ error: 'Failed to get status' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

export async function handleSleeperDisconnect(
  env: SleeperConnectEnv,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const storage = SleeperStorage.fromEnvironment(env);
    await storage.deleteSleeperConnection(userId);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[handleSleeperDisconnect]', error);
    return new Response(
      JSON.stringify({ error: 'Failed to disconnect' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

export async function handleSleeperLeagues(
  env: SleeperConnectEnv,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const storage = SleeperStorage.fromEnvironment(env);
    const leagues = await storage.getSleeperLeagues(userId);
    const responseLeagues = await buildSleeperLeagueResponse(leagues);
    return new Response(
      JSON.stringify({
        leagues: responseLeagues,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[handleSleeperLeagues]', error);
    return new Response(
      JSON.stringify({ error: 'Failed to get leagues' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}

export async function handleSleeperLeagueDelete(
  env: SleeperConnectEnv,
  userId: string,
  leagueId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const storage = SleeperStorage.fromEnvironment(env);
    await storage.deleteSleeperLeague(userId, leagueId);
    const leagues = await storage.getSleeperLeagues(userId);
    const responseLeagues = await buildSleeperLeagueResponse(leagues);
    return new Response(
      JSON.stringify({
        success: true,
        leagues: responseLeagues,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[handleSleeperLeagueDelete]', error);
    return new Response(
      JSON.stringify({ error: 'Failed to delete league' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}
