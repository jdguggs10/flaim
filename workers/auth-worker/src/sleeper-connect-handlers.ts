import { SleeperStorage } from './sleeper-storage';
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
    let sleeperUser: SleeperApiUser | null = null;
    try {
      sleeperUser = await sleeperGet<SleeperApiUser>(`/user/${username}`);
    } catch {
      // Sleeper returns null for unknown users, but catch any API errors too
    }
    if (!sleeperUser?.user_id) {
      return new Response(JSON.stringify({ error: 'Sleeper user not found. Check the username and try again.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // TypeScript narrowing: sleeperUser is confirmed non-null with a valid user_id beyond this point
    const confirmedUser = sleeperUser;

    const storage = SleeperStorage.fromEnvironment(env);
    await storage.saveSleeperConnection(userId, confirmedUser.user_id, confirmedUser.username ?? username);

    // Discover leagues for current season (NFL + NBA)
    const [nflLeagues, nbaLeagues] = await Promise.all([
      sleeperGet<SleeperApiLeague[]>(`/user/${confirmedUser.user_id}/leagues/nfl/${getDefaultSeasonYear('football')}`).catch(() => [] as SleeperApiLeague[]),
      sleeperGet<SleeperApiLeague[]>(`/user/${confirmedUser.user_id}/leagues/nba/${getDefaultSeasonYear('basketball')}`).catch(() => [] as SleeperApiLeague[]),
    ]);

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
        const userRoster = rosters?.find((r) => r.owner_id === confirmedUser.user_id);
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
        sleeperUserId: confirmedUser.user_id,
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
        success: true,
        username: confirmedUser.username ?? username,
        leagues_found: totalSaved,
        seasons_discovered: seasonsDiscovered.size,
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
    return new Response(
      JSON.stringify({
        leagues: leagues.map((l) => ({
          id: l.id,
          sport: l.sport,
          leagueId: l.leagueId,
          leagueName: l.leagueName,
          rosterId: l.rosterId,
          seasonYear: l.seasonYear,
        })),
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
    return new Response(
      JSON.stringify({
        success: true,
        leagues: leagues.map((l) => ({
          id: l.id,
          sport: l.sport,
          leagueId: l.leagueId,
          leagueName: l.leagueName,
          rosterId: l.rosterId,
          seasonYear: l.seasonYear,
        })),
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
