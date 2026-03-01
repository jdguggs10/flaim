import type { Env, ToolParams, ExecuteResponse, SleeperLeague, SleeperRoster, SleeperMatchup, SleeperLeagueUser } from '../../types';
import { sleeperFetch, handleSleeperError } from '../../shared/sleeper-api';
import { fetchSleeperTransactionsByWeeks, getSleeperCurrentWeek } from '../../shared/sleeper-transactions';
import { getSleeperPlayersIndex } from '../../shared/sleeper-players-cache';
import { createSleeperGetFreeAgentsHandler } from '../../shared/sleeper-free-agents-handler';
import { buildSleeperPlayerSearch } from '../../shared/sleeper-free-agents';
import { extractErrorCode } from '@flaim/worker-shared';

type HandlerFn = (
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string
) => Promise<ExecuteResponse>;

const handleGetFreeAgents = createSleeperGetFreeAgentsHandler('basketball');

export const basketballHandlers: Record<string, HandlerFn> = {
  get_league_info: handleGetLeagueInfo,
  get_standings: handleGetStandings,
  get_roster: handleGetRoster,
  get_matchups: handleGetMatchups,
  get_free_agents: handleGetFreeAgents,
  get_transactions: handleGetTransactions,
  search_players: handleSearchPlayers,
};

async function handleSearchPlayers(
  env: Env,
  params: ToolParams,
): Promise<ExecuteResponse> {
  const { query, position, count } = params;

  if (!query) {
    return { success: false, error: 'query is required for search_players', code: 'MISSING_PARAM' };
  }

  try {
    const requestedCount = Math.max(1, Math.min(25, Math.trunc(Number.isFinite(Number(count)) ? Number(count) : 10)));
    const playersIndex = await getSleeperPlayersIndex(env, 'basketball');
    const players = buildSleeperPlayerSearch(playersIndex, query, position, requestedCount);

    return {
      success: true,
      data: {
        platform: 'sleeper',
        sport: params.sport,
        query,
        count: players.length,
        players,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: extractErrorCode(error),
    };
  }
}

// Handlers are identical to football except get_matchups uses /state/nba
// for the default week. Since Sleeper's league/roster/matchup endpoints
// are sport-agnostic (keyed by league_id), the logic is the same.

async function handleGetLeagueInfo(
  _env: Env,
  params: ToolParams,
): Promise<ExecuteResponse> {
  const { league_id } = params;

  try {
    const response = await sleeperFetch(`/league/${league_id}`);
    if (!response.ok) handleSleeperError(response);
    const league: SleeperLeague = await response.json();

    return {
      success: true,
      data: {
        leagueId: league.league_id,
        name: league.name,
        sport: league.sport,
        season: league.season,
        status: league.status,
        totalRosters: league.total_rosters,
        rosterPositions: league.roster_positions,
        scoringSettings: league.scoring_settings,
        previousLeagueId: league.previous_league_id,
        draftId: league.draft_id,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: extractErrorCode(error),
    };
  }
}

async function handleGetStandings(
  _env: Env,
  params: ToolParams,
): Promise<ExecuteResponse> {
  const { league_id } = params;

  try {
    const [rostersRes, usersRes] = await Promise.all([
      sleeperFetch(`/league/${league_id}/rosters`),
      sleeperFetch(`/league/${league_id}/users`),
    ]);

    if (!rostersRes.ok) handleSleeperError(rostersRes);
    if (!usersRes.ok) handleSleeperError(usersRes);

    const rosters: SleeperRoster[] = await rostersRes.json();
    const users: SleeperLeagueUser[] = await usersRes.json();

    const userMap = new Map<string, string>();
    for (const user of users) {
      userMap.set(user.user_id, user.display_name);
    }

    const standings = rosters
      .map((roster) => {
        const { wins, losses, ties, fpts, fpts_decimal, fpts_against, fpts_against_decimal } = roster.settings;
        const pointsFor = fpts + (fpts_decimal ?? 0) / 100;
        const pointsAgainst = (fpts_against ?? 0) + (fpts_against_decimal ?? 0) / 100;
        const totalGames = wins + losses + ties;
        const winPct = totalGames > 0 ? wins / totalGames : 0;

        return {
          rosterId: roster.roster_id,
          ownerId: roster.owner_id,
          ownerName: userMap.get(roster.owner_id) ?? 'Unknown',
          wins, losses, ties,
          winPercentage: Math.round(winPct * 1000) / 1000,
          pointsFor: Math.round(pointsFor * 100) / 100,
          pointsAgainst: Math.round(pointsAgainst * 100) / 100,
        };
      })
      .sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        return b.pointsFor - a.pointsFor;
      })
      .map((entry, index) => ({ ...entry, rank: index + 1 }));

    return { success: true, data: { leagueId: league_id, standings } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: extractErrorCode(error),
    };
  }
}

