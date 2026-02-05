import { describe, expect, it } from 'vitest';
import {
  getDefaultSeasonYear,
  isCurrentSeason,
  toCanonicalYear,
  toPlatformYear,
  getSeasonLabel,
  SeasonSport,
} from '../season-utils';

describe('season-utils', () => {
  describe('getDefaultSeasonYear', () => {
    // Baseball: rolls over Feb 1
    describe('baseball', () => {
      it('returns previous year before Feb 1', () => {
        const jan15 = new Date('2026-01-15T12:00:00-05:00');
        expect(getDefaultSeasonYear('baseball', jan15)).toBe(2025);
      });

      it('returns current year on Feb 1', () => {
        const feb1 = new Date('2026-02-01T00:00:00-05:00');
        expect(getDefaultSeasonYear('baseball', feb1)).toBe(2026);
      });

      it('returns current year after Feb 1', () => {
        const mar15 = new Date('2026-03-15T12:00:00-04:00');
        expect(getDefaultSeasonYear('baseball', mar15)).toBe(2026);
      });
    });

    // Football: rolls over Jul 1
    describe('football', () => {
      it('returns previous year before Jul 1', () => {
        const jun15 = new Date('2026-06-15T12:00:00-04:00');
        expect(getDefaultSeasonYear('football', jun15)).toBe(2025);
      });

      it('returns current year on Jul 1', () => {
        const jul1 = new Date('2026-07-01T00:00:00-04:00');
        expect(getDefaultSeasonYear('football', jul1)).toBe(2026);
      });

      it('returns current year in January (post-playoffs)', () => {
        const jan15 = new Date('2026-01-15T12:00:00-05:00');
        expect(getDefaultSeasonYear('football', jan15)).toBe(2025);
      });
    });

    // Basketball: rolls over Aug 1
    describe('basketball', () => {
      it('returns previous year before Aug 1', () => {
        const jul15 = new Date('2026-07-15T12:00:00-04:00');
        expect(getDefaultSeasonYear('basketball', jul15)).toBe(2025);
      });

      it('returns current year on Aug 1', () => {
        const aug1 = new Date('2026-08-01T00:00:00-04:00');
        expect(getDefaultSeasonYear('basketball', aug1)).toBe(2026);
      });

      it('returns previous year in January (mid-season)', () => {
        const jan15 = new Date('2026-01-15T12:00:00-05:00');
        expect(getDefaultSeasonYear('basketball', jan15)).toBe(2025);
      });
    });

    // Hockey: rolls over Aug 1
    describe('hockey', () => {
      it('returns previous year before Aug 1', () => {
        const jul15 = new Date('2026-07-15T12:00:00-04:00');
        expect(getDefaultSeasonYear('hockey', jul15)).toBe(2025);
      });

      it('returns current year on Aug 1', () => {
        const aug1 = new Date('2026-08-01T00:00:00-04:00');
        expect(getDefaultSeasonYear('hockey', aug1)).toBe(2026);
      });
    });

    // Edge cases
    describe('edge cases', () => {
      it('uses current date when no date provided', () => {
        const result = getDefaultSeasonYear('baseball');
        expect(typeof result).toBe('number');
        expect(result).toBeGreaterThanOrEqual(2024);
        expect(result).toBeLessThanOrEqual(2030);
      });
    });
  });

  describe('isCurrentSeason', () => {
    it('returns true when season matches current', () => {
      const feb15 = new Date('2026-02-15T12:00:00-05:00');
      expect(isCurrentSeason('baseball', 2026, feb15)).toBe(true);
    });

    it('returns false when season does not match current', () => {
      const feb15 = new Date('2026-02-15T12:00:00-05:00');
      expect(isCurrentSeason('baseball', 2025, feb15)).toBe(false);
    });

    it('handles football season spanning calendar years', () => {
      const jan15 = new Date('2026-01-15T12:00:00-05:00');
      expect(isCurrentSeason('football', 2025, jan15)).toBe(true);
      expect(isCurrentSeason('football', 2026, jan15)).toBe(false);
    });
  });

  describe('toCanonicalYear', () => {
    it('subtracts 1 for ESPN basketball', () => {
      expect(toCanonicalYear(2025, 'basketball', 'espn')).toBe(2024);
    });

    it('subtracts 1 for ESPN hockey', () => {
      expect(toCanonicalYear(2025, 'hockey', 'espn')).toBe(2024);
    });

    it('passes through ESPN baseball', () => {
      expect(toCanonicalYear(2025, 'baseball', 'espn')).toBe(2025);
    });

    it('passes through ESPN football', () => {
      expect(toCanonicalYear(2025, 'football', 'espn')).toBe(2025);
    });

    it('passes through Yahoo basketball', () => {
      expect(toCanonicalYear(2024, 'basketball', 'yahoo')).toBe(2024);
    });

    it('passes through Yahoo hockey', () => {
      expect(toCanonicalYear(2024, 'hockey', 'yahoo')).toBe(2024);
    });
  });

  describe('toPlatformYear', () => {
    it('adds 1 for ESPN basketball', () => {
      expect(toPlatformYear(2024, 'basketball', 'espn')).toBe(2025);
    });

    it('adds 1 for ESPN hockey', () => {
      expect(toPlatformYear(2024, 'hockey', 'espn')).toBe(2025);
    });

    it('passes through ESPN baseball', () => {
      expect(toPlatformYear(2025, 'baseball', 'espn')).toBe(2025);
    });

    it('passes through ESPN football', () => {
      expect(toPlatformYear(2025, 'football', 'espn')).toBe(2025);
    });

    it('passes through Yahoo basketball', () => {
      expect(toPlatformYear(2024, 'basketball', 'yahoo')).toBe(2024);
    });

    it('round-trips correctly for ESPN basketball', () => {
      const espnYear = 2025;
      const canonical = toCanonicalYear(espnYear, 'basketball', 'espn');
      const backToEspn = toPlatformYear(canonical, 'basketball', 'espn');
      expect(backToEspn).toBe(espnYear);
    });
  });

  describe('getSeasonLabel', () => {
    it('returns hyphenated label for basketball', () => {
      expect(getSeasonLabel(2024, 'basketball')).toBe('2024-25');
    });

    it('returns hyphenated label for hockey', () => {
      expect(getSeasonLabel(2025, 'hockey')).toBe('2025-26');
    });

    it('returns plain year for baseball', () => {
      expect(getSeasonLabel(2025, 'baseball')).toBe('2025');
    });

    it('returns plain year for football', () => {
      expect(getSeasonLabel(2025, 'football')).toBe('2025');
    });

    it('handles century boundary', () => {
      expect(getSeasonLabel(2099, 'basketball')).toBe('2099-00');
    });
  });
});
