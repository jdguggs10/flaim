import type { HandlerFn, YahooHandlerContext } from './types';
import { getYahooCredentials } from '../auth';
import { yahooFetch, handleYahooError, requireCredentials } from '../yahoo-api';
import { asArray, getPath, toYahooBoolean, unwrapLeague, unwrapTeam } from '../normalizers';
import { ErrorCode } from '@flaim/worker-shared';
import { toExecuteErrorResponse } from './utils';
import { extractStatCategories, fetchLeagueSettings, type YahooStatCategory } from './league-settings';

const MATCHUP_CATEGORY_NAMES_UNAVAILABLE_WARNING =
  'MATCHUP_CATEGORY_NAMES_UNAVAILABLE: could not fetch league stat categories; categories are labeled by stat id only.';

/**
 * Yahoo's `scoring_type` normalized to the modes this handler cares about.
 * `head` is Yahoo's code for H2H **categories** scoring — counter-intuitive,
 * but confirmed against Yahoo's own settings documentation and real
 * captures. `headpoint` and `point` are ordinary fantasy-points scoring.
 * `headone` (H2H One Win) has an unverified API code, so it — and anything
 * else unrecognized, including a missing value — normalizes to `unknown`
 * rather than being guessed at.
 */
type YahooScoringMode = 'points' | 'categories' | 'roto' | 'unknown';

function normalizeYahooScoringType(raw: unknown): YahooScoringMode {
  if (raw === 'head') return 'categories';
  if (raw === 'headpoint' || raw === 'point') return 'points';
  if (raw === 'roto') return 'roto';
  return 'unknown';
}

interface YahooStatWinner {
  winnerTeamKey?: string;
  isTied: boolean;
}

/**
 * The single source of truth for how a `stat_winner` entry resolves to a
 * per-side outcome — used for both the per-category `result` field and the
 * `categoryScore` tally, so the two can never disagree on precedence.
 * Checked tie first (an entry can in principle carry both `is_tied` and a
 * stale `winner_team_key`; Yahoo's own semantics say a tie has no winner),
 * then a matching `winner_team_key` (win), then a non-matching one (loss);
 * anything else — no entry, or an entry with neither — is `null`, never
 * guessed at or defaulted to a loss.
 */
function resolveStatOutcome(winner: YahooStatWinner | undefined, teamKey: string): 'win' | 'tie' | 'loss' | null {
  if (!winner) return null;
  if (winner.isTied) return 'tie';
  if (winner.winnerTeamKey === teamKey) return 'win';
  if (winner.winnerTeamKey) return 'loss';
  return null;
}

/**
 * `stat_winners` sits BESIDE `matchup["0"]` (a sibling key on the object
 * holding key `"0"`), not nested inside the `"0"` content that carries
 * `teams`. It is undocumented and absent from at least one known older
 * capture, so this returns an empty map — never throws — when it's missing.
 */
function extractStatWinners(matchupObj: Record<string, unknown> | undefined): Map<string, YahooStatWinner> {
  const statWinners = new Map<string, YahooStatWinner>();
  const statWinnersArray = asArray(matchupObj?.stat_winners as Record<string, unknown> | undefined);

  for (const entry of statWinnersArray) {
    const statWinner = getPath(entry, ['stat_winner']) as Record<string, unknown> | undefined;
    if (!statWinner || statWinner.stat_id === undefined || statWinner.stat_id === null) continue;
    statWinners.set(String(statWinner.stat_id), {
      winnerTeamKey: typeof statWinner.winner_team_key === 'string' ? statWinner.winner_team_key : undefined,
      isTied: toYahooBoolean(statWinner.is_tied) === true,
    });
  }

  return statWinners;
}

