import type { HandlerFn, YahooHandlerContext } from './types';
import { getYahooCredentials } from '../auth';
import { yahooFetch, handleYahooError, requireCredentials } from '../yahoo-api';
import { asArray, getPath, unwrapTeam } from '../normalizers';
import {
  ErrorCode,
  getRosterSelectorCapability,
  resolveRosterSnapshotFromParams,
  rosterSnapshotUnsupportedError,
  toSnapshotMetadata,
  type SeasonSport,
} from '@flaim/worker-shared';
import { extractManagerName, extractPlayerMeta, toExecuteErrorResponse } from './utils';

export function createGetRosterHandler(config: YahooHandlerContext): HandlerFn {
  return async (env, params, authHeader, correlationId) => {
    const { team_id, league_id } = params;
    const sport = config.sport as SeasonSport;

    const snapshot = params.rosterSnapshot ?? resolveRosterSnapshotFromParams(params);
    const capability = getRosterSelectorCapability('yahoo', sport);
    if (
      (snapshot.type === 'week' && capability !== 'week') ||
      (snapshot.type === 'date' && capability !== 'date')
    ) {
      return rosterSnapshotUnsupportedError('yahoo', sport);
    }

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

      const selector = snapshot.type === 'week'
        ? `;week=${snapshot.week}`
        : snapshot.type === 'date'
          ? `;date=${snapshot.date}`
          : '';
      const response = await yahooFetch(`/team/${teamKey}/roster${selector}`, { credentials });
      if (!response.ok) {
        await handleYahooError(response);
      }

      const raw = await response.json();
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
          ownerName: extractManagerName(team),
          snapshot: toSnapshotMetadata(snapshot),
          players,
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
