import type { HandlerFn, SleeperSportConfig } from './types';
import { getSleeperPlayersIndex } from '../sleeper-players-cache';
import { buildSleeperPlayerSearch } from '../sleeper-free-agents';
import { ErrorCode } from '@flaim/worker-shared';
import { toExecuteErrorResponse } from './utils';
import { handleSleeperError, sleeperFetch } from '../sleeper-api';
import type { SleeperLeagueUser, SleeperRoster } from '../../types';
import {
  buildSleeperLeagueOwnershipMap,
  resolveSleeperPlayerAvailability,
  toSleeperLeagueAvailabilityFields,
} from '../sleeper-league-ownership';

export function createSearchPlayersHandler(config: SleeperSportConfig): HandlerFn {
  return async (env, params) => {
    const { query, position, count, league_id } = params;

    if (!query?.trim()) {
      return { success: false, error: 'query is required for get_players', code: ErrorCode.MISSING_PARAM };
    }
    if (!league_id) {
      return { success: false, error: 'league_id is required for get_players', code: ErrorCode.MISSING_PARAM };
    }

    try {
      const requestedCount = Math.max(1, Math.min(25, Math.trunc(Number.isFinite(Number(count)) ? Number(count) : 10)));
      const [playersIndex, rostersRes, usersRes] = await Promise.all([
        getSleeperPlayersIndex(env, config.sport),
        sleeperFetch(`/league/${league_id}/rosters`),
        sleeperFetch(`/league/${league_id}/users`),
      ]);

      if (!rostersRes.ok) handleSleeperError(rostersRes);
      if (!usersRes.ok) handleSleeperError(usersRes);

      const rosters = await rostersRes.json() as SleeperRoster[];
      const users = await usersRes.json() as SleeperLeagueUser[];
      if (!Array.isArray(rosters) || !Array.isArray(users)) {
        throw new Error('SLEEPER_API_ERROR: Sleeper returned malformed league roster ownership data');
      }

      // This map is constructed only from the exact league_id responses above
      // and is never cached across calls or leagues.
      const ownership = buildSleeperLeagueOwnershipMap(rosters, users);
      const players = buildSleeperPlayerSearch(playersIndex, query, position, requestedCount)
        .map((player) => ({
          ...player,
          ...toSleeperLeagueAvailabilityFields(
            resolveSleeperPlayerAvailability(player.id, ownership),
          ),
        }));

      return {
        success: true,
        data: {
          platform: 'sleeper',
          sport: config.sport,
          league_id,
          season_year: params.season_year,
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
