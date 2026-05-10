import { describe, expect, it, vi } from 'vitest';
import {
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
      expect(parseRetryAfterSeconds('Sun, 10 May 2026 14:55:00 GMT')).toBeUndefined();
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
});
