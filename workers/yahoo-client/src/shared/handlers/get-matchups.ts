import type { HandlerFn, YahooHandlerContext } from './types';
import { getYahooCredentials } from '../auth';
import { yahooFetch, handleYahooError, requireCredentials } from '../yahoo-api';
import { asArray, getPath, logStructure, unwrapLeague, unwrapTeam } from '../normalizers';
import { toExecuteErrorResponse, withLogLabel } from './utils';

export function createGetMatchupsHandler(config: YahooHandlerContext): HandlerFn {
  return async (env, params, authHeader, correlationId) => {
    const { league_id, week } = params;

    try {
      const credentials = await getYahooCredentials(env, authHeader, correlationId);
      requireCredentials(credentials, 'get_matchups');

      const weekParam = week ? `;week=${week}` : '';
      const response = await yahooFetch(`/league/${league_id}/scoreboard${weekParam}`, { credentials });
      if (!response.ok) {
        handleYahooError(response);
      }

      const raw = await response.json();
      logStructure(withLogLabel('get_matchups raw', config.logLabelSuffix), raw);

      const leagueArray = getPath(raw, ['fantasy_content', 'league']);
      const league = unwrapLeague(leagueArray);
      const currentWeek = league.current_week as number | undefined;

      const scoreboardData = league.scoreboard as Record<string, unknown> | undefined;
      const matchupsObj = getPath(scoreboardData, ['0', 'matchups']) as Record<string, unknown> | undefined;
      const matchupsArray = asArray(matchupsObj);

      const matchups = matchupsArray.map((matchupWrapper: unknown, index: number) => {
        const matchupObj = getPath(matchupWrapper, ['matchup']) as Record<string, unknown> | undefined;
        const matchupContent = matchupObj?.['0'] as Record<string, unknown> | undefined;
        const teamsObj = matchupContent?.teams as Record<string, unknown> | undefined;
        const teamsArray = asArray(teamsObj);

        const parseTeam = (teamWrapper: unknown) => {
          const teamData = getPath(teamWrapper, ['team']) as unknown[];
          const team = unwrapTeam(teamData);
          const teamPoints = team.team_points as Record<string, unknown> | undefined;
          const teamProjectedPoints = team.team_projected_points as Record<string, unknown> | undefined;

          return {
            teamKey: team.team_key as string,
            teamId: team.team_id as string,
            teamName: team.name as string,
            points: teamPoints?.total ? parseFloat(String(teamPoints.total)) : 0,
            projectedPoints: teamProjectedPoints?.total ? parseFloat(String(teamProjectedPoints.total)) : undefined,
          };
        };

        const home = teamsArray[0] ? parseTeam(teamsArray[0]) : null;
        const away = teamsArray[1] ? parseTeam(teamsArray[1]) : null;

        let winner: string | undefined;
        if (home && away && (home.points > 0 || away.points > 0)) {
          if (home.points > away.points) winner = 'home';
          else if (away.points > home.points) winner = 'away';
          else winner = 'tie';
        }

        return {
          matchupId: index + 1,
          week: week || currentWeek,
          home,
          away,
          winner,
        };
      });

      return {
        success: true,
        data: {
          leagueKey: league.league_key,
          leagueName: league.name,
          currentWeek,
          matchupWeek: week || currentWeek,
          matchups,
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
