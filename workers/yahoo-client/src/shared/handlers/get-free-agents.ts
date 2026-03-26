import type { HandlerFn, YahooHandlerContext } from './types';
import { getYahooCredentials } from '../auth';
import { yahooFetch, handleYahooError, requireCredentials } from '../yahoo-api';
import { asArray, getPath, logStructure, unwrapLeague } from '../normalizers';
import { ErrorCode } from '@flaim/worker-shared';
import { extractPlayerMeta, extractPlayerPercentOwned, toExecuteErrorResponse, withLogLabel } from './utils';

const YAHOO_PAGE_SIZE = 100;

type YahooFreeAgent = {
  playerKey: string;
  playerId: string;
  name: string;
  team: string;
  position: string;
  percentOwned: number | null;
  status: string | undefined;
};

function compareFreeAgents(a: YahooFreeAgent, b: YahooFreeAgent): number {
  const aOwned = a.percentOwned;
  const bOwned = b.percentOwned;

  if (aOwned == null && bOwned != null) return 1;
  if (aOwned != null && bOwned == null) return -1;
  if (aOwned != null && bOwned != null && aOwned !== bOwned) return bOwned - aOwned;

  const nameCompare = a.name.localeCompare(b.name);
  if (nameCompare !== 0) return nameCompare;

  return a.playerId.localeCompare(b.playerId);
}

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
      const positionKey = position?.toUpperCase() || 'ALL';
      const posFilter = config.getPositionFilter(position);
      const allFreeAgents: YahooFreeAgent[] = [];

      let league: Record<string, unknown> = {};

      for (let start = 0; ; start += YAHOO_PAGE_SIZE) {
        let queryParams = `;status=A;count=${YAHOO_PAGE_SIZE};sort=OR;start=${start}`;
        if (posFilter) {
          queryParams += `;position=${posFilter}`;
        }

        const response = await yahooFetch(`/league/${league_id}/players${queryParams}/ownership`, { credentials });
        if (!response.ok) {
          handleYahooError(response);
        }

        const raw = await response.json();
        logStructure(withLogLabel(`get_free_agents raw start=${start}`, config.logLabelSuffix), raw);

        const leagueArray = getPath(raw, ['fantasy_content', 'league']);
        league = unwrapLeague(leagueArray);
        const playersObj = league.players as Record<string, unknown> | undefined;
        const playersArray = asArray(playersObj);

        allFreeAgents.push(
          ...playersArray.map((playerWrapper: unknown) => {
            const playerData = getPath(playerWrapper, ['player']) as unknown[];
            const playerMeta = extractPlayerMeta(playerData);

            return {
              playerKey: playerMeta.player_key as string,
              playerId: playerMeta.player_id as string,
              name: (playerMeta.name as Record<string, unknown>)?.full as string,
              team: playerMeta.editorial_team_abbr as string,
              position: playerMeta.display_position as string,
              percentOwned: extractPlayerPercentOwned(playerData),
              status: playerMeta.status as string | undefined,
            };
          })
        );

        if (playersArray.length < YAHOO_PAGE_SIZE) {
          break;
        }
      }

      const freeAgents = allFreeAgents.sort(compareFreeAgents).slice(0, limit);

      return {
        success: true,
        data: {
          leagueKey: league.league_key,
          leagueName: league.name,
          position: positionKey,
          count: freeAgents.length,
          freeAgents,
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
