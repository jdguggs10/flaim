import type { HandlerFn, SleeperSportConfig } from './types';
import {
  attachTeamNames,
  fetchSleeperRosterTeams,
  fetchSleeperTransactionsByWeeks,
  getSleeperCurrentWeek,
  type PlayerResolver,
} from '../sleeper-transactions';
import { getSleeperPlayersIndex } from '../sleeper-players-cache';
import { ErrorCode, validateTransactionWeekInput } from '@flaim/worker-shared';
import { toExecuteErrorResponse } from './utils';
import { SLEEPER_PLAYER_ENRICHMENT_WARNING } from '../sleeper-enrichment';

export const TEAMS_UNAVAILABLE_WARNING =
  'TEAMS_UNAVAILABLE: Sleeper roster/owner data unavailable; team names omitted from this transactions response.';

export function createGetTransactionsHandler(config: SleeperSportConfig): HandlerFn {
  return async (env, params) => {
    const { league_id, week, count, type } = params;
    if (!league_id) {
      return { success: false, error: 'league_id is required for get_transactions', code: ErrorCode.MISSING_PARAM };
    }

    const weekValidation = validateTransactionWeekInput('sleeper', week);
    if (!weekValidation.ok) {
      return {
        success: false,
        code: weekValidation.code,
        error: weekValidation.error,
        status: weekValidation.status,
        retryable: weekValidation.retryable,
      };
    }

    try {
      const explicitWeek = weekValidation.week;
      const currentWeek = explicitWeek ?? await getSleeperCurrentWeek(config.statePath);
      const weeks = explicitWeek !== undefined
        ? [explicitWeek]
        : Array.from(new Set([currentWeek, Math.max(1, currentWeek - 1)]));
      const rawCount = Number.isFinite(Number(count)) ? Number(count) : 25;
      const maxCount = Math.max(1, Math.min(100, Math.trunc(rawCount)));

      // Kick off the roster/owner team-name fetch in parallel with the
      // player-index load and per-week transaction fetches below — it
      // degrades independently (a warning, no `teams`/`teamOwners`) rather
      // than failing the whole get_transactions call.
      const rosterTeamsPromise = fetchSleeperRosterTeams(league_id);

      const warnings: string[] = [];
      let resolvePlayer: PlayerResolver | undefined;

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
        warnings.push(SLEEPER_PLAYER_ENRICHMENT_WARNING);
      }

      const rows = await fetchSleeperTransactionsByWeeks(league_id, weeks, resolvePlayer);
      const filtered = rows
        .filter((txn) => !type || txn.type === type)
        .slice(0, maxCount);

      let teams: Record<string, string> | undefined;
      let teamOwners: Record<string, string> | undefined;
      try {
        const resolved = await rosterTeamsPromise;
        teams = resolved.teams;
        teamOwners = resolved.teamOwners;
      } catch (error) {
        console.error(`[handleGetTransactions] Failed to load rosters/users for team names in league ${league_id}:`, error);
        warnings.push(TEAMS_UNAVAILABLE_WARNING);
      }

      const transactions = attachTeamNames(filtered, teams);

      return {
        success: true,
        data: {
          platform: 'sleeper',
          sport: config.sport,
          league_id,
          season_year: params.season_year,
          window: {
            mode: explicitWeek !== undefined ? 'explicit_week' : 'recent_two_weeks',
            weeks,
          },
          count: transactions.length,
          transactions,
          ...(teams ? { teams } : {}),
          ...(teamOwners ? { teamOwners } : {}),
          ...(warnings.length > 0 ? { warnings } : {}),
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
