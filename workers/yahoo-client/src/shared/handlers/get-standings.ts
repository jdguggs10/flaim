import type { HandlerFn, YahooHandlerContext } from './types';
import { getYahooCredentials } from '../auth';
import { yahooFetch, handleYahooError, requireCredentials } from '../yahoo-api';
import { asArray, getPath, logStructure, unwrapLeague, unwrapTeam } from '../normalizers';
import { ErrorCode } from '@flaim/worker-shared';
import { toExecuteErrorResponse, withLogLabel } from './utils';

export function createGetStandingsHandler(config: YahooHandlerContext): HandlerFn {
  return async (env, params, authHeader, correlationId) => {
    const { league_id } = params;

    if (!league_id) {
      return {
        success: false,
        error: 'league_id is required for get_standings',
        code: ErrorCode.MISSING_PARAM,
      };
    }

    try {
      const credentials = await getYahooCredentials(env, authHeader, correlationId);
      requireCredentials(credentials, 'get_standings');

      const response = await yahooFetch(`/league/${league_id}/standings`, { credentials });
      if (!response.ok) {
        handleYahooError(response);
      }

      const raw = await response.json();
      logStructure(withLogLabel('get_standings raw', config.logLabelSuffix), raw);

      const leagueArray = getPath(raw, ['fantasy_content', 'league']);
      const league = unwrapLeague(leagueArray);

      const teamsObj = getPath(league, ['standings', 0, 'teams']) as Record<string, unknown> | undefined;
      const teamsArray = asArray(teamsObj);

      const standings = teamsArray.map((teamWrapper: unknown) => {
        const teamData = getPath(teamWrapper, ['team']) as unknown[];
        const team = unwrapTeam(teamData);
        const teamStandings = team.team_standings as Record<string, unknown> | undefined;
        const outcomeTotals = teamStandings?.outcome_totals as Record<string, unknown> | undefined;

        return {
          rank: teamStandings?.rank,
          teamKey: team.team_key,
          teamId: team.team_id,
          name: team.name,
          wins: outcomeTotals?.wins,
          losses: outcomeTotals?.losses,
          ties: outcomeTotals?.ties,
          percentage: outcomeTotals?.percentage,
          pointsFor: teamStandings?.points_for,
          pointsAgainst: teamStandings?.points_against,
        };
      });

      return {
        success: true,
        data: {
          leagueKey: league.league_key,
          leagueName: league.name,
          standings: standings.sort((a, b) => Number(a.rank) - Number(b.rank)),
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
