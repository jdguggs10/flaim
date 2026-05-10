import { describe, expect, it, vi } from 'vitest';
import {
  classifyYahooApiFailure,
  defaultYahooRetryAfterSeconds,
  isYahooRateLimitStatus,
  isYahooTransientHttpStatus,
  parseRetryAfterSeconds,
  retryAfterSecondsFromHeaders,
} from '../http';

describe('HTTP helpers', () => {
  it('parses numeric and HTTP-date Retry-After values', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-10T15:00:00Z'));

    try {
      expect(parseRetryAfterSeconds('120')).toBe(120);
      expect(parseRetryAfterSeconds('Sun, 10 May 2026 15:05:00 GMT')).toBe(300);
      expect(parseRetryAfterSeconds('Sun, 10 May 2026 14:55:00 GMT')).toBe(1);
      expect(parseRetryAfterSeconds('invalid')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('centralizes Yahoo retry defaults and status classification', () => {
    expect(isYahooRateLimitStatus(429)).toBe(true);
    expect(isYahooRateLimitStatus(999)).toBe(true);
    expect(isYahooTransientHttpStatus(503)).toBe(true);
    expect(defaultYahooRetryAfterSeconds(429)).toBe(900);
    expect(defaultYahooRetryAfterSeconds(503)).toBe(300);

    expect(retryAfterSecondsFromHeaders(new Headers({ 'Retry-After': '60' }), 429)).toBe(60);
    expect(retryAfterSecondsFromHeaders(new Headers(), 999)).toBe(900);
  });

  it('classifies Yahoo API statuses consistently', () => {
    expect(classifyYahooApiFailure(new Response(null, { status: 401 }))).toMatchObject({
      kind: 'auth_error',
      status: 401,
      retryable: false,
    });
    expect(classifyYahooApiFailure({ status: 999, headers: new Headers() })).toMatchObject({
      kind: 'rate_limited',
      status: 429,
      retryable: true,
      retryAfter: 900,
    });
    expect(classifyYahooApiFailure(new Response(null, {
      status: 503,
      headers: { 'Retry-After': '30' },
    }))).toMatchObject({
      kind: 'transient',
      status: 503,
      retryable: true,
      retryAfter: 30,
    });
    expect(classifyYahooApiFailure(new Response(null, { status: 418 }))).toMatchObject({
      kind: 'unexpected',
      status: 502,
      retryable: false,
    });
  });
});
