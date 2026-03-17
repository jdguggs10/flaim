import type { HandlerFn, YahooHandlerContext } from './types';
import { getYahooCredentials } from '../auth';
import { yahooFetch, handleYahooError, requireCredentials } from '../yahoo-api';
import { asArray, getPath, logStructure, unwrapLeague } from '../normalizers';
import { ErrorCode } from '@flaim/worker-shared';
import { extractPlayerMeta, toExecuteErrorResponse, withLogLabel } from './utils';

export function createGetFreeAgentsHandler(config: YahooHandlerContext): HandlerFn {
  return async (env, params, authHeader, correlationId) => {
    const { league_id, position, count } = params;

    if (!league_id) {
      return {
        success: false,
        error: 'league_id is required for get_free_agents',
        code: ErrorCode.MISSING_PARAM,
      };
    }

    try {
      const credentials = await getYahooCredentials(env, authHeader, correlationId);
      requireCredentials(credentials, 'get_free_agents');

      const limit = Math.min(Math.max(1, count || 25), 100);
      let queryParams = `;status=FA;count=${limit}`;

      const posFilter = config.getPositionFilter(position);
      if (posFilter) {
        queryParams += `;position=${posFilter}`;
      }

      const response = await yahooFetch(`/league/${league_id}/players${queryParams}`, { credentials });
      if (!response.ok) {
        handleYahooError(response);
      }

      const raw = await response.json();
      logStructure(withLogLabel('get_free_agents raw', config.logLabelSuffix), raw);

      const leagueArray = getPath(raw, ['fantasy_content', 'league']);
      const league = unwrapLeague(leagueArray);
      const playersObj = league.players as Record<string, unknown> | undefined;
      const playersArray = asArray(playersObj);

      const freeAgents = playersArray.map((playerWrapper: unknown) => {
        const playerData = getPath(playerWrapper, ['player']) as unknown[];
        const playerMeta = extractPlayerMeta(playerData);

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
          freeAgents,
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
