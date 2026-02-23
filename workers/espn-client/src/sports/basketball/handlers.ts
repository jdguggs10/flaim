// workers/espn-client/src/sports/basketball/handlers.ts
import type { Env, ToolParams, ExecuteResponse, EspnLeagueResponse, EspnPlayerPoolResponse } from '../../types';
import { getCredentials } from '../../shared/auth';
import { espnFetch, handleEspnError, requireCredentials } from '../../shared/espn-api';
import { fetchEspnTransactionsByWeeks, getCurrentEspnScoringPeriod } from '../../shared/espn-transactions';
import { extractErrorCode } from '@flaim/worker-shared';
import {
  getPositionName,
  getLineupSlotName,
  getProTeamAbbrev,
  getInjuryStatus,
  transformEligiblePositions,
  transformStats,
  POSITION_SLOTS,
} from './mappings';

const GAME_ID = 'fba'; // ESPN's game ID for fantasy basketball

type HandlerFn = (
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string
) => Promise<ExecuteResponse>;

export const basketballHandlers: Record<string, HandlerFn> = {
  get_league_info: handleGetLeagueInfo,
  get_standings: handleGetStandings,
  get_matchups: handleGetMatchups,
  get_roster: handleGetRoster,
  get_free_agents: handleGetFreeAgents,
  get_transactions: handleGetTransactions,
};

/**
 * Get league information and settings
 */
