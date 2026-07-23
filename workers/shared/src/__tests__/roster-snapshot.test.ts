import { describe, expect, it } from 'vitest';
import {
  getRosterSelectorCapability,
  isCalendarValidDate,
  malformedRosterSnapshotError,
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
    code?: 'INVALID_ROSTER_SNAPSHOT_SELECTOR' | 'SPORT_NOT_SUPPORTED';
  }> = [
    { label: 'no selector -> current', platform: 'espn', sport: 'baseball', expect: 'current' },
    { label: 'espn football week ok', platform: 'espn', sport: 'football', week: 5, expect: 'week' },
    { label: 'espn baseball week normalized to current (published-client compat)', platform: 'espn', sport: 'baseball', week: 15, expect: 'current' },
    { label: 'espn baseball date ok', platform: 'espn', sport: 'baseball', date: '2026-07-10', expect: 'date' },
    { label: 'espn football date rejected', platform: 'espn', sport: 'football', date: '2026-07-10', expect: 'reject' },
    { label: 'yahoo hockey date ok', platform: 'yahoo', sport: 'hockey', date: '2026-01-05', expect: 'date' },
    { label: 'yahoo hockey week normalized to current (published-client compat)', platform: 'yahoo', sport: 'hockey', week: 3, expect: 'current' },
    { label: 'sleeper football week ok', platform: 'sleeper', sport: 'football', week: 9, expect: 'week' },
    { label: 'sleeper basketball week ok', platform: 'sleeper', sport: 'basketball', week: 15, expect: 'week' },
    { label: 'sleeper basketball date rejected', platform: 'sleeper', sport: 'basketball', date: '2026-01-05', expect: 'reject' },
    { label: 'sleeper baseball week -> sport unsupported', platform: 'sleeper', sport: 'baseball', week: 2, expect: 'reject', code: 'SPORT_NOT_SUPPORTED' },
    { label: 'sleeper hockey date -> sport unsupported', platform: 'sleeper', sport: 'hockey', date: '2026-01-05', expect: 'reject', code: 'SPORT_NOT_SUPPORTED' },
    { label: 'both selectors rejected', platform: 'espn', sport: 'football', week: 5, date: '2026-07-10', expect: 'reject' },
    { label: 'calendar-invalid date rejected', platform: 'espn', sport: 'baseball', date: '2026-02-30', expect: 'reject' },
    { label: 'malformed date rejected', platform: 'espn', sport: 'baseball', date: 'July 10', expect: 'reject' },
    { label: 'zero week rejected', platform: 'espn', sport: 'football', week: 0, expect: 'reject' },
    { label: 'fractional week rejected', platform: 'espn', sport: 'football', week: 1.5, expect: 'reject' },
  ];

  it.each(cases)('$label', ({ platform, sport, week, date, expect: expected, code }) => {
    const result = validateRosterSnapshotInput(platform, sport, week, date);
    if (expected === 'reject') {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe(code ?? 'INVALID_ROSTER_SNAPSHOT_SELECTOR');
        expect(result.error.length).toBeGreaterThan(20);
      }
    } else {
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.snapshot.type).toBe(expected);
    }
  });

  it('corrective error names the valid selector', () => {
    const bothOnDaily = validateRosterSnapshotInput('espn', 'baseball', 15, '2026-07-10');
    expect(bothOnDaily.ok).toBe(false);
    if (!bothOnDaily.ok) expect(bothOnDaily.error).toContain('as_of_date');

    const dateOnFootball = validateRosterSnapshotInput('yahoo', 'football', undefined, '2026-07-10');
    expect(dateOnFootball.ok).toBe(false);
    if (!dateOnFootball.ok) expect(dateOnFootball.error).toContain('week');
  });

  it('sport-unsupported error does not suggest a selector-free retry', () => {
    const result = validateRosterSnapshotInput('sleeper', 'baseball', 2, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('SPORT_NOT_SUPPORTED');
      expect(result.error).toContain('does not support baseball');
      expect(result.error).not.toContain('current roster');
    }
  });
});

