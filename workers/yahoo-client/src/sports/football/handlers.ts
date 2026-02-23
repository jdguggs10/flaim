import type { Env, ToolParams, ExecuteResponse } from '../../types';
import { getYahooCredentials } from '../../shared/auth';
import { yahooFetch, handleYahooError, requireCredentials } from '../../shared/yahoo-api';
import { asArray, getPath, unwrapLeague, unwrapTeam, logStructure } from '../../shared/normalizers';
import { buildYahooTransactionsPath, normalizeYahooTransactions } from '../../shared/yahoo-transactions';
import { getPositionFilter } from './mappings';
import { extractErrorCode } from '@flaim/worker-shared';

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
  get_matchups: handleGetMatchups,
  get_free_agents: handleGetFreeAgents,
  get_transactions: handleGetTransactions,
};

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
  const { team_id, league_id, week } = params;

  if (!team_id) {
    return {
      success: false,
      error: 'team_id is required for get_roster',
      code: 'MISSING_PARAM'
    };
  }

  // Yahoo API requires full team key (e.g., "461.l.12345.t.10"), not just "10"
  const teamKey = team_id.includes('.') ? team_id : `${league_id}.t.${team_id}`;

  try {
    const credentials = await getYahooCredentials(env, authHeader, correlationId);
    requireCredentials(credentials, 'get_roster');

    const weekParam = week ? `;week=${week}` : '';
    const response = await yahooFetch(`/team/${teamKey}/roster${weekParam}`, { credentials });

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

/**
 * Get league matchups/scoreboard for a week
 */
async function handleGetMatchups(
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  const { league_id, week } = params;

  try {
    const credentials = await getYahooCredentials(env, authHeader, correlationId);
    requireCredentials(credentials, 'get_matchups');

    // Yahoo uses semicolon params: /league/{key}/scoreboard;week=N
    const weekParam = week ? `;week=${week}` : '';
    const response = await yahooFetch(`/league/${league_id}/scoreboard${weekParam}`, { credentials });

    if (!response.ok) {
      handleYahooError(response);
    }

    const raw = await response.json();
    logStructure('get_matchups raw', raw);

    // Navigate: fantasy_content.league[0]=meta, [1]=scoreboard
    const leagueArray = getPath(raw, ['fantasy_content', 'league']);
    const league = unwrapLeague(leagueArray);

    // Get current week from league metadata
    const currentWeek = league.current_week as number | undefined;

    // scoreboard.matchups is numeric-keyed object
    const scoreboardData = league.scoreboard as Record<string, unknown> | undefined;
    const matchupsObj = getPath(scoreboardData, ['0', 'matchups']) as Record<string, unknown> | undefined;
    const matchupsArray = asArray(matchupsObj);

    const matchups = matchupsArray.map((matchupWrapper: unknown, index: number) => {
      // Yahoo structure: {matchup: {"0": {teams: {...}}}}
      // matchup is a numeric-keyed object, not an array
      const matchupObj = getPath(matchupWrapper, ['matchup']) as Record<string, unknown> | undefined;

      // Get the first (and usually only) matchup content via numeric key "0"
      const matchupContent = matchupObj?.['0'] as Record<string, unknown> | undefined;

      // Teams are inside matchupContent
      const teamsObj = matchupContent?.teams as Record<string, unknown> | undefined;
      const teamsArray = asArray(teamsObj);

      // Parse the two teams (home = index 0, away = index 1)
      const parseTeam = (teamWrapper: unknown) => {
        const teamData = getPath(teamWrapper, ['team']) as unknown[];
        const team = unwrapTeam(teamData);
        const teamPoints = team.team_points as Record<string, unknown> | undefined;
        const teamProjectedPoints = team.team_projected_points as Record<string, unknown> | undefined;

        return {
          teamKey: team.team_key as string,
          teamId: team.team_id as string,
          teamName: team.name as string,
          points: teamPoints?.total ? parseFloat(String(teamPoints.total)) : 0,
          projectedPoints: teamProjectedPoints?.total ? parseFloat(String(teamProjectedPoints.total)) : undefined,
        };
      };

      const home = teamsArray[0] ? parseTeam(teamsArray[0]) : null;
      const away = teamsArray[1] ? parseTeam(teamsArray[1]) : null;

      // Determine winner based on points (if both teams have scores)
      let winner: string | undefined;
      if (home && away && (home.points > 0 || away.points > 0)) {
        if (home.points > away.points) winner = 'home';
        else if (away.points > home.points) winner = 'away';
        else winner = 'tie';
      }

      return {
        matchupId: index + 1,
        week: week || currentWeek,
        home,
        away,
        winner,
      };
    });

    return {
      success: true,
      data: {
        leagueKey: league.league_key,
        leagueName: league.name,
        currentWeek,
        matchupWeek: week || currentWeek,
        matchups
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

/**
 * Get available free agents
 */
async function handleGetFreeAgents(
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  const { league_id, position, count } = params;

  try {
    const credentials = await getYahooCredentials(env, authHeader, correlationId);
    requireCredentials(credentials, 'get_free_agents');

    // Build Yahoo query params
    // ;status=FA for free agents, ;count=N for limit, ;position=POS for filter
    const limit = Math.min(Math.max(1, count || 25), 100);
    let queryParams = `;status=FA;count=${limit}`;

    const posFilter = getPositionFilter(position);
    if (posFilter) {
      queryParams += `;position=${posFilter}`;
    }

    const response = await yahooFetch(`/league/${league_id}/players${queryParams}`, { credentials });

    if (!response.ok) {
      handleYahooError(response);
    }

    const raw = await response.json();
    logStructure('get_free_agents raw', raw);

    // Navigate: fantasy_content.league[0]=meta, [1]=players
    const leagueArray = getPath(raw, ['fantasy_content', 'league']);
    const league = unwrapLeague(leagueArray);

    // players is numeric-keyed object
    const playersObj = league.players as Record<string, unknown> | undefined;
    const playersArray = asArray(playersObj);

    const freeAgents = playersArray.map((playerWrapper: unknown) => {
      // Each player is wrapped: {player: [[metadata], ...]}
      const playerData = getPath(playerWrapper, ['player']) as unknown[];

      // Player metadata is in first array
      const metaArray = playerData?.[0] as unknown[];
      let playerMeta: Record<string, unknown> = {};
      if (Array.isArray(metaArray)) {
        for (const item of metaArray) {
          if (typeof item === 'object' && item !== null) {
            playerMeta = { ...playerMeta, ...item };
          }
        }
      }

      // Ownership data may be in second element
      const ownershipData = playerData?.[1] as Record<string, unknown> | undefined;
      const ownership = ownershipData?.ownership as Record<string, unknown> | undefined;

      return {
        playerKey: playerMeta.player_key as string,
        playerId: playerMeta.player_id as string,
        name: (playerMeta.name as Record<string, unknown>)?.full as string,
        team: playerMeta.editorial_team_abbr as string,
        position: playerMeta.display_position as string,
        percentOwned: ownership?.percent_owned ? parseFloat(String(ownership.percent_owned)) : undefined,
        status: playerMeta.status as string | undefined,
      };
    });

    return {
      success: true,
      data: {
        leagueKey: league.league_key,
        leagueName: league.name,
        position: position?.toUpperCase() || 'ALL',
        count: freeAgents.length,
        freeAgents
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

async function handleGetTransactions(
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  const { league_id, count, type, week } = params;

  if (type === 'waiver') {
    return {
      success: false,
      error: 'Yahoo league-wide transactions do not support type=waiver filtering in v1. Use type=add for now; waiver-specific enrichment is planned as a follow-up phase.',
      code: 'YAHOO_FILTER_UNSUPPORTED',
    };
  }

  try {
    const credentials = await getYahooCredentials(env, authHeader, correlationId);
    requireCredentials(credentials, 'get_transactions');

    const path = buildYahooTransactionsPath(league_id, count || 25);
    const response = await yahooFetch(path, { credentials });
    if (!response.ok) {
      handleYahooError(response);
    }

    const raw = await response.json();

    const cid = correlationId || 'no-cid';
    const maxCount = count ?? 25;
    const now = Date.now();
    const cutoff = now - (14 * 24 * 60 * 60 * 1000);
    const parsed = normalizeYahooTransactions(raw);
    const invalidTimestampCount = parsed.filter((txn) => !Number.isFinite(txn.timestamp) || txn.timestamp <= 0).length;
    if (invalidTimestampCount > 0) {
      console.warn(
        `[yahoo-client] ${cid} get_transactions excluded ${invalidTimestampCount} rows with missing/invalid timestamp`,
      );
    }

    const normalized = parsed
      .filter((txn) => txn.timestamp >= cutoff)
      .filter((txn) => !type || txn.type === type)
      .slice(0, maxCount);

    const warnings: string[] = [];
    if (week !== undefined) {
      warnings.push('Explicit week filtering is not supported for Yahoo transactions in v1; Yahoo always uses a recent timestamp window and ignored week.');
    }
    if (invalidTimestampCount > 0) {
      warnings.push(`${invalidTimestampCount} transaction(s) were excluded because Yahoo did not provide a valid timestamp.`);
    }

    return {
      success: true,
      data: {
        platform: 'yahoo',
        sport: params.sport,
        league_id,
        season_year: params.season_year,
        window: {
          mode: 'recent_two_weeks_timestamp',
          weeks: [],
          start_timestamp_ms: cutoff,
          end_timestamp_ms: now,
        },
        warning: warnings.length > 0 ? warnings.join(' ') : undefined,
        dropped_invalid_timestamp_count: invalidTimestampCount,
        count: normalized.length,
        transactions: normalized,
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
