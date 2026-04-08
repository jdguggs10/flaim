import type { HandlerFn } from './types';
import type { SleeperLeague, SleeperLeagueUser, SleeperRoster, SleeperBracketMatch } from '../../types';
import { ErrorCode } from '@flaim/worker-shared';
import { sleeperFetch, handleSleeperError } from '../sleeper-api';
import { toExecuteErrorResponse } from './utils';

export function createGetStandingsHandler(): HandlerFn {
  return async (_env, params) => {
    const { league_id } = params;
    if (!league_id) {
      return { success: false, error: 'league_id is required for get_standings', code: ErrorCode.MISSING_PARAM };
    }

    try {
      // Fetch league meta first to determine status
      const leagueRes = await sleeperFetch(`/league/${league_id}`);
      if (!leagueRes.ok) handleSleeperError(leagueRes);
      const league: SleeperLeague = await leagueRes.json();

      const [rostersRes, usersRes] = await Promise.all([
        sleeperFetch(`/league/${league_id}/rosters`),
        sleeperFetch(`/league/${league_id}/users`),
      ]);

      if (!rostersRes.ok) handleSleeperError(rostersRes);
      if (!usersRes.ok) handleSleeperError(usersRes);

      const rosters: SleeperRoster[] = await rostersRes.json();
      const users: SleeperLeagueUser[] = await usersRes.json();

      // Determine seasonPhase and fetch bracket when needed
      let seasonPhase: 'regular_season' | 'playoffs_in_progress' | 'season_complete';
      let bracket: SleeperBracketMatch[] = [];

      if (league.status === 'complete') {
        seasonPhase = 'season_complete';
        // Bracket is the only source of outcome data for completed seasons — propagate errors
        const bracketRes = await sleeperFetch(`/league/${league_id}/winners_bracket`);
        if (!bracketRes.ok) return handleSleeperError(bracketRes);
        bracket = await bracketRes.json();
      } else if (league.status === 'in_season') {
        const bracketRes = await sleeperFetch(`/league/${league_id}/winners_bracket`);
        if (bracketRes.ok) {
          bracket = await bracketRes.json();
        }
        // If bracket fetch fails during active season, degrade gracefully to regular_season
        seasonPhase = bracket.length > 0 ? 'playoffs_in_progress' : 'regular_season';
      } else {
        seasonPhase = 'regular_season';
      }

      const seasonComplete = seasonPhase === 'season_complete';

      // Build outcome maps from bracket when season is complete
      const finalRankMap = new Map<number, number>();
      const championRosterId = (() => {
        if (bracket.length === 0) return null;
        const maxRound = Math.max(...bracket.map((m) => m.r));
        const championship = bracket.find((m) => m.r === maxRound && m.w != null);
        return championship?.w ?? null;
      })();

      if (seasonComplete) {
        for (const match of bracket) {
          if (match.p != null) {
            if (match.w != null) finalRankMap.set(match.w, match.p);
            if (match.l != null) finalRankMap.set(match.l, match.p + 1);
          }
        }
      }

      const userMap = new Map<string, string>();
      for (const user of users) {
        userMap.set(user.user_id, user.display_name);
      }

      const standings = rosters
        .map((roster) => {
          const settings = roster.settings;
          const wins = settings?.wins ?? 0;
          const losses = settings?.losses ?? 0;
          const ties = settings?.ties ?? 0;
          const fpts = settings?.fpts ?? 0;
          const fpts_decimal = settings?.fpts_decimal ?? 0;
          const fpts_against = settings?.fpts_against ?? 0;
          const fpts_against_decimal = settings?.fpts_against_decimal ?? 0;
          const pointsFor = fpts + fpts_decimal / 100;
          const pointsAgainst = fpts_against + fpts_against_decimal / 100;
          const totalGames = wins + losses + ties;
          const winPct = totalGames > 0 ? wins / totalGames : 0;

          // Outcome fields from bracket
          const inWinnersBracket = bracket.some((m) => m.t1 === roster.roster_id || m.t2 === roster.roster_id);
          const finalRank = seasonComplete ? (finalRankMap.get(roster.roster_id) ?? null) : null;
          const isChampion = seasonComplete && roster.roster_id === championRosterId;
          const championshipWon = seasonComplete && championRosterId !== null ? isChampion : null;

          let playoffOutcome: 'champion' | 'runner_up' | 'eliminated' | 'in_progress' | null = null;
          if (seasonComplete && championRosterId !== null) {
            if (finalRank === 1 || isChampion) playoffOutcome = 'champion';
            else if (finalRank === 2) playoffOutcome = 'runner_up';
            else if (finalRank !== null) playoffOutcome = 'eliminated';
            else if (inWinnersBracket) playoffOutcome = 'eliminated'; // in bracket but no p field
          } else if (seasonPhase === 'playoffs_in_progress') {
            if (inWinnersBracket) playoffOutcome = 'in_progress';
          }

          const outcomeConfidence = (seasonComplete && championRosterId !== null) ? 'explicit' as const : null;
          const madePlayoffs = bracket.length > 0 ? inWinnersBracket : null;

          return {
            rosterId: roster.roster_id,
            ownerId: roster.owner_id,
            ownerName: userMap.get(roster.owner_id) ?? 'Unknown',
            wins,
            losses,
            ties,
            winPercentage: Math.round(winPct * 1000) / 1000,
            pointsFor: Math.round(pointsFor * 100) / 100,
            pointsAgainst: Math.round(pointsAgainst * 100) / 100,
            playoffSeed: null,
            madePlayoffs,
            finalRank,
            championshipWon,
            playoffOutcome,
            outcomeConfidence,
          };
        })
        .sort((a, b) => {
          if (b.wins !== a.wins) return b.wins - a.wins;
          return b.pointsFor - a.pointsFor;
        })
        .map((entry, index) => ({ ...entry, rank: index + 1 }));

      return {
        success: true,
        data: {
          leagueId: league_id,
          seasonPhase,
          seasonComplete,
          standings,
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