async function handleGetRoster(
  _env: Env,
  params: ToolParams,
): Promise<ExecuteResponse> {
  const { league_id, team_id } = params;

  try {
    const [rostersRes, usersRes] = await Promise.all([
      sleeperFetch(`/league/${league_id}/rosters`),
      sleeperFetch(`/league/${league_id}/users`),
    ]);

    if (!rostersRes.ok) handleSleeperError(rostersRes);
    if (!usersRes.ok) handleSleeperError(usersRes);

    const rosters: SleeperRoster[] = await rostersRes.json();
    const users: SleeperLeagueUser[] = await usersRes.json();

    let roster: SleeperRoster | undefined;
    if (team_id) {
      roster = rosters.find((r) => String(r.roster_id) === team_id || r.owner_id === team_id);
    } else {
      const userMap = new Map<string, string>();
      for (const user of users) {
        userMap.set(user.user_id, user.display_name);
      }
      return {
        success: true,
        data: {
          leagueId: league_id,
          rosters: rosters.map((r) => ({
            rosterId: r.roster_id,
            ownerId: r.owner_id,
            ownerName: userMap.get(r.owner_id) ?? 'Unknown',
            playerCount: r.players?.length ?? 0,
            starterCount: r.starters?.length ?? 0,
          })),
        },
      };
    }

    if (!roster) {
      return { success: false, error: `Roster not found for team_id: ${team_id}`, code: 'SLEEPER_NOT_FOUND' };
    }

    const owner = users.find((u) => u.user_id === roster!.owner_id);
    const starters = roster.starters ?? [];
    const allPlayers = roster.players ?? [];
    const reserve = roster.reserve ?? [];
    const bench = allPlayers.filter((p) => !starters.includes(p) && !reserve.includes(p));

    return {
      success: true,
      data: {
        leagueId: league_id,
        rosterId: roster.roster_id,
        ownerId: roster.owner_id,
        ownerName: owner?.display_name ?? 'Unknown',
        starters, bench, reserve,
        record: { wins: roster.settings.wins, losses: roster.settings.losses, ties: roster.settings.ties },
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: extractErrorCode(error),
    };
  }
}

async function handleGetMatchups(
  _env: Env,
  params: ToolParams,
): Promise<ExecuteResponse> {
  const { league_id, week } = params;

  try {
    let matchupWeek = week;
    if (!matchupWeek) {
      const stateRes = await sleeperFetch('/state/nba');
      if (stateRes.ok) {
        const state = await stateRes.json() as { week: number };
        matchupWeek = state.week;
      } else {
        matchupWeek = 1;
      }
    }

    const [matchupsRes, rostersRes, usersRes] = await Promise.all([
      sleeperFetch(`/league/${league_id}/matchups/${matchupWeek}`),
      sleeperFetch(`/league/${league_id}/rosters`),
      sleeperFetch(`/league/${league_id}/users`),
    ]);

    if (!matchupsRes.ok) handleSleeperError(matchupsRes);
    if (!rostersRes.ok) handleSleeperError(rostersRes);
    if (!usersRes.ok) handleSleeperError(usersRes);

    const matchups: SleeperMatchup[] = await matchupsRes.json();
    const rosters: SleeperRoster[] = await rostersRes.json();
    const users: SleeperLeagueUser[] = await usersRes.json();

    const rosterOwnerMap = new Map<number, string>();
    const userMap = new Map<string, string>();
    for (const user of users) { userMap.set(user.user_id, user.display_name); }
    for (const roster of rosters) { rosterOwnerMap.set(roster.roster_id, userMap.get(roster.owner_id) ?? 'Unknown'); }

    const matchupGroups = new Map<number, SleeperMatchup[]>();
    for (const m of matchups) {
      if (!matchupGroups.has(m.matchup_id)) matchupGroups.set(m.matchup_id, []);
      matchupGroups.get(m.matchup_id)!.push(m);
    }

    const pairedMatchups = Array.from(matchupGroups.entries()).map(([matchupId, pair]) => {
      const formatTeam = (m: SleeperMatchup) => ({
        rosterId: m.roster_id,
        ownerName: rosterOwnerMap.get(m.roster_id) ?? 'Unknown',
        points: m.points ?? 0,
        starters: m.starters ?? [],
      });

      const home = pair[0] ? formatTeam(pair[0]) : null;
      const away = pair[1] ? formatTeam(pair[1]) : null;

      let winner: string | undefined;
      if (home && away && (home.points > 0 || away.points > 0)) {
        if (home.points > away.points) winner = 'home';
        else if (away.points > home.points) winner = 'away';
        else winner = 'tie';
      }

      return { matchupId, home, away, winner };
    });

    return { success: true, data: { leagueId: league_id, week: matchupWeek, matchups: pairedMatchups } };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: extractErrorCode(error),
    };
  }
}

async function handleGetTransactions(
  env: Env,
  params: ToolParams,
): Promise<ExecuteResponse> {
  const { league_id, week, count, type } = params;

  try {
    const currentWeek = week || await getSleeperCurrentWeek('/state/nba');
    const weeks = week ? [Math.max(1, week)] : Array.from(new Set([currentWeek, Math.max(1, currentWeek - 1)]));
    const rawCount = Number.isFinite(Number(count)) ? Number(count) : 25;
    const maxCount = Math.max(1, Math.min(100, Math.trunc(rawCount)));

    let resolvePlayer:
      | ((playerId: string) => { name?: string; position?: string; team?: string } | undefined)
      | undefined;

    try {
      const playersIndex = await getSleeperPlayersIndex(env, 'basketball');
      resolvePlayer = (playerId) => {
        const player = playersIndex.get(playerId);
        if (!player) return undefined;
        return {
          name: player.full_name,
          position: player.position,
          team: player.team,
        };
      };
    } catch (error) {
      console.error('[handleGetTransactions] Failed to get player index for enrichment:', error);
      resolvePlayer = undefined;
    }

    const rows = await fetchSleeperTransactionsByWeeks(league_id, weeks, resolvePlayer);
    const filtered = rows
      .filter((txn) => !type || txn.type === type)
      .slice(0, maxCount);

    return {
      success: true,
      data: {
        platform: 'sleeper',
        sport: params.sport,
        league_id,
        season_year: params.season_year,
        window: {
          mode: week ? 'explicit_week' : 'recent_two_weeks',
          weeks,
        },
        count: filtered.length,
        transactions: filtered,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: extractErrorCode(error),
    };
  }
}
