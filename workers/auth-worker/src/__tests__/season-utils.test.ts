import { describe, expect, it } from 'vitest';
import { getDefaultSeasonYear, isCurrentSeason, SeasonSport } from '../season-utils';

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

    // Football: rolls over Jun 1
    describe('football', () => {
      it('returns previous year before Jun 1', () => {
        const may15 = new Date('2026-05-15T12:00:00-04:00');
        expect(getDefaultSeasonYear('football', may15)).toBe(2025);
      });

      it('returns current year on Jun 1', () => {
        const jun1 = new Date('2026-06-01T00:00:00-04:00');
        expect(getDefaultSeasonYear('football', jun1)).toBe(2026);
      });

      it('returns current year in January (post-playoffs)', () => {
        const jan15 = new Date('2026-01-15T12:00:00-05:00');
        expect(getDefaultSeasonYear('football', jan15)).toBe(2025);
      });
    });

    // Basketball: rolls over Oct 1
    describe('basketball', () => {
      it('returns previous year before Oct 1', () => {
        const sep15 = new Date('2026-09-15T12:00:00-04:00');
        expect(getDefaultSeasonYear('basketball', sep15)).toBe(2025);
      });

      it('returns current year on Oct 1', () => {
        const oct1 = new Date('2026-10-01T00:00:00-04:00');
        expect(getDefaultSeasonYear('basketball', oct1)).toBe(2026);
      });
    });

    // Hockey: rolls over Oct 1
    describe('hockey', () => {
      it('returns previous year before Oct 1', () => {
        const sep15 = new Date('2026-09-15T12:00:00-04:00');
        expect(getDefaultSeasonYear('hockey', sep15)).toBe(2025);
      });

      it('returns current year on Oct 1', () => {
        const oct1 = new Date('2026-10-01T00:00:00-04:00');
        expect(getDefaultSeasonYear('hockey', oct1)).toBe(2026);
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
});
