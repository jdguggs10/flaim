import type { HandlerFn, SleeperSportConfig } from './types';
import { getSleeperPlayersIndex } from '../sleeper-players-cache';
import { buildSleeperPlayerSearch } from '../sleeper-free-agents';
import { ErrorCode } from '@flaim/worker-shared';
import { toExecuteErrorResponse } from './utils';

export function createSearchPlayersHandler(config: SleeperSportConfig): HandlerFn {
  return async (env, params) => {
    const { query, position, count } = params;

    if (!query) {
      return { success: false, error: 'query is required for get_players', code: ErrorCode.MISSING_PARAM };
    }

    try {
      const requestedCount = Math.max(1, Math.min(25, Math.trunc(Number.isFinite(Number(count)) ? Number(count) : 10)));
      const playersIndex = await getSleeperPlayersIndex(env, config.sport);
      const players = buildSleeperPlayerSearch(playersIndex, query, position, requestedCount);

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
