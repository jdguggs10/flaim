import { describe, expect, it } from 'vitest';
import type { RoutedToolParams } from '../../types';
import {
  createSeasonContext,
  fromEspnSeasonYear,
  getSeasonContext,
  normalizeEspnLeagueStatus,
  toEspnSeasonYear,
  withSeasonContext,
} from '../season';

describe('toEspnSeasonYear', () => {
  it('adds 1 for basketball', () => {
    expect(toEspnSeasonYear(2024, 'basketball')).toBe(2025);
  });

  it('adds 1 for hockey', () => {
    expect(toEspnSeasonYear(2024, 'hockey')).toBe(2025);
  });

  it('passes through football', () => {
    expect(toEspnSeasonYear(2025, 'football')).toBe(2025);
  });

  it('passes through baseball', () => {
    expect(toEspnSeasonYear(2025, 'baseball')).toBe(2025);
  });
});

describe('fromEspnSeasonYear', () => {
  it('subtracts 1 for basketball', () => {
    expect(fromEspnSeasonYear(2025, 'basketball')).toBe(2024);
  });

  it('subtracts 1 for hockey', () => {
    expect(fromEspnSeasonYear(2025, 'hockey')).toBe(2024);
  });

  it('passes through football', () => {
    expect(fromEspnSeasonYear(2025, 'football')).toBe(2025);
  });

  it('passes through baseball', () => {
    expect(fromEspnSeasonYear(2025, 'baseball')).toBe(2025);
  });

  it('is the inverse of toEspnSeasonYear for basketball', () => {
    expect(fromEspnSeasonYear(toEspnSeasonYear(2024, 'basketball'), 'basketball')).toBe(2024);
  });

  it('is the inverse of toEspnSeasonYear for hockey', () => {
    expect(fromEspnSeasonYear(toEspnSeasonYear(2024, 'hockey'), 'hockey')).toBe(2024);
  });
});

describe('createSeasonContext', () => {
  it('tracks both canonical and ESPN year for basketball', () => {
    expect(createSeasonContext(2024, 'basketball')).toEqual({
      canonicalYear: 2024,
      espnYear: 2025,
    });
  });
});

describe('normalizeEspnLeagueStatus', () => {
  it('normalizes previousSeasons to canonical years for basketball', () => {
    expect(normalizeEspnLeagueStatus({
      currentMatchupPeriod: 5,
      previousSeasons: [2024, 2025],
    }, 'basketball')).toEqual({
      currentMatchupPeriod: 5,
      previousSeasons: [2023, 2024],
    });
  });

  it('passes through non-object values unchanged', () => {
    expect(normalizeEspnLeagueStatus(null, 'hockey')).toBeNull();
  });
});

describe('withSeasonContext', () => {
  it('preserves external params and adds seasonContext', () => {
    expect(withSeasonContext({
      sport: 'hockey',
      league_id: '123',
      season_year: 2024,
    })).toEqual({
      sport: 'hockey',
      league_id: '123',
      season_year: 2024,
      seasonContext: {
        canonicalYear: 2024,
        espnYear: 2025,
      },
    });
  });
});

describe('getSeasonContext', () => {
  it('returns routed seasonContext when present', () => {
    const params = withSeasonContext({
      sport: 'basketball',
      league_id: '123',
      season_year: 2024,
    });

    expect(getSeasonContext(params)).toEqual({
      canonicalYear: 2024,
      espnYear: 2025,
    });
  });

  it('throws when routed params are missing seasonContext', () => {
    expect(() => getSeasonContext({
      sport: 'football',
      league_id: '123',
      season_year: 2025,
    } as unknown as RoutedToolParams)).toThrow(/Missing seasonContext/);
  });
});