async function handleGetLeagueInfo(
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  const { league_id, season_year } = params;

  try {
    const credentials = await getCredentials(env, authHeader, correlationId);

    const path = `/seasons/${season_year}/segments/0/leagues/${league_id}?view=mSettings`;
    const response = await espnFetch(path, GAME_ID, { credentials, timeout: 7000 });

    if (!response.ok) {
      handleEspnError(response);
    }

    const data = await response.json() as EspnLeagueResponse;

    if (!data || !data.settings) {
      return {
        success: false,
        error: 'Invalid league data received from ESPN API',
        code: 'ESPN_INVALID_RESPONSE'
      };
    }

    return {
      success: true,
      data: {
        id: data.id,
        name: data.settings.name,
        size: data.settings.size,
        status: data.status,
        scoringPeriodId: data.scoringPeriodId,
        currentMatchupPeriod: data.currentMatchupPeriod,
        seasonId: data.seasonId,
        segmentId: data.segmentId,
        scoringSettings: {
          type: data.settings.scoringSettings?.scoringType,
          matchupPeriods: data.settings.scoringSettings?.matchupPeriods,
          playoffTeamCount: data.settings.playoffTeamCount,
          regularSeasonMatchupPeriods: data.settings.regularSeasonMatchupPeriods
        },
        roster: {
          lineupSlotCounts: data.settings.rosterSettings?.lineupSlotCounts,
          positionLimits: data.settings.rosterSettings?.positionLimits
        },
        schedule: {
          playoffSeedingRule: data.settings.scheduleSettings?.playoffSeedingRule,
          playoffMatchupPeriodLength: data.settings.scheduleSettings?.playoffMatchupPeriodLength
        }
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      code: extractErrorCode(error)
    };
  }
}

/**
 * Get league standings
 */
async function handleGetStandings(
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  const { league_id, season_year } = params;

  try {
    const credentials = await getCredentials(env, authHeader, correlationId);

    const path = `/seasons/${season_year}/segments/0/leagues/${league_id}?view=mStandings&view=mTeam`;
    const response = await espnFetch(path, GAME_ID, { credentials, timeout: 7000 });

    if (!response.ok) {
      handleEspnError(response);
    }

    const data = await response.json() as EspnLeagueResponse;
    const teams = data.teams || [];

    // Transform and sort teams by standings
    const standings = teams.map((team) => {
      const record = team.record?.overall;
      const wins = record?.wins || 0;
      const losses = record?.losses || 0;
      const ties = record?.ties || 0;
      const totalGames = wins + losses + ties;
      const winPercentage = totalGames > 0 ? wins / totalGames : 0;

      return {
        teamId: team.id,
        teamName: team.location && team.nickname
          ? `${team.location} ${team.nickname}`
          : team.name || `Team ${team.id}`,
        abbrev: team.abbrev,
        wins,
        losses,
        ties,
        winPercentage: Math.round(winPercentage * 1000) / 1000,
        pointsFor: record?.pointsFor || 0,
        pointsAgainst: record?.pointsAgainst || 0,
        playoffSeed: team.playoffSeed,
        draftDayProjectedRank: team.draftDayProjectedRank,
        currentProjectedRank: team.currentProjectedRank
      };
    }).sort((a, b) => {
      // Sort by win percentage descending, then by wins descending
      if (b.winPercentage !== a.winPercentage) {
        return b.winPercentage - a.winPercentage;
      }
      return b.wins - a.wins;
    }).map((team, index) => ({
      ...team,
      rank: index + 1
    }));

    return {
      success: true,
      data: {
        leagueId: league_id,
        seasonYear: season_year,
        standings
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      code: extractErrorCode(error)
    };
  }
}

/**
 * Get matchups/box scores
 */
async function handleGetMatchups(
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  const { league_id, season_year, week } = params;

  try {
    const credentials = await getCredentials(env, authHeader, correlationId);

    let path = `/seasons/${season_year}/segments/0/leagues/${league_id}?view=mMatchupScore&view=mScoreboard`;
    if (week) {
      path += `&scoringPeriodId=${week}&matchupPeriodId=${week}`;
    }

    const response = await espnFetch(path, GAME_ID, { credentials, timeout: 7000 });

    if (!response.ok) {
      handleEspnError(response);
    }

    const data = await response.json() as EspnLeagueResponse;
    const schedule = data.schedule || [];

    // Transform matchups
    const matchups = schedule
      .filter((matchup) => matchup.matchupPeriodId === (week || data.scoringPeriodId))
      .map((matchup) => ({
        matchupPeriodId: matchup.matchupPeriodId,
        home: matchup.home ? {
          teamId: matchup.home.teamId,
          totalPoints: matchup.home.totalPoints || 0,
          totalProjectedPoints: matchup.home.totalProjectedPointsLive || matchup.home.totalProjectedPoints,
          pointsByScoringPeriod: matchup.home.pointsByScoringPeriod
        } : null,
        away: matchup.away ? {
          teamId: matchup.away.teamId,
          totalPoints: matchup.away.totalPoints || 0,
          totalProjectedPoints: matchup.away.totalProjectedPointsLive || matchup.away.totalProjectedPoints,
          pointsByScoringPeriod: matchup.away.pointsByScoringPeriod
        } : null,
        winner: matchup.winner,
        playoffTierType: matchup.playoffTierType
      }));

    return {
      success: true,
      data: {
        leagueId: league_id,
        seasonYear: season_year,
        currentScoringPeriod: data.scoringPeriodId,
        matchupPeriod: week || data.scoringPeriodId,
        matchups
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      code: extractErrorCode(error)
    };
  }
}

/**
 * Get roster for a specific team
 */
async function handleGetRoster(
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  const { league_id, season_year, team_id, week } = params;

  try {
    const credentials = await getCredentials(env, authHeader, correlationId);
    requireCredentials(credentials, 'roster data');

    let path = `/seasons/${season_year}/segments/0/leagues/${league_id}?view=mRoster`;
    if (week) {
      path += `&scoringPeriodId=${week}`;
    }

    const response = await espnFetch(path, GAME_ID, { credentials, timeout: 7000 });

    if (!response.ok) {
      handleEspnError(response);
    }

    const data = await response.json() as EspnLeagueResponse;
    const teams = data.teams || [];

    // Find the requested team
    const team = team_id
      ? teams.find((t) => t.id.toString() === team_id)
      : teams[0];

    if (!team) {
      return {
        success: false,
        error: team_id
          ? `Team ${team_id} not found in league ${league_id}`
          : `No teams found in league ${league_id}`,
        code: 'ESPN_NOT_FOUND'
      };
    }

    // Transform roster entries
    const roster = (team.roster?.entries || []).map((entry) => {
      const player = entry.playerPoolEntry?.player;
      const stats = player?.stats || [];

      // Get current season stats if available
      const currentStats = stats.find((s) =>
        s.seasonId === season_year && s.statSourceId === 0
      );

      return {
        playerId: player?.id,
        name: player?.fullName || 'Unknown',
        position: getPositionName(player?.defaultPositionId || 0),
        eligiblePositions: transformEligiblePositions(player?.eligibleSlots || []),
        lineupSlot: getLineupSlotName(entry.lineupSlotId ?? 0),
        proTeam: getProTeamAbbrev(player?.proTeamId || 0),
        injuryStatus: player?.injuryStatus ? getInjuryStatus(player.injuryStatus) : undefined,
        percentOwned: player?.ownership?.percentOwned,
        percentStarted: player?.ownership?.percentStarted,
        stats: currentStats?.stats ? transformStats(currentStats.stats) : undefined,
        acquisitionType: entry.acquisitionType,
        acquisitionDate: entry.acquisitionDate
      };
    });

    return {
      success: true,
      data: {
        leagueId: league_id,
        teamId: team.id,
        teamName: team.location && team.nickname
          ? `${team.location} ${team.nickname}`
          : team.name || `Team ${team.id}`,
        roster
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
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
  const { league_id, season_year, position, count } = params;

  try {
    const credentials = await getCredentials(env, authHeader, correlationId);
    requireCredentials(credentials, 'free agent data');

    const positionKey = (position || 'ALL').toUpperCase();
    const slotIds = POSITION_SLOTS[positionKey] || POSITION_SLOTS['ALL'];
    const limit = Math.min(Math.max(1, count || 25), 100);

    const path = `/seasons/${season_year}/segments/0/leagues/${league_id}?view=kona_player_info`;

    // Build the X-Fantasy-Filter header for free agents
    const filter = {
      players: {
        filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
        filterSlotIds: { value: slotIds },
        sortPercOwned: { sortPriority: 1, sortAsc: false },
        sortDraftRanks: { sortPriority: 100, sortAsc: true, value: 'STANDARD' },
        limit: limit
      }
    };

    const response = await espnFetch(path, GAME_ID, {
      credentials,
      timeout: 7000,
      headers: {
        'X-Fantasy-Filter': JSON.stringify(filter)
      }
    });

    if (!response.ok) {
      handleEspnError(response);
    }

    const data = await response.json() as EspnPlayerPoolResponse;
    const players = data.players || [];

    // Transform player data
    const freeAgents = players.map((entry) => {
      const player = entry.player;
      const stats = player?.stats || [];

      // Get current season stats if available
      const currentStats = stats.find((s) =>
        s.seasonId === season_year && s.statSourceId === 0
      );

      return {
        playerId: player?.id,
        name: player?.fullName || 'Unknown',
        position: getPositionName(player?.defaultPositionId || 0),
        eligiblePositions: transformEligiblePositions(player?.eligibleSlots || []),
        proTeam: getProTeamAbbrev(player?.proTeamId || 0),
        injuryStatus: player?.injuryStatus ? getInjuryStatus(player.injuryStatus) : undefined,
        percentOwned: player?.ownership?.percentOwned,
        percentStarted: player?.ownership?.percentStarted,
        status: entry.status, // FREEAGENT or WAIVERS
        waiverProcessDate: entry.waiverProcessDate,
        stats: currentStats?.stats ? transformStats(currentStats.stats) : undefined
      };
    });

    return {
      success: true,
      data: {
        leagueId: league_id,
        seasonYear: season_year,
        position: positionKey,
        count: freeAgents.length,
        freeAgents
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
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
  const { league_id, season_year, week, count, type } = params;

  try {
    const credentials = await getCredentials(env, authHeader, correlationId);
    requireCredentials(credentials, 'get_transactions');

    const currentWeek = await getCurrentEspnScoringPeriod(GAME_ID, league_id, season_year, credentials);
    const weeks = week
      ? [Math.max(1, week)]
      : Array.from(new Set([currentWeek, Math.max(1, currentWeek - 1)]));

    const maxCount = count ?? 25;
    const rows = await fetchEspnTransactionsByWeeks(GAME_ID, league_id, season_year, credentials, weeks);
    const filtered = rows
      .filter((txn) => !type || txn.type === type)
      .slice(0, maxCount);

    return {
      success: true,
      data: {
        platform: 'espn',
        sport: params.sport,
        league_id,
        season_year,
        window: {
          mode: week ? 'explicit_week' : 'recent_two_weeks',
          weeks
        },
        count: filtered.length,
        transactions: filtered,
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      code: extractErrorCode(error)
    };
  }
}
