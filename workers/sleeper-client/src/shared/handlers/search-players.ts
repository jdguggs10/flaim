import type { HandlerFn, SleeperSportConfig } from './types';
import { getSleeperPlayersIndex } from '../sleeper-players-cache';
import { buildSleeperPlayerSearch } from '../sleeper-free-agents';
import { loadSleeperLeagueOwnership, resolveSleeperPlayerLeagueAvailability } from '../sleeper-league-ownership';
import { ErrorCode } from '@flaim/worker-shared';
import { toExecuteErrorResponse } from './utils';

export function createSearchPlayersHandler(config: SleeperSportConfig): HandlerFn {
  return async (env, params) => {
    const { query, position, count, league_id } = params;

    if (!query) {
      return { success: false, error: 'query is required for get_players', code: ErrorCode.MISSING_PARAM };
    }
    if (!league_id) {
      return { success: false, error: 'league_id is required for get_players', code: ErrorCode.MISSING_PARAM };
    }

    try {
      const requestedCount = Math.max(1, Math.min(25, Math.trunc(Number.isFinite(Number(count)) ? Number(count) : 10)));
      // Loaded concurrently: an unavailable/errored rosters fetch must fail
      // the whole request (via the catch below) rather than silently
      // reporting every matched player AVAILABLE.
      const [playersIndex, ownershipContext] = await Promise.all([
        getSleeperPlayersIndex(env, config.sport),
        loadSleeperLeagueOwnership(league_id),
      ]);
      const matches = buildSleeperPlayerSearch(playersIndex, query, position, requestedCount);
      const players = matches.map((player) => ({
        ...player,
        ...resolveSleeperPlayerLeagueAvailability(player.id, ownershipContext),
      }));

      return {
        success: true,
        data: {
          platform: 'sleeper',
          sport: config.sport,
          query,
          count: players.length,
          players,
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
