import type { HandlerFn } from './types';
import type { SleeperLeague, SleeperLeagueSettings, SleeperLeagueUser, SleeperRoster, SleeperBracketMatch } from '../../types';
import { ErrorCode } from '@flaim/worker-shared';
import { sleeperFetch, handleSleeperError } from '../sleeper-api';
import { toExecuteErrorResponse } from './utils';
import { buildUserDirectory } from '../sleeper-enrichment';

const SLEEPER_WAIVER_TYPE_FAAB = 2;

/** Waiver order is a 1-based ordinal; a 0 or non-integer would read as ahead of first. */
function toWaiverPriority(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) >= 1 ? (value as number) : null;
}

/**
 * Remaining FAAB for one roster, or null when the league doesn't bid with
 * FAAB or either input is missing. Sleeper sends waiver_budget (default 100)
 * for every league, so the league's waiver_type — not the budget's presence —
 * decides. waiver_budget_used is Sleeper's own running total: winning bids,
 * plus FAAB sent in trades, minus FAAB received, plus any commissioner
 * adjustment. Checked read-only against completed public leagues: every team
 * that traded FAAB fit bids-plus-trades except where a commissioner
 * transaction was present (e.g. 125 won in bids after receiving 25 reports
 * 100 used). So no trade or transaction lookup is needed, and a team that
 * received budget can hold more than the starting amount (used can go below
 * 0). 0 is a real spent-out balance, not unknown.
 */
function toFaabBalance(leagueSettings: SleeperLeagueSettings | undefined, used: unknown): number | null {
  if (leagueSettings?.waiver_type !== SLEEPER_WAIVER_TYPE_FAAB) return null;
  const budget = leagueSettings.waiver_budget;
  if (typeof budget !== 'number' || !Number.isFinite(budget)) return null;
  if (typeof used !== 'number' || !Number.isFinite(used)) return null;
  return budget - used;
}

export function createGetStandingsHandler(): HandlerFn {
  return async (_env, params) => {
    const { league_id } = params;
    if (!league_id) {
      return { success: false, error: 'league_id is required for get_standings', code: ErrorCode.MISSING_PARAM };
    }

    try {
      // Fetch league meta, rosters, and users in parallel — all independent
      const [leagueRes, rostersRes, usersRes] = await Promise.all([
        sleeperFetch(`/league/${league_id}`),
        sleeperFetch(`/league/${league_id}/rosters`),
        sleeperFetch(`/league/${league_id}/users`),
      ]);

      if (!leagueRes.ok) return handleSleeperError(leagueRes);
      if (!rostersRes.ok) handleSleeperError(rostersRes);
      if (!usersRes.ok) handleSleeperError(usersRes);

      const league: SleeperLeague = await leagueRes.json();
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
        // Sleeper returns HTTP 200 with a literal `null` body before a bracket exists —
        // coerce non-array payloads to an empty array so downstream .length/array access is safe.
        const parsedBracket: unknown = await bracketRes.json();
        bracket = Array.isArray(parsedBracket) ? (parsedBracket as SleeperBracketMatch[]) : [];
      } else if (league.status === 'in_season') {
        const bracketRes = await sleeperFetch(`/league/${league_id}/winners_bracket`);
        if (bracketRes.ok) {
          // Sleeper returns HTTP 200 with a literal `null` body before a bracket exists —
          // coerce non-array payloads to an empty array so downstream .length/array access is safe.
          const parsedBracket: unknown = await bracketRes.json();
          bracket = Array.isArray(parsedBracket) ? (parsedBracket as SleeperBracketMatch[]) : [];
        } else {
          console.warn(`[get-standings] Bracket fetch failed for league ${league_id} (status ${bracketRes.status}); degrading seasonPhase to regular_season`);
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

      const userDirectory = buildUserDirectory(users);

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
          const finalRankFromBracket = seasonComplete ? (finalRankMap.get(roster.roster_id) ?? null) : null;
          const isChampion = seasonComplete && roster.roster_id === championRosterId;
          // Champion is unambiguously rank 1 even when the championship match lacks a p field
          const finalRank = finalRankFromBracket ?? (isChampion ? 1 : null);
          const championshipWon = seasonComplete && championRosterId !== null ? isChampion : null;

          // Note: 'in_progress' is Sleeper-specific — ESPN and Yahoo return null for teams in active playoffs
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

          const ownerEntry = userDirectory.get(roster.owner_id);

          return {
            rosterId: roster.roster_id,
            ownerId: roster.owner_id,
            ownerName: ownerEntry?.displayName ?? 'Unknown',
            teamName: ownerEntry?.teamName,
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
            waiverPriority: toWaiverPriority(settings?.waiver_position),
            faabBalance: toFaabBalance(league.settings, settings?.waiver_budget_used),
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
