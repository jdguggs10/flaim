import { describe, expect, it } from 'vitest';
import {
  getDefaultSeasonYear,
  getSeasonLabel,
  isCurrentSeason,
  toCanonicalYear,
  toPlatformYear,
} from '../season.js';

describe('season helpers', () => {
  describe('getDefaultSeasonYear', () => {
    it('returns the previous baseball season before Feb 1', () => {
      expect(getDefaultSeasonYear('baseball', new Date('2026-01-15T12:00:00-05:00'))).toBe(2025);
    });

    it('returns the current baseball season on Feb 1', () => {
      expect(getDefaultSeasonYear('baseball', new Date('2026-02-01T00:00:00-05:00'))).toBe(2026);
    });

    it('returns the previous football season before Jul 1', () => {
      expect(getDefaultSeasonYear('football', new Date('2026-06-15T12:00:00-04:00'))).toBe(2025);
    });

    it('returns the current football season on Jul 1', () => {
      expect(getDefaultSeasonYear('football', new Date('2026-07-01T00:00:00-04:00'))).toBe(2026);
    });

    it('returns the previous basketball season before Aug 1', () => {
      expect(getDefaultSeasonYear('basketball', new Date('2026-07-15T12:00:00-04:00'))).toBe(2025);
    });

    it('returns the current hockey season on Aug 1', () => {
      expect(getDefaultSeasonYear('hockey', new Date('2026-08-01T00:00:00-04:00'))).toBe(2026);
    });
  });

  describe('isCurrentSeason', () => {
    it('compares against the canonical season year', () => {
      const now = new Date('2026-02-15T12:00:00-05:00');
      expect(isCurrentSeason('baseball', 2026, now)).toBe(true);
      expect(isCurrentSeason('baseball', 2025, now)).toBe(false);
    });
  });

  describe('canonical year translation', () => {
    it('normalizes ESPN basketball and hockey end years', () => {
      expect(toCanonicalYear(2025, 'basketball', 'espn')).toBe(2024);
      expect(toCanonicalYear(2025, 'hockey', 'espn')).toBe(2024);
    });

    it('round-trips canonical years back to ESPN end years', () => {
      expect(toPlatformYear(2024, 'basketball', 'espn')).toBe(2025);
      expect(toPlatformYear(2024, 'hockey', 'espn')).toBe(2025);
    });

    it('passes through non-ESPN values unchanged', () => {
      expect(toCanonicalYear(2025, 'football', 'yahoo')).toBe(2025);
      expect(toPlatformYear(2025, 'football', 'yahoo')).toBe(2025);
    });
  });

  describe('getSeasonLabel', () => {
    it('formats cross-year sports with a short trailing year', () => {
      expect(getSeasonLabel(2024, 'basketball')).toBe('2024-25');
      expect(getSeasonLabel(2099, 'hockey')).toBe('2099-00');
    });

    it('formats single-year sports as a plain year', () => {
      expect(getSeasonLabel(2025, 'baseball')).toBe('2025');
      expect(getSeasonLabel(2025, 'football')).toBe('2025');
    });
  });
});
