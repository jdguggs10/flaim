import { describe, expect, it } from 'vitest';
import {
  getDefaultSeasonYear,
  getSeasonLabel,
  isCurrentSeason,
  toCanonicalYear,
  toPlatformYear,
} from '../season-utils';
import {
  getDefaultSeasonYear as sharedGetDefaultSeasonYear,
  getSeasonLabel as sharedGetSeasonLabel,
  isCurrentSeason as sharedIsCurrentSeason,
  toCanonicalYear as sharedToCanonicalYear,
  toPlatformYear as sharedToPlatformYear,
} from '@flaim/worker-shared';

describe('season-utils wrapper', () => {
  it('re-exports the shared implementation for current-season rollover', () => {
    const now = new Date('2026-07-01T00:00:00-04:00');
    expect(getDefaultSeasonYear('football', now)).toBe(sharedGetDefaultSeasonYear('football', now));
    expect(isCurrentSeason('football', 2026, now)).toBe(sharedIsCurrentSeason('football', 2026, now));
  });

  it('re-exports canonical year translation helpers', () => {
    expect(toCanonicalYear(2025, 'basketball', 'espn')).toBe(sharedToCanonicalYear(2025, 'basketball', 'espn'));
    expect(toPlatformYear(2024, 'basketball', 'espn')).toBe(sharedToPlatformYear(2024, 'basketball', 'espn'));
  });

  it('re-exports season labeling', () => {
    expect(getSeasonLabel(2024, 'basketball')).toBe(sharedGetSeasonLabel(2024, 'basketball'));
  });
});
