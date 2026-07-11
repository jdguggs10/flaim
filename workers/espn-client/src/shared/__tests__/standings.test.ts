import { describe, expect, it } from 'vitest';
import {
  buildPlayoffSeedMap,
  deriveBracketFinal,
  deriveStandingsOutcome,
  deriveStandingsSeasonPhase,
} from '../standings';

describe('deriveStandingsSeasonPhase', () => {
  it('marks the current season complete when explicit final ranks align with postseason matchup context', () => {
    expect(deriveStandingsSeasonPhase({
      requestedSeasonYear: 2026,
      currentSeasonYear: 2026,
      scoringPeriodId: 150,
      currentMatchupPeriod: 21,
      regularSeasonMatchupPeriods: 20,
      teams: [{ id: 1, rankFinal: 1 }],
    })).toBe('season_complete');
  });

  it('ignores explicit final-rank-like fields during the current regular season', () => {
    expect(deriveStandingsSeasonPhase({
      requestedSeasonYear: 2026,
      currentSeasonYear: 2026,
      scoringPeriodId: 150,
      currentMatchupPeriod: 10,
      regularSeasonMatchupPeriods: 20,
      teams: [{ id: 1, rankCalculatedFinal: 1 }],
    })).toBe('regular_season');
  });

  it('marks older seasons complete even without explicit final ranks', () => {
    expect(deriveStandingsSeasonPhase({
      requestedSeasonYear: 2024,
      currentSeasonYear: 2026,
      scoringPeriodId: 10,
      regularSeasonMatchupPeriods: 20,
      teams: [{ id: 1 }],
    })).toBe('season_complete');
  });

  it('does not treat zero final ranks as explicit completion data', () => {
    expect(deriveStandingsSeasonPhase({
      requestedSeasonYear: 2026,
      currentSeasonYear: 2026,
      currentMatchupPeriod: 21,
      scoringPeriodId: 150,
      regularSeasonMatchupPeriods: 20,
      teams: [{ id: 1, rankFinal: 0, rankCalculatedFinal: 0 }],
    })).toBe('playoffs_in_progress');
  });

  it('returns playoffs_in_progress for current-season requests after the regular season', () => {
    expect(deriveStandingsSeasonPhase({
      requestedSeasonYear: 2026,
      currentSeasonYear: 2026,
      scoringPeriodId: 150,
      currentMatchupPeriod: 22,
      regularSeasonMatchupPeriods: 20,
      teams: [{ id: 1 }],
    })).toBe('playoffs_in_progress');
  });

  it('returns regular_season for current-season requests during the regular season', () => {
    expect(deriveStandingsSeasonPhase({
      requestedSeasonYear: 2026,
      currentSeasonYear: 2026,
      scoringPeriodId: 150,
      currentMatchupPeriod: 10,
      regularSeasonMatchupPeriods: 20,
      teams: [{ id: 1 }],
    })).toBe('regular_season');
  });

  it('returns regular_season when regular-season length is unavailable', () => {
    expect(deriveStandingsSeasonPhase({
      requestedSeasonYear: 2026,
      currentSeasonYear: 2026,
      scoringPeriodId: 150,
      currentMatchupPeriod: 22,
      teams: [{ id: 1, rankCalculatedFinal: 1 }],
    })).toBe('regular_season');
  });

  it('returns regular_season for future seasons', () => {
    expect(deriveStandingsSeasonPhase({
      requestedSeasonYear: 2027,
      currentSeasonYear: 2026,
      scoringPeriodId: 0,
      regularSeasonMatchupPeriods: 20,
      teams: [{ id: 1 }],
    })).toBe('regular_season');
  });
});

