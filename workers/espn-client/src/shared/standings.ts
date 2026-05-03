import type { EspnTeam } from '../types';

export type EspnSeasonPhase = 'regular_season' | 'playoffs_in_progress' | 'season_complete';

export type EspnPlayoffOutcome = 'champion' | 'runner_up' | 'eliminated' | 'missed_playoffs';

export interface EspnStandingsOutcome {
  finalRank: number | null;
  championshipWon: boolean | null;
  playoffOutcome: EspnPlayoffOutcome | null;
  outcomeConfidence: 'explicit' | null;
  madePlayoffs: boolean | null;
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
  rankFinal?: number;
  rankCalculatedFinal?: number;
  playoffSeed?: number;
  seasonComplete: boolean;
}

function hasExplicitCompletionData(teams: EspnTeam[]): boolean {
  return teams.some((team) => team.rankFinal != null || team.rankCalculatedFinal != null);
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
      return hasExplicitCompletionData(teams) ? 'season_complete' : 'playoffs_in_progress';
    }
    return 'regular_season';
  }

  return 'regular_season';
}

export function deriveStandingsOutcome({
  rankFinal,
  rankCalculatedFinal,
  playoffSeed,
  seasonComplete,
}: DeriveStandingsOutcomeInput): EspnStandingsOutcome {
  const resolvedFinalRank = rankFinal ?? rankCalculatedFinal ?? null;
  const finalRank = seasonComplete && resolvedFinalRank !== null ? resolvedFinalRank : null;
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
