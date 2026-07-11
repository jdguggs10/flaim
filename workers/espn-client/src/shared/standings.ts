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

export function deriveBracketFinal(schedule?: EspnMatchup[]): EspnBracketFinal | null {
  const decided = (schedule ?? []).filter((matchup) =>
    matchup.playoffTierType === 'WINNERS_BRACKET'
    && matchup.matchupPeriodId != null
    && (matchup.winner === 'HOME' || matchup.winner === 'AWAY'));
  if (decided.length === 0) {
    return null;
  }

  const finalPeriod = Math.max(...decided.map((matchup) => matchup.matchupPeriodId as number));
  const finals = decided.filter((matchup) => matchup.matchupPeriodId === finalPeriod);
  // Multiple winners-bracket matchups in the last period means the championship
  // game cannot be identified unambiguously.
  if (finals.length !== 1) {
    return null;
  }

  const [final] = finals;
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
): Promise<EspnBracketFinal | null> {
  try {
    const path = `/seasons/${seasonYear}/segments/0/leagues/${leagueId}?view=mMatchupScore`;
    const response = await espnFetch(path, gameId, { credentials, timeout: 7000 });
    if (!response.ok) {
      return null;
    }
    const data = await response.json() as EspnLeagueResponse | null;
    return deriveBracketFinal(data?.schedule);
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
