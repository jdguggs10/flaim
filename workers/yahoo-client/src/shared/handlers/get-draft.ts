import { ErrorCode } from '@flaim/worker-shared';
import { getYahooCredentials } from '../auth';
import { handleYahooError, requireCredentials, yahooFetch } from '../yahoo-api';
import { parseYahooDraftResults } from '../yahoo-draft';
import { toExecuteErrorResponse } from './utils';
import type { HandlerFn, YahooHandlerContext } from './types';

export function createGetDraftHandler(_config: YahooHandlerContext): HandlerFn {
  return async (env, params, authHeader, correlationId) => {
    const { league_id: leagueId, season_year: seasonYear, sport } = params;
    if (!leagueId) {
      return {
        success: false,
        error: 'league_id is required for get_draft',
        code: ErrorCode.MISSING_PARAM,
      };
    }

    try {
      const credentials = await getYahooCredentials(env, authHeader, correlationId);
      requireCredentials(credentials, 'get_draft');

      const response = await yahooFetch(`/league/${leagueId}/draftresults`, { credentials });
      if (!response.ok) await handleYahooError(response);

      const parsed = parseYahooDraftResults(await response.json());
      if (!parsed) {
        return {
          success: false,
          error: 'Yahoo returned an invalid draft-results payload',
          code: 'YAHOO_INVALID_DRAFT_RESULTS',
        };
      }
      if (parsed.draft.status === 'complete' && parsed.picks.length === 0) {
        return {
          success: false,
          error: 'Yahoo reports a completed draft but returned no usable draft selections',
          code: 'YAHOO_DRAFT_RESULTS_UNAVAILABLE',
        };
      }

      return {
        success: true,
        data: {
          platform: 'yahoo',
          sport,
          leagueId,
          seasonYear,
          draft: parsed.draft,
          picks: parsed.picks,
          ...(parsed.warnings ? { warnings: parsed.warnings } : {}),
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
