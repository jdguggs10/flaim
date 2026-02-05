import { describe, expect, it } from 'vitest';
import { toEspnSeasonYear } from '../season';

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
