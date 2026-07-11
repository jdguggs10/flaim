import type { EspnCredentials } from '@flaim/worker-shared';
import type { EspnLeagueResponse, EspnMatchup, EspnTeam } from '../types';
import { espnFetch } from './espn-api';

export type EspnSeasonPhase = 'regular_season' | 'playoffs_in_progress' | 'season_complete';

export type EspnPlayoffOutcome = 'champion' | 'runner_up' | 'eliminated' | 'missed_playoffs';

export interface EspnStandingsOutcome {
  finalRank: number | null;
  championshipWon: boolean | null;
  playoffOutcome: EspnPlayoffOutcome | null;
  outcomeConfidence: 'explicit' | 'derived' | null;
  madePlayoffs: boolean | null;
}

export interface EspnBracketFinal {
  championTeamId: number;
  runnerUpTeamId: number | null;
}

export interface EspnTieBreakContext {
  /** From settings.scoringSettings.playoffMatchupTieRule (e.g. "NONE", "HOME_TEAM_WINS"). */
  playoffMatchupTieRule?: string;
  /** teamId → playoffSeed (1 = top seed), from the standings mTeam response. */
  playoffSeeds?: Map<number, number>;
}

interface DeriveSeasonPhaseInput {
  requestedSeasonYear: number;
  currentSeasonYear: number;
  scoringPeriodId?: number;
  currentMatchupPeriod?: number;
  regularSeasonMatchupPeriods?: number;
  teams: EspnTeam[];
}

interface DeriveStandingsOutcomeInput {
  teamId?: number;
  rankFinal?: number;
  rankCalculatedFinal?: number;
  playoffSeed?: number;
  seasonComplete: boolean;
  bracketFinal?: EspnBracketFinal | null;
}

function getValidFinalRank(
  rankFinal?: number,
  rankCalculatedFinal?: number,
): number | null {
  // ESPN can return 0 as a sentinel for "not yet ranked".
  return [rankFinal, rankCalculatedFinal].find((rank) => rank != null && rank > 0) ?? null;
}

export function hasExplicitFinalRanks(teams: EspnTeam[]): boolean {
  return teams.some((team) => getValidFinalRank(team.rankFinal, team.rankCalculatedFinal) !== null);
}

export function buildPlayoffSeedMap(teams: EspnTeam[]): Map<number, number> {
  return new Map(
    teams
      .filter((team) => team.playoffSeed != null)
      .map((team) => [team.id, team.playoffSeed as number]),
  );
}

// Resolves a championship game that ESPN never marked as decided (TIE, or
// UNDECIDED for a completed season) using the league's playoff tie rule.
// Callers only supply tie-break context on the season-complete path, so this
// never runs for an in-progress season.
function resolveUndecidedFinal(
  final: EspnMatchup,
  tieBreak?: EspnTieBreakContext,
): EspnBracketFinal | null {
  const homeTeamId = final.home?.teamId;
  const awayTeamId = final.away?.teamId;
  if (homeTeamId == null || awayTeamId == null) {
    return null;
  }

  if (tieBreak?.playoffMatchupTieRule === 'HOME_TEAM_WINS') {
    return { championTeamId: homeTeamId, runnerUpTeamId: awayTeamId };
  }

  if (tieBreak?.playoffMatchupTieRule === 'NONE') {
    // ESPN's platform default when no explicit tie rule is configured: the
    // higher seed (lower playoffSeed number) advances on a tied playoff matchup.
    const homeSeed = tieBreak.playoffSeeds?.get(homeTeamId);
    const awaySeed = tieBreak.playoffSeeds?.get(awayTeamId);
    if (homeSeed == null || awaySeed == null || homeSeed === awaySeed) {
      return null;
    }
    return homeSeed < awaySeed
      ? { championTeamId: homeTeamId, runnerUpTeamId: awayTeamId }
      : { championTeamId: awayTeamId, runnerUpTeamId: homeTeamId };
  }

  // Unknown or missing tie rule — cannot resolve the final safely.
  return null;
}