describe('deriveStandingsOutcome', () => {
  it('returns champion fields for a completed season winner', () => {
    expect(deriveStandingsOutcome({
      rankFinal: 1,
      playoffSeed: 1,
      seasonComplete: true,
    })).toEqual({
      finalRank: 1,
      championshipWon: true,
      playoffOutcome: 'champion',
      outcomeConfidence: 'explicit',
      madePlayoffs: true,
    });
  });

  it('returns runner-up fields for second place', () => {
    expect(deriveStandingsOutcome({
      rankFinal: 2,
      playoffSeed: 2,
      seasonComplete: true,
    })).toEqual({
      finalRank: 2,
      championshipWon: false,
      playoffOutcome: 'runner_up',
      outcomeConfidence: 'explicit',
      madePlayoffs: true,
    });
  });

  it('returns eliminated for completed playoff teams outside the final', () => {
    expect(deriveStandingsOutcome({
      rankFinal: 4,
      playoffSeed: 4,
      seasonComplete: true,
    })).toEqual({
      finalRank: 4,
      championshipWon: false,
      playoffOutcome: 'eliminated',
      outcomeConfidence: 'explicit',
      madePlayoffs: true,
    });
  });

  it('returns missed_playoffs for completed non-playoff teams', () => {
    expect(deriveStandingsOutcome({
      rankFinal: 7,
      seasonComplete: true,
    })).toEqual({
      finalRank: 7,
      championshipWon: false,
      playoffOutcome: 'missed_playoffs',
      outcomeConfidence: 'explicit',
      madePlayoffs: false,
    });
  });

  it('keeps outcome fields null when a completed season has no explicit final rank', () => {
    expect(deriveStandingsOutcome({
      seasonComplete: true,
    })).toEqual({
      finalRank: null,
      championshipWon: null,
      playoffOutcome: null,
      outcomeConfidence: null,
      madePlayoffs: null,
    });
  });

  it('keeps outcome fields null when completed-season final ranks are zero', () => {
    expect(deriveStandingsOutcome({
      rankFinal: 0,
      rankCalculatedFinal: 0,
      seasonComplete: true,
    })).toEqual({
      finalRank: null,
      championshipWon: null,
      playoffOutcome: null,
      outcomeConfidence: null,
      madePlayoffs: null,
    });
  });

  it('keeps outcome fields null when only rankFinal is zero', () => {
    expect(deriveStandingsOutcome({
      rankFinal: 0,
      seasonComplete: true,
    })).toEqual({
      finalRank: null,
      championshipWon: null,
      playoffOutcome: null,
      outcomeConfidence: null,
      madePlayoffs: null,
    });
  });

  it('falls back to rankCalculatedFinal when rankFinal is zero', () => {
    expect(deriveStandingsOutcome({
      rankFinal: 0,
      rankCalculatedFinal: 3,
      playoffSeed: 3,
      seasonComplete: true,
    })).toEqual({
      finalRank: 3,
      championshipWon: false,
      playoffOutcome: 'eliminated',
      outcomeConfidence: 'explicit',
      madePlayoffs: true,
    });
  });

  it('prefers valid rankFinal when rankCalculatedFinal is zero', () => {
    expect(deriveStandingsOutcome({
      rankFinal: 2,
      rankCalculatedFinal: 0,
      playoffSeed: 2,
      seasonComplete: true,
    })).toEqual({
      finalRank: 2,
      championshipWon: false,
      playoffOutcome: 'runner_up',
      outcomeConfidence: 'explicit',
      madePlayoffs: true,
    });
  });

  it('keeps postseason outcome null but marks madePlayoffs true during active playoffs when playoffSeed exists', () => {
    expect(deriveStandingsOutcome({
      playoffSeed: 1,
      seasonComplete: false,
    })).toEqual({
      finalRank: null,
      championshipWon: null,
      playoffOutcome: null,
      outcomeConfidence: null,
      madePlayoffs: true,
    });
  });

  it('preserves current champion semantics for rankCalculatedFinal without playoffSeed', () => {
    expect(deriveStandingsOutcome({
      rankCalculatedFinal: 1,
      seasonComplete: true,
    })).toEqual({
      finalRank: 1,
      championshipWon: true,
      playoffOutcome: 'champion',
      outcomeConfidence: 'explicit',
      madePlayoffs: true,
    });
  });

  it('treats a runner-up without playoffSeed as having made the playoffs', () => {
    expect(deriveStandingsOutcome({
      rankCalculatedFinal: 2,
      seasonComplete: true,
    })).toEqual({
      finalRank: 2,
      championshipWon: false,
      playoffOutcome: 'runner_up',
      outcomeConfidence: 'explicit',
      madePlayoffs: true,
    });
  });

  it('derives the champion from the bracket final when final ranks are missing', () => {
    expect(deriveStandingsOutcome({
      teamId: 7,
      rankFinal: 0,
      rankCalculatedFinal: 0,
      playoffSeed: 2,
      seasonComplete: true,
      bracketFinal: { championTeamId: 7, runnerUpTeamId: 3 },
    })).toEqual({
      finalRank: 1,
      championshipWon: true,
      playoffOutcome: 'champion',
      outcomeConfidence: 'derived',
      madePlayoffs: true,
    });
  });

  it('derives the runner-up from the bracket final when final ranks are missing', () => {
    expect(deriveStandingsOutcome({
      teamId: 3,
      rankFinal: 0,
      seasonComplete: true,
      bracketFinal: { championTeamId: 7, runnerUpTeamId: 3 },
    })).toEqual({
      finalRank: 2,
      championshipWon: false,
      playoffOutcome: 'runner_up',
      outcomeConfidence: 'derived',
      madePlayoffs: true,
    });
  });

  it('keeps outcome fields null for non-finalists when only bracket evidence exists', () => {
    expect(deriveStandingsOutcome({
      teamId: 5,
      rankFinal: 0,
      seasonComplete: true,
      bracketFinal: { championTeamId: 7, runnerUpTeamId: 3 },
    })).toEqual({
      finalRank: null,
      championshipWon: null,
      playoffOutcome: null,
      outcomeConfidence: null,
      madePlayoffs: null,
    });
  });

  it('prefers explicit final ranks over bracket evidence', () => {
    expect(deriveStandingsOutcome({
      teamId: 3,
      rankFinal: 1,
      playoffSeed: 1,
      seasonComplete: true,
      bracketFinal: { championTeamId: 7, runnerUpTeamId: 3 },
    })).toEqual({
      finalRank: 1,
      championshipWon: true,
      playoffOutcome: 'champion',
      outcomeConfidence: 'explicit',
      madePlayoffs: true,
    });
  });

  it('ignores bracket evidence while the season is incomplete', () => {
    expect(deriveStandingsOutcome({
      teamId: 7,
      seasonComplete: false,
      bracketFinal: { championTeamId: 7, runnerUpTeamId: 3 },
    })).toEqual({
      finalRank: null,
      championshipWon: null,
      playoffOutcome: null,
      outcomeConfidence: null,
      madePlayoffs: null,
    });
  });
});

