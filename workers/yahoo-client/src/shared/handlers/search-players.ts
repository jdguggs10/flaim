import type { HandlerFn, YahooHandlerContext } from './types';
import { getYahooCredentials } from '../auth';
import { yahooFetch, handleYahooError, requireCredentials } from '../yahoo-api';
import { asArray, getPath, unwrapLeague, parseYahooPercentOwned } from '../normalizers';
import { extractPlayerMeta, toExecuteErrorResponse } from './utils';

export function createSearchPlayersHandler(config: YahooHandlerContext): HandlerFn {
  return async (env, params, authHeader, correlationId) => {
    const { league_id, query, position, count } = params;

    if (!query) {
      return { success: false, error: 'query is required for get_players', code: 'MISSING_PARAM' };
    }

    try {
      const credentials = await getYahooCredentials(env, authHeader, correlationId);
      requireCredentials(credentials, 'get_players');

      const limit = Math.min(Math.max(1, count || 10), 25);
      let queryParams = `;search=${encodeURIComponent(query)};count=${limit}`;

      const posFilter = config.getPositionFilter(position);
      if (posFilter) {
        queryParams += `;position=${posFilter}`;
      }

      const response = await yahooFetch(`/league/${league_id}/players${queryParams}`, { credentials });
      if (!response.ok) {
        handleYahooError(response);
      }

      const raw = await response.json();
      const leagueArray = getPath(raw, ['fantasy_content', 'league']);
      const league = unwrapLeague(leagueArray);
      const playersObj = league.players as Record<string, unknown> | undefined;
      const playersArray = asArray(playersObj);

      const players = playersArray.map((playerWrapper: unknown) => {
        const playerData = getPath(playerWrapper, ['player']) as unknown[];
        const playerMeta = extractPlayerMeta(playerData);

        const ownershipData = playerData?.[1] as Record<string, unknown> | undefined;
        const ownership = ownershipData?.ownership as Record<string, unknown> | undefined;

        return {
          id: playerMeta.player_id as string,
          name: (playerMeta.name as Record<string, unknown>)?.full as string,
          team: playerMeta.editorial_team_abbr as string,
          position: playerMeta.display_position as string,
          market_percent_owned: parseYahooPercentOwned(ownership?.percent_owned),
          ownership_scope: 'platform_global' as const,
        };
      });

      return {
        success: true,
        data: {
          leagueKey: league.league_key,
          leagueName: league.name,
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
