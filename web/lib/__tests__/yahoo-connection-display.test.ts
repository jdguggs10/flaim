import { describe, expect, it } from 'vitest';

import {
  getYahooBadgeCopy,
  getYahooDisplayState,
  getYahooStatusCopy,
  parseYahooConnectionHealth,
} from '../yahoo-connection-display';

describe('parseYahooConnectionHealth', () => {
  it('accepts valid health payloads with positive retry timing', () => {
    expect(parseYahooConnectionHealth({
      accessTokenState: 'needs_refresh',
      refreshState: 'cooldown',
      retryAfterSeconds: 45,
    })).toEqual({
      accessTokenState: 'needs_refresh',
      refreshState: 'cooldown',
      retryAfterSeconds: 45,
    });
  });

  it('rejects malformed health payloads', () => {
    expect(parseYahooConnectionHealth(null)).toBeNull();
    expect(parseYahooConnectionHealth({ accessTokenState: 'fresh' })).toBeNull();
    expect(parseYahooConnectionHealth({ accessTokenState: 'fresh', refreshState: 'unknown' })).toBeNull();
    expect(parseYahooConnectionHealth({ accessTokenState: 'unknown', refreshState: 'idle' })).toBeNull();
  });

  it('drops non-positive or non-finite retry timing', () => {
    expect(parseYahooConnectionHealth({
      accessTokenState: 'fresh',
      refreshState: 'idle',
      retryAfterSeconds: 0,
    })).toEqual({
      accessTokenState: 'fresh',
      refreshState: 'idle',
      retryAfterSeconds: undefined,
    });
    expect(parseYahooConnectionHealth({
      accessTokenState: 'fresh',
      refreshState: 'idle',
      retryAfterSeconds: Number.POSITIVE_INFINITY,
    })).toEqual({
      accessTokenState: 'fresh',
      refreshState: 'idle',
      retryAfterSeconds: undefined,
    });
  });
});

describe('Yahoo display copy', () => {
  it('prioritizes checking and reconnect-needed states', () => {
    expect(getYahooDisplayState(true, true, true, { accessTokenState: 'fresh', refreshState: 'cooldown' })).toBe('checking');
    expect(getYahooDisplayState(false, true, true, { accessTokenState: 'fresh', refreshState: 'idle' })).toBe('reconnect_needed');
  });

  it('maps connection health to display state', () => {
    expect(getYahooDisplayState(false, false, false, null)).toBe('not_connected');
    expect(getYahooDisplayState(false, true, false, null)).toBe('connected');
    expect(getYahooDisplayState(false, true, false, { accessTokenState: 'fresh', refreshState: 'idle' })).toBe('connected');
    expect(getYahooDisplayState(false, true, false, { accessTokenState: 'needs_refresh', refreshState: 'expired' })).toBe('connected');
    expect(getYahooDisplayState(false, true, false, { accessTokenState: 'needs_refresh', refreshState: 'cooldown' })).toBe('cooldown');
    expect(getYahooDisplayState(false, true, false, { accessTokenState: 'needs_refresh', refreshState: 'in_progress' })).toBe('in_progress');
  });

  it('returns badge and status copy for cooldown and reconnect-needed states', () => {
    expect(getYahooBadgeCopy('cooldown')).toEqual({
      label: 'Temporarily unavailable',
      className: 'bg-warning/20 text-warning',
    });
    expect(getYahooStatusCopy('cooldown', {
      accessTokenState: 'needs_refresh',
      refreshState: 'cooldown',
      retryAfterSeconds: 60,
    })).toContain('Try syncing leagues again in about 1 minute.');
    expect(getYahooStatusCopy('in_progress', {
      accessTokenState: 'needs_refresh',
      refreshState: 'in_progress',
      retryAfterSeconds: 30,
    })).toContain('Try syncing leagues again in 30 seconds.');
    expect(getYahooBadgeCopy('reconnect_needed').label).toBe('Reconnect needed');
    expect(getYahooStatusCopy('reconnect_needed', null)).toContain('sign in again');
  });
});