describe('deriveBracketFinal', () => {
  it('identifies the champion and runner-up from the last decided winners-bracket matchup', () => {
    expect(deriveBracketFinal([
      { matchupPeriodId: 22, home: { teamId: 7 }, away: { teamId: 2 }, winner: 'HOME', playoffTierType: 'WINNERS_BRACKET' },
      { matchupPeriodId: 23, home: { teamId: 7 }, away: { teamId: 3 }, winner: 'HOME', playoffTierType: 'WINNERS_BRACKET' },
      { matchupPeriodId: 23, home: { teamId: 2 }, away: { teamId: 5 }, winner: 'AWAY', playoffTierType: 'LOSERS_CONSOLATION_LADDER' },
    ])).toEqual({ championTeamId: 7, runnerUpTeamId: 3 });
  });

  it('picks the away side when the away team wins the final', () => {
    expect(deriveBracketFinal([
      { matchupPeriodId: 23, home: { teamId: 3 }, away: { teamId: 7 }, winner: 'AWAY', playoffTierType: 'WINNERS_BRACKET' },
    ])).toEqual({ championTeamId: 7, runnerUpTeamId: 3 });
  });

  it('returns null when there are no decided winners-bracket matchups', () => {
    expect(deriveBracketFinal([
      { matchupPeriodId: 23, home: { teamId: 7 }, away: { teamId: 3 }, winner: 'UNDECIDED', playoffTierType: 'WINNERS_BRACKET' },
      { matchupPeriodId: 23, home: { teamId: 2 }, away: { teamId: 5 }, winner: 'HOME', playoffTierType: 'LOSERS_CONSOLATION_LADDER' },
    ])).toBeNull();
  });

  it('returns null instead of the semifinal winner when the championship game is tied or undecided', () => {
    for (const winner of ['TIE', 'UNDECIDED'] as const) {
      expect(deriveBracketFinal([
        { matchupPeriodId: 22, home: { teamId: 7 }, away: { teamId: 2 }, winner: 'HOME', playoffTierType: 'WINNERS_BRACKET' },
        { matchupPeriodId: 22, home: { teamId: 3 }, away: { teamId: 5 }, winner: 'HOME', playoffTierType: 'WINNERS_BRACKET' },
        { matchupPeriodId: 23, home: { teamId: 7 }, away: { teamId: 3 }, winner, playoffTierType: 'WINNERS_BRACKET' },
      ])).toBeNull();
    }
  });

  it('returns null when the schedule is missing or empty', () => {
    expect(deriveBracketFinal(undefined)).toBeNull();
    expect(deriveBracketFinal([])).toBeNull();
  });

  it('returns null when the final period has more than one winners-bracket matchup', () => {
    expect(deriveBracketFinal([
      { matchupPeriodId: 23, home: { teamId: 7 }, away: { teamId: 3 }, winner: 'HOME', playoffTierType: 'WINNERS_BRACKET' },
      { matchupPeriodId: 23, home: { teamId: 2 }, away: { teamId: 5 }, winner: 'HOME', playoffTierType: 'WINNERS_BRACKET' },
    ])).toBeNull();
  });

  it('returns null when the winning side has no team id', () => {
    expect(deriveBracketFinal([
      { matchupPeriodId: 23, home: {}, away: { teamId: 3 }, winner: 'HOME', playoffTierType: 'WINNERS_BRACKET' },
    ])).toBeNull();
  });
});

