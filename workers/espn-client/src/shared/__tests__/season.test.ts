import { describe, expect, it } from 'vitest';
import { toEspnSeasonYear, fromEspnSeasonYear } from '../season';

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
