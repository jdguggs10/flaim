import { describe, expect, it } from 'vitest';
import {
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
});