// Published-client compatibility (FLA-209): clients pinned to an older tool
// schema still send `week` for daily sports and cannot send `as_of_date`.
// A well-formed week on a date-capability sport normalizes to the current
// roster with the ignored selector carried in metadata — never silently.
describe('published-client week compatibility (FLA-209)', () => {
  const dailyCases: Array<[string, SeasonSport, number]> = [
    ['espn', 'baseball', 15],
    ['espn', 'basketball', 3],
    ['espn', 'hockey', 3],
    ['yahoo', 'baseball', 15],
    ['yahoo', 'basketball', 7],
    ['yahoo', 'hockey', 3],
  ];

  it.each(dailyCases)('%s %s week %i -> current snapshot carrying requestedWeek', (platform, sport, week) => {
    const result = validateRosterSnapshotInput(platform, sport, week, undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot).toEqual({ type: 'current', requestedWeek: week });
    }
  });

  it('week-capability sports still get a week snapshot, not the shim', () => {
    for (const platform of ['espn', 'yahoo', 'sleeper']) {
      const result = validateRosterSnapshotInput(platform, 'football', 5, undefined);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.snapshot).toEqual({ type: 'week', week: 5 });
    }
  });

  it('week alongside as_of_date on a daily sport still rejects', () => {
    const result = validateRosterSnapshotInput('espn', 'baseball', 15, '2026-07-10');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_ROSTER_SNAPSHOT_SELECTOR');
  });

  it.each([[0], [-2], [1.5], [Number.NaN]])('malformed week %d on a daily sport still rejects', (week) => {
    const result = validateRosterSnapshotInput('espn', 'baseball', week, undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('INVALID_ROSTER_SNAPSHOT_SELECTOR');
      expect(result.error).toContain('positive integer');
    }
  });

  it('metadata reports the ignored selector with a human-readable note', () => {
    const metadata = toSnapshotMetadata({ type: 'current', requestedWeek: 15 });
    expect(metadata.type).toBe('current');
    expect(metadata.requested_week).toBe(15);
    expect(metadata.note).toContain('week 15');
    expect(metadata.note).toContain('current roster');
    expect(metadata.note).toContain('as_of_date');
  });

  it('worker re-derivation preserves the normalized-week marker', () => {
    expect(resolveRosterSnapshotFromParams({ snapshot: { type: 'current', requestedWeek: 15 } }))
      .toEqual({ type: 'current', requestedWeek: 15 });
  });

  it.each([
    ['zero requestedWeek', { type: 'current', requestedWeek: 0 }],
    ['fractional requestedWeek', { type: 'current', requestedWeek: 1.5 }],
    ['non-numeric requestedWeek', { type: 'current', requestedWeek: '15' }],
    ['requestedWeek on a week snapshot', { type: 'week', week: 5, requestedWeek: 15 }],
    ['requestedWeek on a date snapshot', { type: 'date', date: '2026-07-10', requestedWeek: 15 }],
  ])('worker re-derivation rejects %s', (_label, snapshot) => {
    expect(resolveRosterSnapshotFromParams({ snapshot })).toBeNull();
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

  it('maps legacy week to type week only when snapshot is absent (old gateway)', () => {
    expect(resolveRosterSnapshotFromParams({ week: 15 })).toEqual({ type: 'week', week: 15 });
    expect(resolveRosterSnapshotFromParams({ snapshot: undefined, week: 15 })).toEqual({ type: 'week', week: 15 });
  });

  const malformedSnapshots: Array<[string, unknown]> = [
    ['calendar-invalid date', { type: 'date', date: '2026-02-30' }],
    ['zero week', { type: 'week', week: 0 }],
    ['fractional week', { type: 'week', week: 1.5 }],
    ['unknown type', { type: 'yesterday' }],
    ['non-object', 'current'],
    ['array', ['current']],
    ['null snapshot', null],
    ['current with date field', { type: 'current', date: '2026-07-10' }],
    ['current with week field', { type: 'current', week: 5 }],
    ['week carrying date', { type: 'week', week: 5, date: '2026-07-10' }],
    ['date carrying week', { type: 'date', date: '2026-07-10', week: 5 }],
    ['week with null week', { type: 'week', week: null }],
    ['date with null date', { type: 'date', date: null }],
  ];

  it.each(malformedSnapshots)('returns null for %s instead of degrading to current', (_label, snapshot) => {
    expect(resolveRosterSnapshotFromParams({ snapshot })).toBeNull();
    // a malformed snapshot never falls through to legacy week either
    expect(resolveRosterSnapshotFromParams({ snapshot, week: 4 })).toBeNull();
  });

  it('rejects a present but invalid legacy week instead of degrading to current', () => {
    expect(resolveRosterSnapshotFromParams({ week: 0 })).toBeNull();
    expect(resolveRosterSnapshotFromParams({ week: 1.5 })).toBeNull();
    expect(resolveRosterSnapshotFromParams({ week: null })).toBeNull();
    expect(resolveRosterSnapshotFromParams({ week: Number.NaN })).toBeNull();
  });

  it('returns current only on total selector absence', () => {
    expect(resolveRosterSnapshotFromParams({})).toEqual({ type: 'current' });
  });
});

describe('rosterSnapshotUnsupportedError', () => {
  it('returns corrective error with canonical code and a 400 classification', () => {
    const err = rosterSnapshotUnsupportedError('espn', 'baseball');
    expect(err.success).toBe(false);
    expect(err.code).toBe('INVALID_ROSTER_SNAPSHOT_SELECTOR');
    expect(err.error).toContain('as_of_date');
    expect(err.status).toBe(400);
  });
});

describe('malformedRosterSnapshotError', () => {
  it('returns the canonical corrective error with a 400 classification', () => {
    const err = malformedRosterSnapshotError();
    expect(err.success).toBe(false);
    expect(err.code).toBe('INVALID_ROSTER_SNAPSHOT_SELECTOR');
    expect(err.error).toContain('as_of_date');
    expect(err.status).toBe(400);
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
