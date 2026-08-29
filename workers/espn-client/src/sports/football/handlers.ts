// workers/espn-client/src/sports/football/handlers.ts
import { isEspnLeagueResponse, type Env, type RoutedToolParams, type ExecuteResponse, type EspnPlayerPoolResponse } from '../../types';
import { getCredentials } from '../../shared/auth';
import { espnFetch, handleEspnError, readEspnLeagueJson, requireCredentials } from '../../shared/espn-api';
import { assertTransactionsSeasonSupported, executeEspnTransactionOperation } from '../../shared/espn-transactions';
import { getEspnPlayersIndex } from '../../shared/espn-players-cache';
import { fetchLeagueOwnershipMap, enrichPlayerWithOwnership } from '../../shared/league-ownership';
import { buildRosterLimitations, currentClubAndInjuryFields, resolveKeeperValueUnit } from '../../shared/roster-entry';
import { epochMsToIso } from '../../shared/dates';
import { extractErrorCode, malformedRosterSnapshotError, resolveRosterSnapshotFromParams, rosterSnapshotUnsupportedError, toSnapshotMetadata } from '@flaim/worker-shared';
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
import { buildPlayoffSeedMap, deriveStandingsOutcome, deriveStandingsSeasonPhase, fetchBracketFinal, hasExplicitFinalRanks } from '../../shared/standings';
import { executeEspnGetDraft } from '../../shared/espn-draft';

const GAME_ID = 'ffl'; // ESPN's game ID for fantasy football

type HandlerFn = (
  env: Env,
  params: RoutedToolParams,
  authHeader?: string,
  correlationId?: string
) => Promise<ExecuteResponse>;

