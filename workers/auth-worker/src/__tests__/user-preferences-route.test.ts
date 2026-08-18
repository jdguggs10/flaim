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
    const result = parseHideLeagueWidgetBody({ hideLeagueWidget: 'true' as unknown as boolean });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('hideLeagueWidget must be a boolean');
    }
  });

  it('rejects a number value', () => {
    const result = parseHideLeagueWidgetBody({ hideLeagueWidget: 1 as unknown as boolean });
    expect(result.ok).toBe(false);
  });

  it('rejects null', () => {
    const result = parseHideLeagueWidgetBody({ hideLeagueWidget: null as unknown as boolean });
    expect(result.ok).toBe(false);
  });
});
