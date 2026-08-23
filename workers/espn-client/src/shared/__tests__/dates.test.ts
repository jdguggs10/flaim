// workers/espn-client/src/shared/__tests__/dates.test.ts
import { describe, expect, it } from 'vitest';
import { epochMsToIso } from '../dates';

describe('epochMsToIso (FLA-284)', () => {
  it('converts a valid positive epoch-ms number to an ISO string', () => {
    expect(epochMsToIso(1773964800000)).toBe('2026-03-20T00:00:00.000Z');
  });

  it('passes through explicit null (ESPN reports "no date set")', () => {
    expect(epochMsToIso(null)).toBeNull();
  });

  it('passes through undefined (the source block/field is absent)', () => {
    expect(epochMsToIso(undefined)).toBeUndefined();
  });

  it('normalizes 0 to null rather than the epoch instant', () => {
    expect(epochMsToIso(0)).toBeNull();
  });

  it('normalizes negative numbers to null', () => {
    expect(epochMsToIso(-1)).toBeNull();
  });

  it('normalizes NaN to null rather than throwing', () => {
    expect(epochMsToIso(NaN)).toBeNull();
  });

  it('normalizes non-finite numbers (Infinity) to null rather than throwing', () => {
    expect(epochMsToIso(Infinity)).toBeNull();
    expect(epochMsToIso(-Infinity)).toBeNull();
  });

  it('normalizes garbage shapes (string, object) to null rather than throwing', () => {
    expect(epochMsToIso('abc')).toBeNull();
    expect(epochMsToIso({})).toBeNull();
    expect(epochMsToIso([])).toBeNull();
    expect(epochMsToIso(true)).toBeNull();
  });

  it('normalizes finite numbers beyond the ECMAScript date range to null rather than throwing', () => {
    expect(epochMsToIso(Number.MAX_VALUE)).toBeNull();
    expect(epochMsToIso(8.64e15 + 1)).toBeNull();
  });

  it('still converts a normal epoch after the out-of-range guard', () => {
    expect(epochMsToIso(1773964800000)).toBe('2026-03-20T00:00:00.000Z');
  });
});