export const footballHandlers: Record<string, HandlerFn> = {
  get_draft: (env, params, authHeader, correlationId) => executeEspnGetDraft(env, params, GAME_ID, authHeader, correlationId),
  get_league_info: handleGetLeagueInfo,
  get_standings: handleGetStandings,
  get_matchups: handleGetMatchups,
  get_roster: handleGetRoster,
  get_free_agents: handleGetFreeAgents,
  get_transactions: handleGetTransactions,
  get_players: handleSearchPlayers,
};

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
    const response = await espnFetch(path, GAME_ID, {
      credentials,
      timeout: 7000,
      league: {
        leagueId: league_id,
        espnSeasonYear: espnYear,
        historical: canonicalYear < getCurrentSeasonYear('football'),
      },
    });

    if (!response.ok) {
      handleEspnError(response);
    }

    const data = await readEspnLeagueJson(response, isEspnLeagueResponse);

    if (!data || !data.settings) {
      return {
        success: false,
        error: 'Invalid league data received from ESPN API',
        code: 'ESPN_INVALID_RESPONSE'
      };
    }
    const currentMatchupPeriod = data.currentMatchupPeriod ?? data.status?.currentMatchupPeriod;

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
        ...(team.draftStrategy?.keeperPlayerIds !== undefined
          ? { keeperPlayerIds: team.draftStrategy.keeperPlayerIds }
          : {}),
        ...(team.draftStrategy?.futureKeeperPlayerIds !== undefined
          ? { futureKeeperPlayerIds: team.draftStrategy.futureKeeperPlayerIds }
          : {}),
      };
    });

    return {
      success: true,
      data: {
        id: data.id,
        name: data.settings.name,
        size: data.settings.size,
        status: normalizeEspnLeagueStatus(data.status, 'football'),
        scoringPeriodId: data.scoringPeriodId,
        currentMatchupPeriod,
        seasonId: canonicalYear,
        segmentId: data.segmentId,
        teams,
        scoringSettings: {
          type: data.settings.scoringSettings?.scoringType,
          matchupPeriods: data.settings.scheduleSettings?.matchupPeriods,
          playoffTeamCount: data.settings.playoffTeamCount,
          regularSeasonMatchupPeriods: data.settings.regularSeasonMatchupPeriods,
          matchupTieRule: data.settings.scoringSettings?.matchupTieRule,
          matchupTieRuleBy: data.settings.scoringSettings?.matchupTieRuleBy,
          playoffMatchupTieRule: data.settings.scoringSettings?.playoffMatchupTieRule,
          playoffMatchupTieRuleBy: data.settings.scoringSettings?.playoffMatchupTieRuleBy,
          homeTeamBonus: data.settings.scoringSettings?.homeTeamBonus,
          playoffHomeTeamBonus: data.settings.scoringSettings?.playoffHomeTeamBonus
        },
        roster: {
          lineupSlotCounts: data.settings.rosterSettings?.lineupSlotCounts,
          positionLimits: data.settings.rosterSettings?.positionLimits
        },
        schedule: {
          playoffSeedingRule: data.settings.scheduleSettings?.playoffSeedingRule,
          playoffMatchupPeriodLength: data.settings.scheduleSettings?.playoffMatchupPeriodLength
        },
        ...(data.settings.draftSettings?.keeperCount != null
          ? {
              keeperSettings: {
                keeperCount: data.settings.draftSettings.keeperCount,
                keeperCountFuture: data.settings.draftSettings.keeperCountFuture,
                keeperOrderType: data.settings.draftSettings.keeperOrderType,
                keeperDeadlineDate: epochMsToIso(data.settings.draftSettings.keeperDeadlineDate),
              },
              isKeeperLeague: data.settings.draftSettings.keeperCount > 0,
            }
          : {}),
        draftSettings: {
          type: data.settings.draftSettings?.type,
          auctionBudget: data.settings.draftSettings?.auctionBudget,
          pickTradingEnabled: data.settings.draftSettings?.isTradingEnabled,
        },
        tradeSettings: {
          deadlineDate: epochMsToIso(data.settings.tradeSettings?.deadlineDate),
          revisionHours: data.settings.tradeSettings?.revisionHours,
          vetoVotesRequired: data.settings.tradeSettings?.vetoVotesRequired,
          allowOutOfUniverse: data.settings.tradeSettings?.allowOutOfUniverse,
          max: data.settings.tradeSettings?.max
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
  const { league_id, season_year } = params;

  try {
    const credentials = await getCredentials(env, authHeader, correlationId);

    const path = `/seasons/${season_year}/segments/0/leagues/${league_id}?view=mStandings&view=mTeam`;
    const response = await espnFetch(path, GAME_ID, {
      credentials,
      timeout: 7000,
      league: {
        leagueId: league_id,
        espnSeasonYear: season_year,
        historical: season_year < getCurrentSeasonYear('football'),
      },
    });

    if (!response.ok) {
      handleEspnError(response);
    }

    const data = await readEspnLeagueJson(response, isEspnLeagueResponse);
    const currentMatchupPeriod = data?.currentMatchupPeriod ?? data?.status?.currentMatchupPeriod;
    const teams = data?.teams || [];

    const seasonPhase = deriveStandingsSeasonPhase({
      requestedSeasonYear: season_year,
      currentSeasonYear: getCurrentSeasonYear('football'),
      scoringPeriodId: data?.scoringPeriodId,
      currentMatchupPeriod,
      regularSeasonMatchupPeriods: data?.settings?.regularSeasonMatchupPeriods,
      teams,
    });
    const seasonComplete = seasonPhase === 'season_complete';

    // ESPN leaves final ranks at 0 for some historical seasons; fall back to the
    // playoff bracket to identify the champion and runner-up.
    const bracketFinal = seasonComplete && !hasExplicitFinalRanks(teams)
      ? await fetchBracketFinal(
        GAME_ID,
        league_id,
        season_year,
        credentials,
        buildPlayoffSeedMap(teams),
        season_year < getCurrentSeasonYear('football'),
      )
      : null;

    // Transform and sort teams by standings
    const standings = teams.map((team) => {
      const record = team.record?.overall;
      const wins = record?.wins || 0;
      const losses = record?.losses || 0;
      const ties = record?.ties || 0;
      const totalGames = wins + losses + ties;
      const winPercentage = totalGames > 0 ? wins / totalGames : 0;

      const outcome = deriveStandingsOutcome({
        teamId: team.id,
        rankFinal: team.rankFinal,
        rankCalculatedFinal: team.rankCalculatedFinal,
        playoffSeed: team.playoffSeed,
        seasonComplete,
        bracketFinal,
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
        seasonYear: season_year,
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
  const { league_id, season_year, week } = params;

  try {
    const credentials = await getCredentials(env, authHeader, correlationId);

    let path = `/seasons/${season_year}/segments/0/leagues/${league_id}?view=mMatchupScore&view=mScoreboard&view=mTeam`;
    if (week) {
      path += `&scoringPeriodId=${week}&matchupPeriodId=${week}`;
    }

    const response = await espnFetch(path, GAME_ID, {
      credentials,
      timeout: 7000,
      league: {
        leagueId: league_id,
        espnSeasonYear: season_year,
        historical: season_year < getCurrentSeasonYear('football'),
      },
    });

    if (!response.ok) {
      handleEspnError(response);
    }

    const data = await readEspnLeagueJson(response, isEspnLeagueResponse);
    const currentMatchupPeriod = data?.currentMatchupPeriod ?? data?.status?.currentMatchupPeriod;
    const schedule = data?.schedule || [];
    const teamsById = Object.fromEntries(
      (data?.teams || []).map((team) => [
        team.id,
        team.location && team.nickname
          ? `${team.location} ${team.nickname}`
          : team.name || `Team ${team.id}`,
      ])
    );

    // Transform matchups
    const matchupPeriod = week ?? currentMatchupPeriod ?? data?.scoringPeriodId;
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
        seasonYear: season_year,
        currentScoringPeriod: data?.scoringPeriodId,
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
  const { league_id, season_year, team_id } = params;
  const snapshot = params.rosterSnapshot ?? resolveRosterSnapshotFromParams(params);
  if (!snapshot) {
    return malformedRosterSnapshotError();
  }
  if (snapshot.type === 'date') {
    return rosterSnapshotUnsupportedError('espn', 'football');
  }

  try {
    const credentials = await getCredentials(env, authHeader, correlationId);
    requireCredentials(credentials, 'roster data');

    let path = `/seasons/${season_year}/segments/0/leagues/${league_id}?view=mRoster&view=mTeam&view=mSettings`;
    let providerScoringPeriodId: number | undefined;
    if (snapshot.type === 'week') {
      providerScoringPeriodId = snapshot.week;
      path += `&scoringPeriodId=${snapshot.week}`;
    }

    const response = await espnFetch(path, GAME_ID, {
      credentials,
      timeout: 7000,
      league: {
        leagueId: league_id,
        espnSeasonYear: season_year,
        historical: season_year < getCurrentSeasonYear('football'),
      },
    });

    if (!response.ok) {
      handleEspnError(response);
    }

    const data = await readEspnLeagueJson(response, isEspnLeagueResponse) ?? {};
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
        ...currentClubAndInjuryFields(
          snapshot,
          getProTeamAbbrev(player?.proTeamId || 0),
          player?.injuryStatus ? getInjuryStatus(player.injuryStatus) : undefined
        ),
        percentOwned: player?.ownership?.percentOwned,
        percentStarted: player?.ownership?.percentStarted,
        stats: currentStats?.stats ? transformStats(currentStats.stats) : undefined,
        acquisitionType: entry.acquisitionType,
        acquisitionDate: entry.acquisitionDate,
        keeperValue: entry.playerPoolEntry?.keeperValue,
        // keeperValueFuture is next season's cost — not yet fixed as of a
        // past week/date, so historical snapshots withhold it entirely
        // (FLA-284 temporal purity, mirroring FLA-278's proTeam/injuryStatus
        // omission below via buildRosterLimitations).
        ...(snapshot.type === 'current'
          ? { keeperValueFuture: entry.playerPoolEntry?.keeperValueFuture }
          : {}),
      };
    });

    const ownerName = team.owners?.map((o) => o.displayName || o.firstName).find(Boolean) || undefined;

    const acquisitionMetadataMissing = snapshot.type !== 'current'
      && roster.length > 0
      && roster.some((entry) => entry.acquisitionType == null || entry.acquisitionDate == null);
    const limitations = buildRosterLimitations(snapshot, acquisitionMetadataMissing);

    // Keeper cost unit depends on the league's draft type; requires mSettings
    // in this fetch (added above). Omit rather than guess when unavailable.
    const draftType = data.settings?.draftSettings?.type;
    const keeperValueUnit = resolveKeeperValueUnit(draftType);
    const keeperCount = data.settings?.draftSettings?.keeperCount;

    return {
      success: true,
      data: {
        leagueId: league_id,
        teamId: team.id,
        teamName: team.location && team.nickname
          ? `${team.location} ${team.nickname}`
          : team.name || `Team ${team.id}`,
        ownerName,
        snapshot: toSnapshotMetadata(snapshot, { providerScoringPeriodId }),
        ...(limitations ? { limitations } : {}),
        ...(keeperValueUnit ? { keeperValueUnit } : {}),
        ...(keeperCount != null ? { isKeeperLeague: keeperCount > 0 } : {}),
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

async function handleSearchPlayers(
  env: Env,
  params: RoutedToolParams,
  authHeader?: string,
  correlationId?: string,
): Promise<ExecuteResponse> {
  const { query, position, count, season_year, league_id } = params;

  if (!query) {
    return { success: false, error: 'query is required for get_players', code: 'MISSING_PARAM' };
  }

  try {
    const limit = Math.max(1, Math.min(25, Math.trunc(Number.isFinite(Number(count)) ? Number(count) : 10)));
    const playersIndex = await getEspnPlayersIndex(env, 'football', season_year);
    const normalizedQuery = query.toLowerCase();
    // Normalize common D/ST alias so "DST" matches ESPN's "D/ST" label
    const rawPosition = position?.trim().toUpperCase();
    const normalizedPosition = rawPosition === 'DST' ? 'D/ST' : rawPosition;
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
      ? await fetchLeagueOwnershipMap(env, GAME_ID, league_id, season_year, authHeader, correlationId)
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

async function handleGetTransactions(
  env: Env,
  params: RoutedToolParams,
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  const { league_id, season_year, week, count, type } = params;

  try {
    assertTransactionsSeasonSupported('football', season_year);

    const credentials = await getCredentials(env, authHeader, correlationId);
    requireCredentials(credentials, 'get_transactions');

    const result = await executeEspnTransactionOperation({
      gameId: GAME_ID,
      leagueId: league_id,
      seasonYear: season_year,
      sport: 'football',
      credentials,
      requestedWeek: week,
      type,
      count,
      getPositionName,
      getProTeamAbbrev,
    });

    return {
      success: true,
      data: {
        platform: 'espn',
        sport: params.sport,
        league_id,
        season_year,
        ...result,
        count: result.transactions.length,
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
