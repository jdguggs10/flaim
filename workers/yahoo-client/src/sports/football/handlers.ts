import type { Env, ToolParams, ExecuteResponse } from '../../types';
import { getYahooCredentials } from '../../shared/auth';
import { yahooFetch, handleYahooError, requireCredentials } from '../../shared/yahoo-api';
import { asArray, getPath, unwrapLeague, unwrapTeam, logStructure } from '../../shared/normalizers';

type HandlerFn = (
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string
) => Promise<ExecuteResponse>;

export const footballHandlers: Record<string, HandlerFn> = {
  get_league_info: handleGetLeagueInfo,
  get_standings: handleGetStandings,
  get_roster: handleGetRoster,
};

function extractErrorCode(error: unknown): string {
  if (error instanceof Error) {
    const match = error.message.match(/^([A-Z_]+):/);
    if (match) return match[1];
  }
  return 'INTERNAL_ERROR';
}

async function handleGetLeagueInfo(
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  const { league_id } = params;

  try {
    const credentials = await getYahooCredentials(env, authHeader, correlationId);
    requireCredentials(credentials, 'get_league_info');

    const response = await yahooFetch(`/league/${league_id}`, { credentials });

    if (!response.ok) {
      handleYahooError(response);
    }

    const raw = await response.json();
    logStructure('get_league_info raw', raw);

    const leagueArray = getPath(raw, ['fantasy_content', 'league']);
    const league = unwrapLeague(leagueArray);

    return {
      success: true,
      data: {
        leagueKey: league.league_key,
        leagueId: league.league_id,
        name: league.name,
        url: league.url,
        numTeams: league.num_teams,
        scoringType: league.scoring_type,
        currentWeek: league.current_week,
        startWeek: league.start_week,
        endWeek: league.end_week,
        isFinished: league.is_finished === 1,
        draftStatus: league.draft_status,
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: extractErrorCode(error)
    };
  }
}

async function handleGetStandings(
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  const { league_id } = params;

  try {
    const credentials = await getYahooCredentials(env, authHeader, correlationId);
    requireCredentials(credentials, 'get_standings');

    const response = await yahooFetch(`/league/${league_id}/standings`, { credentials });

    if (!response.ok) {
      handleYahooError(response);
    }

    const raw = await response.json();
    logStructure('get_standings raw', raw);

    const leagueArray = getPath(raw, ['fantasy_content', 'league']);
    const league = unwrapLeague(leagueArray);

    const teamsObj = getPath(league, ['standings', 0, 'teams']) as Record<string, unknown> | undefined;
    const teamsArray = asArray(teamsObj);

    const standings = teamsArray.map((teamWrapper: unknown) => {
      const teamData = getPath(teamWrapper, ['team']) as unknown[];
      const team = unwrapTeam(teamData);
      const teamStandings = team.team_standings as Record<string, unknown> | undefined;
      const outcomeTotals = teamStandings?.outcome_totals as Record<string, unknown> | undefined;

      return {
        rank: teamStandings?.rank,
        teamKey: team.team_key,
        teamId: team.team_id,
        name: team.name,
        wins: outcomeTotals?.wins,
        losses: outcomeTotals?.losses,
        ties: outcomeTotals?.ties,
        percentage: outcomeTotals?.percentage,
        pointsFor: teamStandings?.points_for,
        pointsAgainst: teamStandings?.points_against,
      };
    });

    return {
      success: true,
      data: {
        leagueKey: league.league_key,
        leagueName: league.name,
        standings: standings.sort((a, b) => Number(a.rank) - Number(b.rank))
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: extractErrorCode(error)
    };
  }
}

async function handleGetRoster(
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  const { team_id, week } = params;

  if (!team_id) {
    return {
      success: false,
      error: 'team_id is required for get_roster',
      code: 'MISSING_PARAM'
    };
  }

  try {
    const credentials = await getYahooCredentials(env, authHeader, correlationId);
    requireCredentials(credentials, 'get_roster');

    const weekParam = week ? `;week=${week}` : '';
    const response = await yahooFetch(`/team/${team_id}/roster${weekParam}`, { credentials });

    if (!response.ok) {
      handleYahooError(response);
    }

    const raw = await response.json();
    logStructure('get_roster raw', raw);

    const teamArray = getPath(raw, ['fantasy_content', 'team']);
    const team = unwrapTeam(teamArray as unknown[]);

    const rosterData = team.roster as Record<string, unknown> | undefined;
    const playersObj = getPath(rosterData, ['0', 'players']) as Record<string, unknown> | undefined;
    const playersArray = asArray(playersObj);

    const players = playersArray.map((playerWrapper: unknown) => {
      const playerData = getPath(playerWrapper, ['player']) as unknown[];

      const metaArray = playerData?.[0] as unknown[];
      let playerMeta: Record<string, unknown> = {};
      if (Array.isArray(metaArray)) {
        for (const item of metaArray) {
          if (typeof item === 'object' && item !== null) {
            playerMeta = { ...playerMeta, ...item };
          }
        }
      }

      const positionData = playerData?.[1] as Record<string, unknown> | undefined;
      const selectedPosition = positionData?.selected_position as Record<string, unknown>[] | undefined;
      const position = selectedPosition?.[1]?.position;

      return {
        playerKey: playerMeta.player_key,
        playerId: playerMeta.player_id,
        name: (playerMeta.name as Record<string, unknown>)?.full,
        team: playerMeta.editorial_team_abbr,
        position: playerMeta.display_position,
        selectedPosition: position,
        status: playerMeta.status,
      };
    });

    return {
      success: true,
      data: {
        teamKey: team.team_key,
        teamName: team.name,
        week: week || 'current',
        players
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      code: extractErrorCode(error)
    };
  }
}
