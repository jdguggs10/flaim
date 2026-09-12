import { describe, expect, it } from 'vitest';
import { parseHideLeagueWidgetBody } from '../index-hono';

describe('parseHideLeagueWidgetBody', () => {
  it('accepts true', () => {
    expect(parseHideLeagueWidgetBody({ hideLeagueWidget: true })).toEqual({
      ok: true,
      hideLeagueWidget: true,
    });
  });

  it('accepts false', () => {
    expect(parseHideLeagueWidgetBody({ hideLeagueWidget: false })).toEqual({
      ok: true,
      hideLeagueWidget: false,
    });
  });

  it('rejects a missing field', () => {
    const result = parseHideLeagueWidgetBody({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('hideLeagueWidget must be a boolean');
    }
  });

  it('rejects a string value', () => {
    const result = parseHideLeagueWidgetBody({ hideLeagueWidget: 'true' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('hideLeagueWidget must be a boolean');
    }
  });

  it('rejects a number value', () => {
    const result = parseHideLeagueWidgetBody({ hideLeagueWidget: 1 });
    expect(result.ok).toBe(false);
  });

  it('rejects a null hideLeagueWidget field', () => {
    const result = parseHideLeagueWidgetBody({ hideLeagueWidget: null });
    expect(result.ok).toBe(false);
  });

  // A JSON `null` body parses to the JS value `null`, which is `typeof
  // 'object'` — must be checked explicitly or this throws before validation
  // instead of returning the documented 400.
  it('rejects a null body without throwing', () => {
    const result = parseHideLeagueWidgetBody(null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('hideLeagueWidget must be a boolean');
    }
  });

  it('rejects a non-object body (array)', () => {
    const result = parseHideLeagueWidgetBody([true]);
    expect(result.ok).toBe(false);
  });

  it('rejects a non-object body (string)', () => {
    const result = parseHideLeagueWidgetBody('true');
    expect(result.ok).toBe(false);
  });

  it('rejects a non-object body (number)', () => {
    const result = parseHideLeagueWidgetBody(42);
    expect(result.ok).toBe(false);
  });

  it('rejects undefined', () => {
    const result = parseHideLeagueWidgetBody(undefined);
    expect(result.ok).toBe(false);
  });
});
