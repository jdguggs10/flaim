import type { HandlerFn, YahooHandlerContext } from './types';
import { getYahooCredentials } from '../auth';
import { yahooFetch, handleYahooError, requireCredentials } from '../yahoo-api';
import { asArray, getPath, logStructure, unwrapTeam } from '../normalizers';
import { ErrorCode } from '@flaim/worker-shared';
import { extractPlayerMeta, toExecuteErrorResponse, withLogLabel } from './utils';

export function createGetRosterHandler(config: YahooHandlerContext): HandlerFn {
  return async (env, params, authHeader, correlationId) => {
    const { team_id, league_id, week } = params;

    if (!team_id) {
      return {
        success: false,
        error: 'team_id is required for get_roster',
        code: ErrorCode.MISSING_PARAM,
      };
    }

    const teamKey = team_id.includes('.') ? team_id : `${league_id}.t.${team_id}`;

    try {
      const credentials = await getYahooCredentials(env, authHeader, correlationId);
      requireCredentials(credentials, 'get_roster');

      const weekParam = week ? `;week=${week}` : '';
      const response = await yahooFetch(`/team/${teamKey}/roster${weekParam}`, { credentials });
      if (!response.ok) {
        handleYahooError(response);
      }

      const raw = await response.json();
      logStructure(withLogLabel('get_roster raw', config.logLabelSuffix), raw);

      const teamArray = getPath(raw, ['fantasy_content', 'team']);
      const team = unwrapTeam(teamArray as unknown[]);

      const rosterData = team.roster as Record<string, unknown> | undefined;
      const playersObj = getPath(rosterData, ['0', 'players']) as Record<string, unknown> | undefined;
      const playersArray = asArray(playersObj);

      const players = playersArray.map((playerWrapper: unknown) => {
        const playerData = getPath(playerWrapper, ['player']) as unknown[];
        const playerMeta = extractPlayerMeta(playerData);

        const positionData = playerData?.[1] as Record<string, unknown> | undefined;
        const selectedPosition = positionData?.selected_position as Record<string, unknown>[] | undefined;
        const position = selectedPosition?.[1]?.position;

        return {
          playerKey: playerMeta.player_key,
          playerId: playerMeta.player_id,
          name: (playerMeta.name as Record<string, unknown>)?.full,
          team: playerMeta.editorial_team_abbr,
          position: playerMeta.display_position,
          selectedPosition: position,
          status: playerMeta.status,
        };
      });

      return {
        success: true,
        data: {
          teamKey: team.team_key,
          teamName: team.name,
          week: week || 'current',
          players,
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
