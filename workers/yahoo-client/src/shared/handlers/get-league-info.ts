import type { HandlerFn, YahooHandlerContext } from './types';
import { getYahooCredentials } from '../auth';
import { yahooFetch, handleYahooError, requireCredentials } from '../yahoo-api';
import { asArray, getPath, logStructure, unwrapLeague, unwrapTeam } from '../normalizers';
import { ErrorCode } from '@flaim/worker-shared';
import { extractManagerName, toExecuteErrorResponse, withLogLabel } from './utils';

export function createGetLeagueInfoHandler(config: YahooHandlerContext): HandlerFn {
  return async (env, params, authHeader, correlationId) => {
    const { league_id } = params;

    if (!league_id) {
      return {
        success: false,
        error: 'league_id is required for get_league_info',
        code: ErrorCode.MISSING_PARAM,
      };
    }

    try {
      const credentials = await getYahooCredentials(env, authHeader, correlationId);
      requireCredentials(credentials, 'get_league_info');

      const response = await yahooFetch(`/league/${league_id}/teams`, { credentials });
      if (!response.ok) {
        handleYahooError(response);
      }

      const raw = await response.json();
      logStructure(withLogLabel('get_league_info raw', config.logLabelSuffix), raw);

      const leagueArray = getPath(raw, ['fantasy_content', 'league']);
      const league = unwrapLeague(leagueArray);

      // Extract teams from the /teams sub-resource
      const teamsObj = getPath(league, ['teams']) as Record<string, unknown> | undefined;
      const teamsArray = asArray(teamsObj);

      const teams = teamsArray.map((teamWrapper: unknown) => {
        const teamData = getPath(teamWrapper, ['team']) as unknown[];
        const team = unwrapTeam(teamData);
        return {
          teamKey: team.team_key as string | undefined,
          teamId: team.team_id as string | undefined,
          teamName: team.name as string | undefined,
          ownerName: extractManagerName(team),
        };
      });

      return {
        success: true,
        data: {
          leagueKey: league.league_key,
          leagueId: league.league_id,
          name: league.name,
          url: league.url,
          numTeams: league.num_teams,
          scoringType: league.scoring_type,
          currentWeek: league.current_week,
          startWeek: league.start_week,
          endWeek: league.end_week,
          isFinished: league.is_finished === 1,
          draftStatus: league.draft_status,
          teams,
          ...config.extraLeagueFields?.(league),
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
