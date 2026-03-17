import type { HandlerFn, YahooHandlerContext } from './types';
import { getYahooCredentials } from '../auth';
import { yahooFetch, handleYahooError, requireCredentials } from '../yahoo-api';
import { getPath, logStructure, unwrapLeague } from '../normalizers';
import { toExecuteErrorResponse, withLogLabel } from './utils';

export function createGetLeagueInfoHandler(config: YahooHandlerContext): HandlerFn {
  return async (env, params, authHeader, correlationId) => {
    const { league_id } = params;

    try {
      const credentials = await getYahooCredentials(env, authHeader, correlationId);
      requireCredentials(credentials, 'get_league_info');

      const response = await yahooFetch(`/league/${league_id}`, { credentials });
      if (!response.ok) {
        handleYahooError(response);
      }

      const raw = await response.json();
      logStructure(withLogLabel('get_league_info raw', config.logLabelSuffix), raw);

      const leagueArray = getPath(raw, ['fantasy_content', 'league']);
      const league = unwrapLeague(leagueArray);

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
          ...config.extraLeagueFields?.(league),
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
