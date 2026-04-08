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

      // seasonPhase detection
      // Yahoo sets is_finished=1 when the season is over; playoff_start_week=0 means no playoffs configured.
      const isFinished = league.is_finished === 1;
      const rawCurrentWeek = Number(league.current_week ?? 0);
      const rawPlayoffStart = Number(league.playoff_start_week ?? 0);
      // Guard against NaN if Yahoo returns non-numeric strings for these fields
      const currentWeek = Number.isFinite(rawCurrentWeek) ? rawCurrentWeek : 0;
      const playoffStartWeek = Number.isFinite(rawPlayoffStart) ? rawPlayoffStart : 0;

      let seasonPhase: 'regular_season' | 'playoffs_in_progress' | 'season_complete';
      if (isFinished) {
        seasonPhase = 'season_complete';
      } else if (playoffStartWeek > 0 && currentWeek >= playoffStartWeek) {
        seasonPhase = 'playoffs_in_progress';
      } else {
        seasonPhase = 'regular_season';
      }
      const seasonComplete = seasonPhase === 'season_complete';

      const teamsObj = getPath(league, ['standings', 0, 'teams']) as Record<string, unknown> | undefined;
      const teamsArray = asArray(teamsObj);

      const standings = teamsArray.map((teamWrapper: unknown) => {
        const teamData = getPath(teamWrapper, ['team']) as unknown[];
        const team = unwrapTeam(teamData);
        const teamStandings = team.team_standings as Record<string, unknown> | undefined;
        const outcomeTotals = teamStandings?.outcome_totals as Record<string, unknown> | undefined;

        const playoffSeed = teamStandings?.playoff_seed != null
          ? Number(teamStandings.playoff_seed)
          : null;

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
          playoffSeed,
          madePlayoffs: playoffSeed != null ? true : null,
          finalRank: null,
          championshipWon: null,
          playoffOutcome: null,
          outcomeConfidence: null,
        };
      });

      return {
        success: true,
        data: {
          leagueKey: league.league_key,
          leagueName: league.name,
          seasonPhase,
          seasonComplete,
          standings: standings.sort((a, b) => Number(a.rank) - Number(b.rank)),
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