export function createGetMatchupsHandler(_config: YahooHandlerContext): HandlerFn {
  return async (env, params, authHeader, correlationId) => {
    const { league_id, week } = params;

    if (!league_id) {
      return {
        success: false,
        error: 'league_id is required for get_matchups',
        code: ErrorCode.MISSING_PARAM,
      };
    }

    try {
      const credentials = await getYahooCredentials(env, authHeader, correlationId);
      requireCredentials(credentials, 'get_matchups');
      const cid = correlationId || 'no-cid';

      const weekParam = week ? `;week=${week}` : '';
      const response = await yahooFetch(`/league/${league_id}/scoreboard${weekParam}`, { credentials });
      if (!response.ok) {
        await handleYahooError(response);
      }

      const raw = await response.json();
      const leagueArray = getPath(raw, ['fantasy_content', 'league']);
      const league = unwrapLeague(leagueArray);
      const currentWeek = league.current_week as number | undefined;

      // `scoring_type` lives in league[0] metadata, already merged by
      // unwrapLeague — no extra `;out=settings` on the scoreboard call.
      const scoringTypeRaw = typeof league.scoring_type === 'string' ? league.scoring_type : undefined;
      const scoringType = normalizeYahooScoringType(scoringTypeRaw);
      const isCategoryLeague = scoringType === 'categories';

      const scoreboardData = league.scoreboard as Record<string, unknown> | undefined;
      const matchupsObj = getPath(scoreboardData, ['0', 'matchups']) as Record<string, unknown> | undefined;
      const matchupsArray = asArray(matchupsObj);

      const warnings: string[] = [];

      // The settings fetch (for category stat names) only runs on categories
      // leagues, and only AFTER the scoreboard response above has already
      // been read — sequential, not concurrent, because Yahoo throttles
      // concurrent requests with HTTP 999.
      let categoryNames = new Map<string, YahooStatCategory>();
      let categoryNamesAvailable = true;
      if (isCategoryLeague) {
        const settings = await fetchLeagueSettings(credentials, league_id, cid, 'get_matchups');
        // A settings response that parsed fine but carries no
        // stat_categories (or an empty one) is functionally the same as a
        // failed fetch from the caller's perspective — no names to attach —
        // so it gets the same categoryNamesAvailable/warning treatment.
        if (settings) {
          categoryNames = extractStatCategories(settings);
        }
        if (categoryNames.size === 0) {
          categoryNamesAvailable = false;
          warnings.push(MATCHUP_CATEGORY_NAMES_UNAVAILABLE_WARNING);
        }
      }

      let anyStatWinnersAvailable = false;

      const matchups = matchupsArray.map((matchupWrapper: unknown, index: number) => {
        const matchupObj = getPath(matchupWrapper, ['matchup']) as Record<string, unknown> | undefined;
        const matchupContent = matchupObj?.['0'] as Record<string, unknown> | undefined;
        const teamsObj = matchupContent?.teams as Record<string, unknown> | undefined;
        const teamsArray = asArray(teamsObj);

        const statWinners = isCategoryLeague ? extractStatWinners(matchupObj) : new Map<string, YahooStatWinner>();
        const statWinnersAvailable = statWinners.size > 0;
        if (statWinnersAvailable) anyStatWinnersAvailable = true;

        const parseTeam = (teamWrapper: unknown) => {
          const teamData = getPath(teamWrapper, ['team']) as unknown[];
          const team = unwrapTeam(teamData);
          const teamKey = team.team_key as string;
          const teamPoints = team.team_points as Record<string, unknown> | undefined;
          const teamProjectedPoints = team.team_projected_points as Record<string, unknown> | undefined;

          const base = {
            teamKey,
            teamId: team.team_id as string,
            teamName: team.name as string,
            // Kept exactly as before, on every league type: the raw parsed
            // team_points.total. On a categories league this number is a
            // count of categories won, not fantasy points — scoringType and
            // categoriesWon below tell the model how to read it, rather than
            // nulling it out on the one league type this worker cannot test
            // before shipping (FLA-404).
            points: teamPoints?.total ? parseFloat(String(teamPoints.total)) : 0,
            projectedPoints: teamProjectedPoints?.total ? parseFloat(String(teamProjectedPoints.total)) : undefined,
          };

          if (!isCategoryLeague) return base;

          const teamStats = team.team_stats as Record<string, unknown> | undefined;
          const statsArray = asArray(getPath(teamStats, ['stats']) as Record<string, unknown> | undefined);

          // Never compare category VALUES to decide a result — only
          // Yahoo's own stat_winners says who won a category. A stat entry
          // with no stat_id is skipped entirely (flatMap) rather than
          // emitted as a row with statId: ''.
          const categories = teamStats
            ? statsArray.flatMap((entry) => {
                const stat = getPath(entry, ['stat']) as Record<string, unknown> | undefined;
                if (!stat || stat.stat_id === undefined || stat.stat_id === null) return [];
                const statId = String(stat.stat_id);
                const meta = categoryNames.get(statId);
                const winner = statWinners.get(statId);

                return [{
                  statId,
                  name: meta?.name ?? null,
                  displayName: meta?.displayName ?? null,
                  value: stat.value == null ? null : String(stat.value),
                  result: resolveStatOutcome(winner, teamKey),
                  isDisplayOnly: meta?.isDisplayOnly ?? false,
                }];
              })
            : null;

          // Tallied ONLY over stat_winners, never from team_points.total and
          // never computed by comparing values, and sharing resolveStatOutcome
          // with the per-category result above so the two can't disagree.
          // null when the tally is empty — either because stat_winners is
          // absent/empty, or because every entry resolved to null (neither
          // is_tied nor a recognized winner_team_key) — never {0,0,0}.
          let wins = 0;
          let losses = 0;
          let ties = 0;
          for (const winner of statWinners.values()) {
            const outcome = resolveStatOutcome(winner, teamKey);
            if (outcome === 'win') wins++;
            else if (outcome === 'loss') losses++;
            else if (outcome === 'tie') ties++;
          }
          const categoryScore = wins + losses + ties > 0 ? { wins, losses, ties } : null;

          // team_points.total may be an empty string or otherwise
          // non-numeric — parseFloat('') is NaN, so this must check
          // finiteness rather than only undefined/null.
          const parsedCategoriesWon = parseFloat(String(teamPoints?.total));
          const categoriesWon = Number.isFinite(parsedCategoriesWon) ? parsedCategoriesWon : null;

          return { ...base, categories, categoryScore, categoriesWon };
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
          ...(isCategoryLeague ? { statWinnersAvailable } : {}),
        };
      });

      if (isCategoryLeague) {
        console.log(
          `[yahoo-client] ${cid} get_matchups categories matchups=${matchups.length} statWinners=${anyStatWinnersAvailable} namedCategories=${categoryNames.size}`
        );
      }

      const matchupsUnavailableReason =
        matchups.length === 0 && (scoringType === 'roto' || scoringType === 'unknown')
          ? 'NOT_HEAD_TO_HEAD'
          : undefined;
      if (matchupsUnavailableReason) {
        warnings.push(
          `MATCHUPS_NOT_HEAD_TO_HEAD: this league's scoring type (${scoringTypeRaw ?? 'unknown'}) has no weekly head-to-head scoreboard.`
        );
      }

      return {
        success: true,
        data: {
          leagueKey: league.league_key,
          leagueName: league.name,
          currentWeek,
          matchupWeek: week || currentWeek,
          scoringType,
          scoringTypeRaw,
          matchups,
          ...(isCategoryLeague ? { categoryNamesAvailable } : {}),
          ...(matchupsUnavailableReason ? { matchupsUnavailableReason } : {}),
          ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {}),
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