export function deriveBracketFinal(
  schedule?: EspnMatchup[],
  tieBreak?: EspnTieBreakContext,
): EspnBracketFinal | null {
  const bracket = (schedule ?? []).filter((matchup) =>
    matchup.playoffTierType === 'WINNERS_BRACKET'
    && matchup.matchupPeriodId != null);
  if (bracket.length === 0) {
    return null;
  }

  // The final period must be computed over all winners-bracket matchups, decided
  // or not — otherwise a tied or unfinished championship game would silently fall
  // back to the semifinal period and crown the wrong team.
  const finalPeriod = Math.max(...bracket.map((matchup) => matchup.matchupPeriodId as number));
  const finals = bracket.filter((matchup) => matchup.matchupPeriodId === finalPeriod);
  // Multiple winners-bracket matchups in the last period means the championship
  // game cannot be identified unambiguously.
  if (finals.length !== 1) {
    return null;
  }

  const [final] = finals;
  if (final.winner !== 'HOME' && final.winner !== 'AWAY') {
    if (final.winner === 'TIE' || final.winner === 'UNDECIDED') {
      return resolveUndecidedFinal(final, tieBreak);
    }
    return null;
  }
  const champion = final.winner === 'HOME' ? final.home : final.away;
  const runnerUp = final.winner === 'HOME' ? final.away : final.home;
  if (champion?.teamId == null) {
    return null;
  }

  return {
    championTeamId: champion.teamId,
    runnerUpTeamId: runnerUp?.teamId ?? null,
  };
}

export async function fetchBracketFinal(
  gameId: string,
  leagueId: string,
  seasonYear: number,
  credentials?: EspnCredentials | null,
  playoffSeeds?: Map<number, number>,
): Promise<EspnBracketFinal | null> {
  try {
    // mSettings rides along on the same request (multi-view is the standard
    // ESPN API pattern) so the playoff tie rule is available for a tied final.
    const path = `/seasons/${seasonYear}/segments/0/leagues/${leagueId}?view=mMatchupScore&view=mSettings`;
    const response = await espnFetch(path, gameId, { credentials, timeout: 7000 });
    if (!response.ok) {
      return null;
    }
    const data = await response.json() as EspnLeagueResponse | null;
    return deriveBracketFinal(data?.schedule, {
      playoffMatchupTieRule: data?.settings?.scoringSettings?.playoffMatchupTieRule,
      playoffSeeds,
    });
  } catch (error) {
    console.warn('[standings] Playoff bracket lookup failed:', error instanceof Error ? error.message : error);
    return null;
  }
}

export function deriveStandingsSeasonPhase({
  requestedSeasonYear,
  currentSeasonYear,
  scoringPeriodId,
  currentMatchupPeriod,
  regularSeasonMatchupPeriods,
  teams,
}: DeriveSeasonPhaseInput): EspnSeasonPhase {
  if (requestedSeasonYear < currentSeasonYear) {
    return 'season_complete';
  }

  if (requestedSeasonYear === currentSeasonYear) {
    const matchupPeriod = currentMatchupPeriod ?? scoringPeriodId;
    if (
      regularSeasonMatchupPeriods != null
      && matchupPeriod != null
      && matchupPeriod > regularSeasonMatchupPeriods
    ) {
      return hasExplicitFinalRanks(teams) ? 'season_complete' : 'playoffs_in_progress';
    }
    return 'regular_season';
  }

  return 'regular_season';
}

export function deriveStandingsOutcome({
  teamId,
  rankFinal,
  rankCalculatedFinal,
  playoffSeed,
  seasonComplete,
  bracketFinal,
}: DeriveStandingsOutcomeInput): EspnStandingsOutcome {
  const resolvedFinalRank = getValidFinalRank(rankFinal, rankCalculatedFinal);
  const finalRank = seasonComplete && resolvedFinalRank !== null ? resolvedFinalRank : null;

  if (finalRank === null && seasonComplete && bracketFinal && teamId != null) {
    if (teamId === bracketFinal.championTeamId) {
      return {
        finalRank: 1,
        championshipWon: true,
        playoffOutcome: 'champion',
        outcomeConfidence: 'derived',
        madePlayoffs: true,
      };
    }
    if (teamId === bracketFinal.runnerUpTeamId) {
      return {
        finalRank: 2,
        championshipWon: false,
        playoffOutcome: 'runner_up',
        outcomeConfidence: 'derived',
        madePlayoffs: true,
      };
    }
  }

  const championshipWon = finalRank !== null ? finalRank === 1 : null;
  const playoffOutcome =
    finalRank !== null
      ? finalRank === 1 ? 'champion'
      : finalRank === 2 ? 'runner_up'
      : playoffSeed != null ? 'eliminated'
      : 'missed_playoffs'
      : null;
  const outcomeConfidence = finalRank !== null ? 'explicit' : null;
  const madePlayoffs =
    playoffSeed != null || (finalRank !== null && finalRank <= 2)
      ? true
      : (seasonComplete && resolvedFinalRank !== null ? false : null);

  return {
    finalRank,
    championshipWon,
    playoffOutcome,
    outcomeConfidence,
    madePlayoffs,
  };
}
