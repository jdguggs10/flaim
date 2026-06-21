import { describe, expect, it } from 'vitest';
import { parseArchiveBody } from '../index-hono';

describe('parseArchiveBody', () => {
  it('accepts a valid espn body', () => {
    const result = parseArchiveBody({ platform: 'espn', sport: 'football', recurringLeagueId: '123456' });
    expect(result).toEqual({ ok: true, platform: 'espn', sport: 'football', recurringLeagueId: '123456' });
  });

  it('accepts a valid sleeper body', () => {
    const result = parseArchiveBody({ platform: 'sleeper', sport: 'basketball', recurringLeagueId: '987654321098765432' });
    expect(result).toEqual({ ok: true, platform: 'sleeper', sport: 'basketball', recurringLeagueId: '987654321098765432' });
  });

  it('accepts a valid yahoo body (Phase 1b — recurring id now resolved)', () => {
    const result = parseArchiveBody({ platform: 'yahoo', sport: 'football', recurringLeagueId: '449.l.123' });
    expect(result).toEqual({ ok: true, platform: 'yahoo', sport: 'football', recurringLeagueId: '449.l.123' });
  });

  it('rejects an unsupported platform', () => {
    const result = parseArchiveBody({ platform: 'cbs', sport: 'football', recurringLeagueId: '123' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('cbs');
    }
  });

  it('rejects a missing recurringLeagueId', () => {
    const result = parseArchiveBody({ platform: 'espn', sport: 'football' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('platform, sport, and recurringLeagueId are required');
    }
  });

  it('rejects an invalid sport', () => {
    const result = parseArchiveBody({ platform: 'espn', sport: 'soccer', recurringLeagueId: '123' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Invalid sport');
    }
  });

  it('rejects a recurringLeagueId longer than 255 chars', () => {
    const tooLong = '1'.repeat(256);
    const result = parseArchiveBody({ platform: 'espn', sport: 'football', recurringLeagueId: tooLong });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Invalid recurringLeagueId');
    }
  });

  it('accepts a recurringLeagueId at exactly 255 chars', () => {
    const maxLength = '1'.repeat(255);
    const result = parseArchiveBody({ platform: 'espn', sport: 'football', recurringLeagueId: maxLength });
    expect(result.ok).toBe(true);
  });

  it.each([
    ['a space', 'abc 123'],
    ['a semicolon', 'abc;123'],
    ['a single quote', "abc'123"],
    ['a double quote', 'abc"123'],
    ['a slash', 'abc/123'],
  ])('rejects a recurringLeagueId containing %s', (_label, recurringLeagueId) => {
    const result = parseArchiveBody({ platform: 'espn', sport: 'football', recurringLeagueId });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('Invalid recurringLeagueId');
    }
  });

  it('accepts a valid dotted Yahoo-style id (e.g. 449.l.123) for a supported platform', () => {
    // Yahoo as a platform is deferred, but the dotted-id charset must pass so the
    // charset rule never becomes the reason a future Yahoo id is rejected.
    const result = parseArchiveBody({ platform: 'sleeper', sport: 'football', recurringLeagueId: '449.l.123' });
    expect(result).toEqual({ ok: true, platform: 'sleeper', sport: 'football', recurringLeagueId: '449.l.123' });
  });
});
