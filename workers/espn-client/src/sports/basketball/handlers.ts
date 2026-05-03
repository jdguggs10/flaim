// workers/espn-client/src/sports/basketball/handlers.ts
import type { Env, RoutedToolParams, ExecuteResponse, EspnLeagueResponse, EspnPlayerPoolResponse } from '../../types';
import { getCredentials } from '../../shared/auth';
import { espnFetch, handleEspnError, requireCredentials } from '../../shared/espn-api';
import { fetchEspnTransactionsByWeeks, fetchEspnMTransactions2, mergeTradePlayerDetails, getEspnLeagueContext, fetchEspnPlayersByIds, enrichTransactions } from '../../shared/espn-transactions';
import type { NormalizedTransaction } from '../../shared/espn-transactions';
import { getEspnPlayersIndex } from '../../shared/espn-players-cache';
import { fetchLeagueOwnershipMap, enrichPlayerWithOwnership } from '../../shared/league-ownership';
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
import { getCurrentSeasonYear, getSeasonContext, normalizeEspnLeagueStatus } from '../../shared/season';
import { deriveStandingsOutcome, deriveStandingsSeasonPhase } from '../../shared/standings';

const GAME_ID = 'fba'; // ESPN's game ID for fantasy basketball

type HandlerFn = (
  env: Env,
  params: RoutedToolParams,
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
  get_players: handleSearchPlayers,
};

