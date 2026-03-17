import type { HandlerFn, SleeperSportConfig } from './types';
import { fetchSleeperTransactionsByWeeks, getSleeperCurrentWeek } from '../sleeper-transactions';
import { getSleeperPlayersIndex } from '../sleeper-players-cache';
import { ErrorCode } from '@flaim/worker-shared';
import { toExecuteErrorResponse } from './utils';

export function createGetTransactionsHandler(config: SleeperSportConfig): HandlerFn {
  return async (env, params) => {
    const { league_id, week, count, type } = params;
    if (!league_id) {
      return { success: false, error: 'league_id is required for get_transactions', code: ErrorCode.MISSING_PARAM };
    }

    try {
      const currentWeek = week || await getSleeperCurrentWeek(config.statePath);
      const weeks = week ? [Math.max(1, week)] : Array.from(new Set([currentWeek, Math.max(1, currentWeek - 1)]));
      const rawCount = Number.isFinite(Number(count)) ? Number(count) : 25;
      const maxCount = Math.max(1, Math.min(100, Math.trunc(rawCount)));

      let resolvePlayer:
        | ((playerId: string) => { name?: string; position?: string; team?: string } | undefined)
        | undefined;

      try {
        const playersIndex = await getSleeperPlayersIndex(env, config.sport);
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
      return toExecuteErrorResponse(error);
    }
  };
}
