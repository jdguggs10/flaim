import type { HandlerFn, YahooHandlerContext } from './types';
import { getYahooCredentials } from '../auth';
import { yahooFetch, handleYahooError, requireCredentials } from '../yahoo-api';
import { asArray, getPath, unwrapLeague, unwrapTeam } from '../normalizers';
import { ErrorCode } from '@flaim/worker-shared';
import { toExecuteErrorResponse } from './utils';

function parseNullableNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * For Yahoo's 1-based ordinals (playoff seed, waiver priority). Yahoo sends 0,
 * '', or a non-numeric placeholder when the ordinal doesn't apply, and a 0 would
 * otherwise read as ranking ahead of first.
 */
function parsePositiveOrdinal(value: unknown): number | null {
  const parsed = parseNullableNumber(value);
  return parsed != null && Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

export function createGetStandingsHandler(_config: YahooHandlerContext): HandlerFn {
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
        await handleYahooError(response);
      }

      const raw = await response.json();
      const leagueArray = getPath(raw, ['fantasy_content', 'league']);
      const league = unwrapLeague(leagueArray);

      // seasonPhase detection
      // Yahoo sets is_finished=1 when the season is over; playoff_start_week=0 means no playoffs configured.
      const isFinished = league.is_finished === 1;
      // Guard against NaN if Yahoo returns non-numeric strings or missing fields
      const currentWeek = Number.isFinite(Number(league.current_week)) ? Number(league.current_week) : 0;
      const playoffStartWeek = Number.isFinite(Number(league.playoff_start_week)) ? Number(league.playoff_start_week) : 0;

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

        const playoffSeed = parsePositiveOrdinal(teamStandings?.playoff_seed);

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
          waiverPriority: parsePositiveOrdinal(team.waiver_priority),
          // Unlike waiver priority, 0 is a real FAAB balance — a team that spent out.
          faabBalance: parseNullableNumber(team.faab_balance),
          playoffSeed,
          madePlayoffs: playoffSeed != null ? true : null,
          // Yahoo's API doesn't expose reliable postseason final rankings.
          // All outcome fields are intentionally null; populate if/when Yahoo API improves.
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
