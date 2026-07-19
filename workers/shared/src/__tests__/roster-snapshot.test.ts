import { describe, expect, it } from 'vitest';
import {
  getRosterSelectorCapability,
  isCalendarValidDate,
  resolveRosterSnapshotFromParams,
  rosterSnapshotUnsupportedError,
  toSnapshotMetadata,
  validateRosterSnapshotInput,
} from '../roster-snapshot.js';
import type { SeasonSport } from '../season.js';

describe('getRosterSelectorCapability', () => {
  const matrix: Array<[string, SeasonSport, 'week' | 'date' | undefined]> = [
    ['espn', 'football', 'week'],
    ['espn', 'baseball', 'date'],
    ['espn', 'basketball', 'date'],
    ['espn', 'hockey', 'date'],
    ['yahoo', 'football', 'week'],
    ['yahoo', 'baseball', 'date'],
    ['yahoo', 'basketball', 'date'],
    ['yahoo', 'hockey', 'date'],
    ['sleeper', 'football', 'week'],
    ['sleeper', 'basketball', 'week'],
    ['sleeper', 'baseball', undefined],
    ['sleeper', 'hockey', undefined],
  ];

  it.each(matrix)('%s %s -> %s', (platform, sport, expected) => {
    expect(getRosterSelectorCapability(platform, sport)).toBe(expected);
  });
});

describe('isCalendarValidDate', () => {
  it('accepts real dates', () => {
    expect(isCalendarValidDate('2026-07-10')).toBe(true);
    expect(isCalendarValidDate('2024-02-29')).toBe(true); // leap year
  });

  it('rejects calendar-invalid and malformed values', () => {
    expect(isCalendarValidDate('2026-02-30')).toBe(false);
    expect(isCalendarValidDate('2026-13-01')).toBe(false);
    expect(isCalendarValidDate('2025-02-29')).toBe(false); // not a leap year
    expect(isCalendarValidDate('07/10/2026')).toBe(false);
    expect(isCalendarValidDate('2026-7-10')).toBe(false);
    expect(isCalendarValidDate('')).toBe(false);
  });
});

describe('validateRosterSnapshotInput', () => {
  const cases: Array<{
    label: string;
    platform: string;
    sport: SeasonSport;
    week?: number;
    date?: string;
    expect: 'current' | 'week' | 'date' | 'reject';
  }> = [
    { label: 'no selector -> current', platform: 'espn', sport: 'baseball', expect: 'current' },
    { label: 'espn football week ok', platform: 'espn', sport: 'football', week: 5, expect: 'week' },
    { label: 'espn baseball week rejected', platform: 'espn', sport: 'baseball', week: 15, expect: 'reject' },
    { label: 'espn baseball date ok', platform: 'espn', sport: 'baseball', date: '2026-07-10', expect: 'date' },
    { label: 'espn football date rejected', platform: 'espn', sport: 'football', date: '2026-07-10', expect: 'reject' },
    { label: 'yahoo hockey date ok', platform: 'yahoo', sport: 'hockey', date: '2026-01-05', expect: 'date' },
    { label: 'yahoo hockey week rejected', platform: 'yahoo', sport: 'hockey', week: 3, expect: 'reject' },
    { label: 'sleeper football week ok', platform: 'sleeper', sport: 'football', week: 9, expect: 'week' },
    { label: 'sleeper basketball week ok', platform: 'sleeper', sport: 'basketball', week: 15, expect: 'week' },
    { label: 'sleeper basketball date rejected', platform: 'sleeper', sport: 'basketball', date: '2026-01-05', expect: 'reject' },
    { label: 'sleeper baseball week rejected', platform: 'sleeper', sport: 'baseball', week: 2, expect: 'reject' },
    { label: 'both selectors rejected', platform: 'espn', sport: 'football', week: 5, date: '2026-07-10', expect: 'reject' },
    { label: 'calendar-invalid date rejected', platform: 'espn', sport: 'baseball', date: '2026-02-30', expect: 'reject' },
    { label: 'malformed date rejected', platform: 'espn', sport: 'baseball', date: 'July 10', expect: 'reject' },
    { label: 'zero week rejected', platform: 'espn', sport: 'football', week: 0, expect: 'reject' },
    { label: 'fractional week rejected', platform: 'espn', sport: 'football', week: 1.5, expect: 'reject' },
  ];

  it.each(cases)('$label', ({ platform, sport, week, date, expect: expected }) => {
    const result = validateRosterSnapshotInput(platform, sport, week, date);
    if (expected === 'reject') {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('INVALID_ROSTER_SNAPSHOT_SELECTOR');
        expect(result.error.length).toBeGreaterThan(20);
      }
    } else {
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.snapshot.type).toBe(expected);
    }
  });

  it('corrective error names the valid selector', () => {
    const weekOnDaily = validateRosterSnapshotInput('espn', 'baseball', 15, undefined);
    expect(weekOnDaily.ok).toBe(false);
    if (!weekOnDaily.ok) expect(weekOnDaily.error).toContain('as_of_date');

    const dateOnFootball = validateRosterSnapshotInput('yahoo', 'football', undefined, '2026-07-10');
    expect(dateOnFootball.ok).toBe(false);
    if (!dateOnFootball.ok) expect(dateOnFootball.error).toContain('week');
  });
});

describe('resolveRosterSnapshotFromParams', () => {
  it('prefers a well-formed injected snapshot', () => {
    expect(resolveRosterSnapshotFromParams({ snapshot: { type: 'date', date: '2026-07-10' }, week: 4 }))
      .toEqual({ type: 'date', date: '2026-07-10' });
    expect(resolveRosterSnapshotFromParams({ snapshot: { type: 'current' } }))
      .toEqual({ type: 'current' });
    expect(resolveRosterSnapshotFromParams({ snapshot: { type: 'week', week: 9 } }))
      .toEqual({ type: 'week', week: 9 });
  });

  it('maps legacy week to type week when snapshot is absent (old gateway)', () => {
    expect(resolveRosterSnapshotFromParams({ week: 15 })).toEqual({ type: 'week', week: 15 });
  });

  it('falls back to current on malformed snapshot and no legacy week', () => {
    expect(resolveRosterSnapshotFromParams({ snapshot: { type: 'date', date: '2026-02-30' } }))
      .toEqual({ type: 'current' });
    expect(resolveRosterSnapshotFromParams({ snapshot: { type: 'week', week: 0 } }))
      .toEqual({ type: 'current' });
    expect(resolveRosterSnapshotFromParams({})).toEqual({ type: 'current' });
  });
});

describe('rosterSnapshotUnsupportedError', () => {
  it('returns corrective error with canonical code', () => {
    const err = rosterSnapshotUnsupportedError('espn', 'baseball');
    expect(err.success).toBe(false);
    expect(err.code).toBe('INVALID_ROSTER_SNAPSHOT_SELECTOR');
    expect(err.error).toContain('as_of_date');
  });
});

describe('toSnapshotMetadata', () => {
  it('emits the discriminant and selector value only', () => {
    expect(toSnapshotMetadata({ type: 'current' })).toEqual({ type: 'current' });
    expect(toSnapshotMetadata({ type: 'week', week: 9 })).toEqual({ type: 'week', week: 9 });
    expect(toSnapshotMetadata({ type: 'date', date: '2026-07-10' }, { providerScoringPeriodId: 108 }))
      .toEqual({ type: 'date', date: '2026-07-10', providerScoringPeriodId: 108 });
  });
});
