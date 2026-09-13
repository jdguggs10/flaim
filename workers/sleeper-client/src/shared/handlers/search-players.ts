import type { HandlerFn, SleeperSportConfig } from './types';
import { getSleeperPlayersIndex } from '../sleeper-players-cache';
import { buildSleeperPlayerSearch } from '../sleeper-free-agents';
import {
  loadSleeperLeagueOwnership,
  resolveSleeperPlayerLeagueAvailability,
  type SleeperLeagueOwnershipContext,
  type SleeperPlayerLeagueAvailability,
} from '../sleeper-league-ownership';
import { ErrorCode } from '@flaim/worker-shared';
import { toExecuteErrorResponse } from './utils';

const OWNERSHIP_UNAVAILABLE_WARNING =
  'SLEEPER_OWNERSHIP_UNAVAILABLE: League ownership could not be resolved for this search; league_status is unavailable for these results.';

const UNRESOLVED_AVAILABILITY: SleeperPlayerLeagueAvailability = {
  league_status: null,
  league_team_id: null,
  league_team_name: null,
  league_owner_name: null,
};

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
      // Started concurrently but settled independently (matches the ESPN/Yahoo
      // ownership builders): the player index is core to this tool — no
      // identity, no search possible — so its rejection still fails the whole
      // call below. League ownership is enrichment; a failed load degrades to
      // unresolved ownership (every league_* field null, plus a warning)
      // rather than losing identity results too. The one exception is an
      // active draft, which is structurally incomplete rather than merely
      // unreachable and is rethrown unchanged to fail the whole call — see
      // loadSleeperLeagueOwnership's SLEEPER_DRAFT_IN_PROGRESS guard.
      const [playersIndexResult, ownershipResult] = await Promise.allSettled([
        getSleeperPlayersIndex(env, config.sport),
        loadSleeperLeagueOwnership(league_id),
      ]);

      if (playersIndexResult.status === 'rejected') {
        throw playersIndexResult.reason;
      }
      const playersIndex = playersIndexResult.value;

      let ownershipContext: SleeperLeagueOwnershipContext | null = null;
      const warnings: string[] = [];
      if (ownershipResult.status === 'fulfilled') {
        ownershipContext = ownershipResult.value;
      } else {
        const { reason } = ownershipResult;
        if (reason instanceof Error && reason.message.startsWith(`${ErrorCode.SLEEPER_DRAFT_IN_PROGRESS}:`)) {
          throw reason;
        }
        console.warn(
          '[search-players] league ownership load failed, degrading to unresolved ownership:',
          reason instanceof Error ? reason.message : reason,
        );
        warnings.push(OWNERSHIP_UNAVAILABLE_WARNING);
      }

      const matches = buildSleeperPlayerSearch(playersIndex, query, position, requestedCount);
      const players = matches.map((player) => ({
        ...player,
        ...(ownershipContext
          ? resolveSleeperPlayerLeagueAvailability(player.id, ownershipContext)
          : UNRESOLVED_AVAILABILITY),
      }));

      return {
        success: true,
        data: {
          platform: 'sleeper',
          sport: config.sport,
          query,
          count: players.length,
          players,
          ...(warnings.length ? { warnings } : {}),
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
