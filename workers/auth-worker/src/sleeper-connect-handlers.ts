import { SleeperStorage, type SleeperLeague } from './sleeper-storage';
import { getDefaultSeasonYear } from './season-utils';

const SLEEPER_API = 'https://api.sleeper.app/v1';
const MAX_HISTORY_YEARS = 5;

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

interface RecurringLeagueResolutionResult {
  recurringLeagueId?: string;
  failureReason?: string;
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

function cacheSleeperLeague(
  leagueCache: Map<string, Promise<SleeperApiLeague>>,
  league: SleeperApiLeague
): void {
  leagueCache.set(league.league_id, Promise.resolve(league));
}

async function getSleeperLeague(
  leagueId: string,
  leagueCache: Map<string, Promise<SleeperApiLeague>>
): Promise<SleeperApiLeague> {
  const cached = leagueCache.get(leagueId);
  if (cached) {
    return cached;
  }

  const request = sleeperGet<SleeperApiLeague>(`/league/${leagueId}`);
  leagueCache.set(leagueId, request);
  return request;
}

function describeSleeperResolutionFailure(leagueId: string, error: unknown): string {
  if (error instanceof Error) {
    const statusMatch = error.message.match(/Sleeper API (\d{3}):/);
    if (statusMatch) {
      return `Sleeper API ${statusMatch[1]} while resolving ${leagueId}`;
    }
    return `${error.message} while resolving ${leagueId}`;
  }
  return `unknown error while resolving ${leagueId}`;
}

async function tryResolveRecurringLeagueId(
  leagueId: string,
  cache: Map<string, string | null>,
  leagueCache: Map<string, Promise<SleeperApiLeague>>
): Promise<RecurringLeagueResolutionResult> {
  const path: string[] = [];
  const visited = new Set<string>();
  let currentLeagueId: string | null = leagueId;

  while (currentLeagueId) {
    if (cache.has(currentLeagueId)) {
      const cached = cache.get(currentLeagueId) ?? null;
      for (const pathLeagueId of path) {
        cache.set(pathLeagueId, cached);
      }

      return cached
        ? { recurringLeagueId: cached }
        : { failureReason: `unresolved recurring chain at ${currentLeagueId}` };
    }

    if (visited.has(currentLeagueId)) {
      for (const pathLeagueId of path) {
        cache.set(pathLeagueId, null);
      }
      return { failureReason: `detected recurring league cycle at ${currentLeagueId}` };
    }

    visited.add(currentLeagueId);
    path.push(currentLeagueId);

    try {
      const league = await getSleeperLeague(currentLeagueId, leagueCache);
      if (!league.previous_league_id) {
        for (const pathLeagueId of path) {
          cache.set(pathLeagueId, league.league_id);
        }
        return { recurringLeagueId: league.league_id };
      }

      currentLeagueId = league.previous_league_id;
    } catch (error) {
      const failureReason = describeSleeperResolutionFailure(currentLeagueId, error);
      for (const pathLeagueId of path) {
        cache.set(pathLeagueId, null);
      }
      return { failureReason };
    }
  }

  return { failureReason: `unresolved recurring chain at ${leagueId}` };
}

async function resolveRecurringLeagueId(
  leagueId: string,
  cache: Map<string, string | null>,
  leagueCache: Map<string, Promise<SleeperApiLeague>>
): Promise<string> {
  const resolution = await tryResolveRecurringLeagueId(leagueId, cache, leagueCache);
  if (resolution.recurringLeagueId) {
    return resolution.recurringLeagueId;
  }

  console.warn(
    `[sleeper-connect] Falling back to season-scoped leagueId ${leagueId} for recurring grouping: ${resolution.failureReason ?? 'unresolved recurring chain'}`
  );
  return leagueId;
}

async function buildSleeperLeagueResponse(leagues: SleeperLeague[]): Promise<SleeperLeagueResponse[]> {
  const recurringIdCache = new Map<string, string | null>();
  const leagueCache = new Map<string, Promise<SleeperApiLeague>>();
  for (const league of leagues) {
    if (league.recurringLeagueId) {
      recurringIdCache.set(league.leagueId, league.recurringLeagueId);
      recurringIdCache.set(league.recurringLeagueId, league.recurringLeagueId);
    }
  }

  return Promise.all(leagues.map(async (league) => {
    const recurringLeagueId = league.recurringLeagueId
      ?? await resolveRecurringLeagueId(league.leagueId, recurringIdCache, leagueCache);

    return {
      id: league.id,
      sport: league.sport,
      leagueId: league.leagueId,
      leagueName: league.leagueName,
      rosterId: league.rosterId,
      seasonYear: league.seasonYear,
      recurringLeagueId,
    };
  }));
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
    const recurringIdCache = new Map<string, string | null>();
    const leagueCache = new Map<string, Promise<SleeperApiLeague>>();
    const processedLeagueIds = new Set<string>();

    // Process each league and traverse history chain
    async function processLeague(league: SleeperApiLeague, recurringLeagueId: string | undefined, depth = 0): Promise<void> {
      if (depth >= MAX_HISTORY_YEARS || processedLeagueIds.has(league.league_id)) return;

      processedLeagueIds.add(league.league_id);
      cacheSleeperLeague(leagueCache, league);

      // Find user's roster_id in this league
      let rosterId: number | null = null;
      try {
        const rosters = await sleeperGet<SleeperApiRoster[]>(`/league/${league.league_id}/rosters`);
        const userRoster = rosters?.find((r) => r.owner_id === sleeperUserId);
        rosterId = userRoster?.roster_id ?? null;
      } catch (error) {
        console.warn(
          `[sleeper-connect] Failed to load rosters for ${league.league_id}; saving without rosterId: ${describeSleeperResolutionFailure(league.league_id, error)}`
        );
      }

      const leagueToSave: Parameters<SleeperStorage['saveSleeperLeague']>[0] = {
        clerkUserId: userId,
        leagueId: league.league_id,
        sport: mapSport(league.sport),
        seasonYear: parseInt(league.season, 10) || getDefaultSeasonYear('football'),
        leagueName: league.name,
        rosterId,
        sleeperUserId: sleeperUserId,
      };
      if (recurringLeagueId) {
        leagueToSave.recurringLeagueId = recurringLeagueId;
      }

      await storage.saveSleeperLeague(leagueToSave);
      totalSaved++;
      seasonsDiscovered.add(league.season);

      // Traverse previous season
      if (league.previous_league_id) {
        try {
          const prevLeague = await getSleeperLeague(league.previous_league_id, leagueCache);
          if (prevLeague?.league_id) {
            await processLeague(prevLeague, recurringLeagueId, depth + 1);
          }
        } catch (error) {
          console.warn(
            `[sleeper-connect] Failed to traverse previous league ${league.previous_league_id} from ${league.league_id}: ${describeSleeperResolutionFailure(league.previous_league_id, error)}`
          );
        }
      }
    }

    await Promise.all(currentLeagues.map(async (league) => {
      cacheSleeperLeague(leagueCache, league);
      const resolution = await tryResolveRecurringLeagueId(league.league_id, recurringIdCache, leagueCache);
      if (!resolution.recurringLeagueId) {
        console.warn(
          `[sleeper-connect] Discovery could not persist recurringLeagueId for ${league.league_id}: ${resolution.failureReason ?? 'unresolved recurring chain'}`
        );
      }
      await processLeague(league, resolution.recurringLeagueId);
    }));

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