async function handleSearchPlayers(
  env: Env,
  params: RoutedToolParams,
  authHeader?: string,
  correlationId?: string,
): Promise<ExecuteResponse> {
  const { query, position, count, league_id } = params;
  const { espnYear } = getSeasonContext(params);

  if (!query) {
    return { success: false, error: 'query is required for get_players', code: 'MISSING_PARAM' };
  }

  try {
    const limit = Math.max(1, Math.min(25, Math.trunc(Number.isFinite(Number(count)) ? Number(count) : 10)));
    const playersIndex = await getEspnPlayersIndex(env, 'basketball', espnYear);
    const normalizedQuery = query.toLowerCase();
    const normalizedPosition = position?.trim().toUpperCase();
    const filterByPosition = normalizedPosition && normalizedPosition !== 'ALL';

    const matched = Array.from(playersIndex.values())
      .filter((p) => p.fullName.toLowerCase().includes(normalizedQuery))
      .filter((p) => {
        if (!filterByPosition) return true;
        return getPositionName(p.defaultPositionId).toUpperCase() === normalizedPosition;
      })
      .slice(0, limit);

    // League ownership enrichment (null if no credentials or league_id)
    const ownerMap = league_id
      ? await fetchLeagueOwnershipMap(env, GAME_ID, league_id, espnYear, authHeader, correlationId)
      : null;

    const players = matched.map((p) => ({
      id: String(p.id),
      name: p.fullName,
      position: getPositionName(p.defaultPositionId),
      team: getProTeamAbbrev(p.proTeamId),
      market_percent_owned: p.percentOwned ?? null,
      ownership_scope: 'platform_global' as const,
      ...enrichPlayerWithOwnership(p.id, ownerMap),
    }));

    return {
      success: true,
      data: {
        platform: 'espn',
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

/**
 * Get league information and settings
 */
async function handleGetLeagueInfo(
  env: Env,
  params: RoutedToolParams,
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  const { league_id } = params;
  const { canonicalYear, espnYear } = getSeasonContext(params);

  try {
    const credentials = await getCredentials(env, authHeader, correlationId);

    const path = `/seasons/${espnYear}/segments/0/leagues/${league_id}?view=mSettings&view=mTeam`;
    const response = await espnFetch(path, GAME_ID, { credentials, timeout: 7000 });

    if (!response.ok) {
      handleEspnError(response);
    }

    const data = await response.json() as EspnLeagueResponse;
    const currentMatchupPeriod = data.currentMatchupPeriod ?? data.status?.currentMatchupPeriod;

    if (!data || !data.settings) {
      return {
        success: false,
        error: 'Invalid league data received from ESPN API',
        code: 'ESPN_INVALID_RESPONSE'
      };
    }

    const teams = (data.teams || []).map((team) => {
      const ownerNames = team.owners?.map((o) => o.displayName || o.firstName).filter(Boolean) as string[] | undefined;
      const hasOwners = ownerNames && ownerNames.length > 0;
      return {
        teamId: team.id,
        teamName: team.location && team.nickname
          ? `${team.location} ${team.nickname}`
          : team.name || `Team ${team.id}`,
        abbrev: team.abbrev,
        ownerName: hasOwners ? ownerNames[0] : undefined,
        owners: hasOwners ? ownerNames : undefined,
      };
    });

    return {
      success: true,
      data: {
        id: data.id,
        name: data.settings.name,
        size: data.settings.size,
        status: normalizeEspnLeagueStatus(data.status, 'basketball'),
        scoringPeriodId: data.scoringPeriodId,
        currentMatchupPeriod,
        seasonId: canonicalYear,
        segmentId: data.segmentId,
        teams,
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
  params: RoutedToolParams,
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  const { league_id } = params;
  const { canonicalYear, espnYear } = getSeasonContext(params);

  try {
    const credentials = await getCredentials(env, authHeader, correlationId);

    const path = `/seasons/${espnYear}/segments/0/leagues/${league_id}?view=mStandings&view=mTeam`;
    const response = await espnFetch(path, GAME_ID, { credentials, timeout: 7000 });

    if (!response.ok) {
      handleEspnError(response);
    }

    const data = await response.json() as EspnLeagueResponse;
    const currentMatchupPeriod = data.currentMatchupPeriod ?? data.status?.currentMatchupPeriod;
    const teams = data.teams || [];

    const seasonPhase = deriveStandingsSeasonPhase({
      requestedSeasonYear: canonicalYear,
      currentSeasonYear: getCurrentSeasonYear('basketball'),
      scoringPeriodId: data.scoringPeriodId,
      currentMatchupPeriod,
      regularSeasonMatchupPeriods: data.settings?.regularSeasonMatchupPeriods,
      teams,
    });
    const seasonComplete = seasonPhase === 'season_complete';

    // Transform and sort teams by standings
    const standings = teams.map((team) => {
      const record = team.record?.overall;
      const wins = record?.wins || 0;
      const losses = record?.losses || 0;
      const ties = record?.ties || 0;
      const totalGames = wins + losses + ties;
      const winPercentage = totalGames > 0 ? wins / totalGames : 0;

      const outcome = deriveStandingsOutcome({
        rankFinal: team.rankFinal,
        rankCalculatedFinal: team.rankCalculatedFinal,
        playoffSeed: team.playoffSeed,
        seasonComplete,
      });

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
        playoffSeed: team.playoffSeed ?? null,
        draftDayProjectedRank: team.draftDayProjectedRank,
        currentProjectedRank: team.currentProjectedRank,
        ...outcome,
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
        seasonYear: canonicalYear,
        seasonPhase,
        seasonComplete,
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
  params: RoutedToolParams,
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  const { league_id, week } = params;
  const { canonicalYear, espnYear } = getSeasonContext(params);

  try {
    const credentials = await getCredentials(env, authHeader, correlationId);

    let path = `/seasons/${espnYear}/segments/0/leagues/${league_id}?view=mMatchupScore&view=mScoreboard&view=mTeam`;
    if (week) {
      path += `&scoringPeriodId=${week}&matchupPeriodId=${week}`;
    }

    const response = await espnFetch(path, GAME_ID, { credentials, timeout: 7000 });

    if (!response.ok) {
      handleEspnError(response);
    }

    const data = await response.json() as EspnLeagueResponse;
    const currentMatchupPeriod = data.currentMatchupPeriod ?? data.status?.currentMatchupPeriod;
    const schedule = data.schedule || [];
    const teamsById = Object.fromEntries(
      (data.teams || []).map((team) => [
        team.id,
        team.location && team.nickname
          ? `${team.location} ${team.nickname}`
          : team.name || `Team ${team.id}`,
      ])
    );

    // Transform matchups
    const matchupPeriod = week ?? currentMatchupPeriod ?? data.scoringPeriodId;
    const matchups = schedule
      .filter((matchup) => matchupPeriod == null || matchup.matchupPeriodId === matchupPeriod)
      .map((matchup) => ({
        matchupPeriodId: matchup.matchupPeriodId,
        home: matchup.home ? {
          teamId: matchup.home.teamId,
          teamName: matchup.home.teamId ? teamsById[matchup.home.teamId] : undefined,
          totalPoints: matchup.home.totalPoints || 0,
          totalProjectedPoints: matchup.home.totalProjectedPointsLive || matchup.home.totalProjectedPoints,
          pointsByScoringPeriod: matchup.home.pointsByScoringPeriod
        } : null,
        away: matchup.away ? {
          teamId: matchup.away.teamId,
          teamName: matchup.away.teamId ? teamsById[matchup.away.teamId] : undefined,
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
        seasonYear: canonicalYear,
        currentScoringPeriod: data.scoringPeriodId,
        matchupPeriod: matchupPeriod ?? null,
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
  params: RoutedToolParams,
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  const { league_id, team_id, week } = params;
  const { espnYear } = getSeasonContext(params);

  try {
    const credentials = await getCredentials(env, authHeader, correlationId);
    requireCredentials(credentials, 'roster data');

    let path = `/seasons/${espnYear}/segments/0/leagues/${league_id}?view=mRoster&view=mTeam`;
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
        s.seasonId === espnYear && s.statSourceId === 0
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

    const ownerName = team.owners?.map((o) => o.displayName || o.firstName).find(Boolean) || undefined;

    return {
      success: true,
      data: {
        leagueId: league_id,
        teamId: team.id,
        teamName: team.location && team.nickname
          ? `${team.location} ${team.nickname}`
          : team.name || `Team ${team.id}`,
        ownerName,
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
  params: RoutedToolParams,
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  const { league_id, position, count } = params;
  const { canonicalYear, espnYear } = getSeasonContext(params);

  try {
    const credentials = await getCredentials(env, authHeader, correlationId);
    requireCredentials(credentials, 'free agent data');

    const positionKey = (position || 'ALL').toUpperCase();
    const slotIds = POSITION_SLOTS[positionKey] || POSITION_SLOTS['ALL'];
    const limit = Math.min(Math.max(1, count || 25), 100);

    const path = `/seasons/${espnYear}/segments/0/leagues/${league_id}?view=kona_player_info`;

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
        s.seasonId === espnYear && s.statSourceId === 0
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
        seasonYear: canonicalYear,
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
  params: RoutedToolParams,
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  const { league_id, week, count, type } = params;
  const { canonicalYear, espnYear } = getSeasonContext(params);

  try {
    const credentials = await getCredentials(env, authHeader, correlationId);
    requireCredentials(credentials, 'get_transactions');

    const ctx = await getEspnLeagueContext(GAME_ID, league_id, espnYear, credentials);
    const currentWeek = ctx.scoringPeriodId;
    const weeks = week != null
      ? [Math.max(0, week)]
      : Array.from(new Set([
          currentWeek,
          Math.max(0, currentWeek - 1),
          ...(currentWeek <= 2 ? [0] : []),
        ]));

    const maxCount = count ?? 25;

    // Primary: mTransactions2 (structured data, FAAB bids, trade lifecycle)
    // Falls back to activity feed if mTransactions2 fails entirely
    let merged: NormalizedTransaction[];
    let truncated = false;
    try {
      const mResult = await fetchEspnMTransactions2(GAME_ID, league_id, espnYear, credentials, weeks);
      truncated = mResult.truncated;

      // Trade player detail fallback: activity feed for accepted/upheld trades (ESPN items bug)
      const hasEmptyTrades = mResult.transactions.some(
        (t) => (t.type === 'trade' || t.type === 'trade_uphold') &&
          (t.players_added?.length ?? 0) + (t.players_dropped?.length ?? 0) === 0,
      );
      merged = mResult.transactions;
      if (hasEmptyTrades) {
        try {
          const activityRows = await fetchEspnTransactionsByWeeks(GAME_ID, league_id, espnYear, credentials, weeks);
          merged = mergeTradePlayerDetails(mResult.transactions, activityRows);
        } catch (fallbackErr) {
          console.warn('[get_transactions] Activity feed trade fallback failed:', fallbackErr instanceof Error ? fallbackErr.message : fallbackErr);
        }
      }
    } catch (mTxnErr) {
      console.warn('[get_transactions] mTransactions2 failed, falling back to activity feed:', mTxnErr instanceof Error ? mTxnErr.message : mTxnErr);
      merged = await fetchEspnTransactionsByWeeks(GAME_ID, league_id, espnYear, credentials, weeks);
    }

    let filtered = merged
      .filter((txn) => !type || txn.type === type)
      .slice(0, maxCount);

    const allIds = [...new Set(filtered.flatMap((t) => [
      ...(t.players_added ?? []).map((p) => p.id),
      ...(t.players_dropped ?? []).map((p) => p.id),
    ]))];
    if (allIds.length > 0) {
      try {
        const playerMap = await fetchEspnPlayersByIds(GAME_ID, espnYear, allIds);
        if (playerMap) {
          filtered = enrichTransactions(filtered, playerMap, getPositionName, getProTeamAbbrev);
        }
      } catch (enrichErr) {
        // Degrade gracefully — return transactions without player names
        console.error('[get_transactions] Player enrichment failed:', enrichErr instanceof Error ? enrichErr.message : enrichErr);
      }
    }

    return {
      success: true,
      data: {
        platform: 'espn',
        sport: params.sport,
        league_id,
        season_year: canonicalYear,
        window: {
          mode: week ? 'explicit_week' : 'recent_two_weeks',
          weeks
        },
        count: filtered.length,
        truncated: truncated || undefined,
        transactions: filtered,
        teams: ctx.teams,
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