describe('deriveBracketFinal — tie-rule resolution (FLA-176)', () => {
  const tiedFinal = [
    { matchupPeriodId: 22, home: { teamId: 7 }, away: { teamId: 2 }, winner: 'HOME', playoffTierType: 'WINNERS_BRACKET' },
    { matchupPeriodId: 22, home: { teamId: 3 }, away: { teamId: 5 }, winner: 'HOME', playoffTierType: 'WINNERS_BRACKET' },
    { matchupPeriodId: 23, home: { teamId: 7 }, away: { teamId: 3 }, winner: 'TIE', playoffTierType: 'WINNERS_BRACKET' },
  ];

  it('resolves a tied final to the higher seed under the NONE (platform default) rule', () => {
    expect(deriveBracketFinal(tiedFinal, {
      playoffMatchupTieRule: 'NONE',
      playoffSeeds: new Map([[7, 2], [3, 1]]),
    })).toEqual({ championTeamId: 3, runnerUpTeamId: 7 });
  });

  it('resolves an undecided final the same way (only reached for completed seasons)', () => {
    const undecidedFinal = tiedFinal.map((matchup) =>
      matchup.matchupPeriodId === 23 ? { ...matchup, winner: 'UNDECIDED' } : matchup);
    expect(deriveBracketFinal(undecidedFinal, {
      playoffMatchupTieRule: 'NONE',
      playoffSeeds: new Map([[7, 2], [3, 1]]),
    })).toEqual({ championTeamId: 3, runnerUpTeamId: 7 });
  });

  it('resolves a tied final to the home team under HOME_TEAM_WINS without needing seeds', () => {
    expect(deriveBracketFinal(tiedFinal, {
      playoffMatchupTieRule: 'HOME_TEAM_WINS',
    })).toEqual({ championTeamId: 7, runnerUpTeamId: 3 });
  });

  it('returns null for an unrecognized tie rule', () => {
    expect(deriveBracketFinal(tiedFinal, {
      playoffMatchupTieRule: 'BENCH_POINTS',
      playoffSeeds: new Map([[7, 2], [3, 1]]),
    })).toBeNull();
  });

  it('returns null when the tie rule is missing', () => {
    expect(deriveBracketFinal(tiedFinal, {
      playoffSeeds: new Map([[7, 2], [3, 1]]),
    })).toBeNull();
  });

  it('returns null under NONE when a finalist seed is missing or seeds are equal', () => {
    expect(deriveBracketFinal(tiedFinal, {
      playoffMatchupTieRule: 'NONE',
      playoffSeeds: new Map([[7, 2]]),
    })).toBeNull();
    expect(deriveBracketFinal(tiedFinal, {
      playoffMatchupTieRule: 'NONE',
      playoffSeeds: new Map([[7, 1], [3, 1]]),
    })).toBeNull();
    expect(deriveBracketFinal(tiedFinal, {
      playoffMatchupTieRule: 'NONE',
    })).toBeNull();
  });

  it('does not alter a cleanly decided final regardless of tie-break context', () => {
    const decidedFinal = tiedFinal.map((matchup) =>
      matchup.matchupPeriodId === 23 ? { ...matchup, winner: 'AWAY' } : matchup);
    expect(deriveBracketFinal(decidedFinal, {
      playoffMatchupTieRule: 'HOME_TEAM_WINS',
      playoffSeeds: new Map([[7, 1], [3, 2]]),
    })).toEqual({ championTeamId: 3, runnerUpTeamId: 7 });
  });
});

describe('buildPlayoffSeedMap', () => {
  it('maps team ids to playoff seeds and skips teams without a seed', () => {
    expect(buildPlayoffSeedMap([
      { id: 7, playoffSeed: 2 },
      { id: 3, playoffSeed: 1 },
      { id: 9 },
    ])).toEqual(new Map([[7, 2], [3, 1]]));
  });

  it('treats a zero seed as absent, matching the final-rank sentinel handling', () => {
    expect(buildPlayoffSeedMap([
      { id: 7, playoffSeed: 0 },
      { id: 3, playoffSeed: 1 },
    ])).toEqual(new Map([[3, 1]]));
  });
});
