import { describe, expect, it } from 'vitest';
import { extractLeagueSettings, normalizeIsKeeper, toExecuteErrorResponse } from '../handlers/utils';
import { YahooClientError } from '../errors';

describe('shared handler utilities', () => {
  it('preserves YAHOO_AUTH_UNAVAILABLE when converting thrown errors to MCP responses', () => {
    expect(toExecuteErrorResponse(new Error('YAHOO_AUTH_UNAVAILABLE: Try again later'))).toEqual({
      success: false,
      error: 'YAHOO_AUTH_UNAVAILABLE: Try again later',
      code: 'YAHOO_AUTH_UNAVAILABLE',
      status: 503,
      retryable: true,
      retry_after: 300,
    });
  });

  it('copies retry metadata from typed Yahoo errors', () => {
    expect(toExecuteErrorResponse(new YahooClientError({
      code: 'YAHOO_RATE_LIMITED',
      message: 'Too many requests. Please wait.',
      status: 429,
      upstreamStatus: 999,
      retryable: true,
      retryAfter: 900,
    }))).toEqual({
      success: false,
      error: 'YAHOO_RATE_LIMITED: Too many requests. Please wait.',
      code: 'YAHOO_RATE_LIMITED',
      status: 429,
      upstream_status: 999,
      retryable: true,
      retry_after: 900,
    });
  });

  it('uses default metadata for known Yahoo error codes', () => {
    expect(toExecuteErrorResponse(new Error('YAHOO_NOT_FOUND: League missing'))).toEqual({
      success: false,
      error: 'YAHOO_NOT_FOUND: League missing',
      code: 'YAHOO_NOT_FOUND',
      status: 404,
    });
  });

  it('leaves unknown Yahoo error codes without retry metadata', () => {
    expect(toExecuteErrorResponse(new Error('YAHOO_UNKNOWN_EDGE: Unexpected'))).toEqual({
      success: false,
      error: 'YAHOO_UNKNOWN_EDGE: Unexpected',
      code: 'YAHOO_UNKNOWN_EDGE',
    });
  });
});

describe('normalizeIsKeeper (FLA-284)', () => {
  it('returns undefined when is_keeper is absent', () => {
    expect(normalizeIsKeeper(undefined)).toBeUndefined();
  });

  it('returns undefined for non-object shapes (defensive against unexpected payloads)', () => {
    expect(normalizeIsKeeper(null)).toBeUndefined();
    expect(normalizeIsKeeper('1')).toBeUndefined();
    expect(normalizeIsKeeper(['status', 'kept'])).toBeUndefined();
  });

  it('passes through native booleans as-is (real capture shape: Sidney Crosby)', () => {
    expect(normalizeIsKeeper({ status: true, cost: false, kept: true })).toEqual({
      status: true,
      cost: false,
      kept: true,
    });
  });

  it('preserves a non-keeper player: status/kept false, not simply absent', () => {
    expect(normalizeIsKeeper({ status: false, cost: false, kept: false })).toEqual({
      status: false,
      cost: false,
      kept: false,
    });
  });

  it('normalizes "0"/"1" string flags to booleans', () => {
    expect(normalizeIsKeeper({ status: '1', cost: false, kept: '1' })).toEqual({
      status: true,
      cost: false,
      kept: true,
    });
    expect(normalizeIsKeeper({ status: '0', cost: false, kept: '0' })).toEqual({
      status: false,
      cost: false,
      kept: false,
    });
  });

  it('normalizes 0/1 numeric flags to booleans', () => {
    expect(normalizeIsKeeper({ status: 1, cost: false, kept: 1 })).toEqual({
      status: true,
      cost: false,
      kept: true,
    });
  });

  it('passes cost through unchanged regardless of type — never observed populated', () => {
    expect(normalizeIsKeeper({ status: true, cost: 25, kept: true })?.cost).toBe(25);
    expect(normalizeIsKeeper({ status: true, cost: null, kept: true })?.cost).toBeNull();
    expect(normalizeIsKeeper({ status: true, cost: '25', kept: true })?.cost).toBe('25');
  });

  it('normalizes "true"/"false" string flags to booleans (FLA-284)', () => {
    expect(normalizeIsKeeper({ status: 'true', cost: false, kept: 'false' })).toEqual({
      status: true,
      cost: false,
      kept: false,
    });
  });

  it('does not coerce an unrecognized status/kept encoding to true (FLA-284 audit)', () => {
    // Previously fell back to Boolean(obj.status)/Boolean(obj.kept), which
    // coerces any truthy-looking unrecognized value (including a
    // non-empty unrecognized string) to `true`. An unrecognized encoding
    // must normalize to undefined instead of being guessed at.
    expect(normalizeIsKeeper({ status: 'yes', cost: false, kept: 'yes' })).toEqual({
      status: undefined,
      cost: false,
      kept: undefined,
    });
    expect(normalizeIsKeeper({ status: '', cost: false, kept: '' })).toEqual({
      status: undefined,
      cost: false,
      kept: undefined,
    });
    expect(normalizeIsKeeper({ status: null, cost: false, kept: null })).toEqual({
      status: undefined,
      cost: false,
      kept: undefined,
    });
  });
});

describe('extractLeagueSettings (FLA-284)', () => {
  it('returns undefined for undefined/null input', () => {
    expect(extractLeagueSettings(undefined)).toBeUndefined();
    expect(extractLeagueSettings(null)).toBeUndefined();
  });

  it('extracts the first plain-object element from a native array (real fixture shape)', () => {
    const raw = [
      { draft_type: 'live', can_trade_draft_picks: '1' },
      { min_games_played: '' },
    ];
    expect(extractLeagueSettings(raw)).toEqual({ draft_type: 'live', can_trade_draft_picks: '1' });
  });

  it('extracts the first plain-object element from a Yahoo numeric-keyed object', () => {
    const raw = { '0': { draft_type: 'live' }, '1': { min_games_played: '' }, count: 2 };
    expect(extractLeagueSettings(raw)).toEqual({ draft_type: 'live' });
  });

  it('returns undefined (not the raw container) when a plain object has no numeric-keyed plain-object entry (FLA-284 audit)', () => {
    // Previously fell back to returning the raw object itself here — which,
    // for a genuinely numeric-keyed-but-all-scalar container, would hand
    // the caller something shaped nothing like a flat settings object.
    // extractLeagueSettings now treats "no plain-object entry found" as
    // "not found" so the caller pushes its LEAGUE_SETTINGS_UNAVAILABLE
    // warning instead of guessing.
    const raw = { draft_type: 'live', can_trade_draft_picks: '1' };
    expect(extractLeagueSettings(raw)).toBeUndefined();

    const numericKeyedScalars = { '0': 'unexpected', '1': 42, count: 2 };
    expect(extractLeagueSettings(numericKeyedScalars)).toBeUndefined();
  });

  it('returns undefined for scalar/unexpected shapes rather than guessing', () => {
    expect(extractLeagueSettings('unexpected')).toBeUndefined();
    expect(extractLeagueSettings(42)).toBeUndefined();
  });
});
