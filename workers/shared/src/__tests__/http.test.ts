import { describe, expect, it, vi } from 'vitest';
import {
  YAHOO_APP_REVIEW_OUTAGE_MESSAGE,
  classifyYahooApiFailure,
  defaultYahooRetryAfterSeconds,
  isYahooAppLevelDenialBody,
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
      expect(parseRetryAfterSeconds('120abc')).toBeUndefined();
      expect(parseRetryAfterSeconds('0')).toBeUndefined();
      expect(parseRetryAfterSeconds('Sun, 10 May 2026 15:05:00 GMT')).toBe(300);
      // Past dates use a short retry floor instead of falling back to a longer Yahoo default.
      expect(parseRetryAfterSeconds('Sun, 10 May 2026 14:55:00 GMT')).toBe(30);
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
    expect(classifyYahooApiFailure(new Response(null, { status: 400 }))).toMatchObject({
      kind: 'bad_request',
      status: 400,
      retryable: false,
    });
    expect(classifyYahooApiFailure(new Response(null, { status: 418 }))).toMatchObject({
      kind: 'unexpected',
      status: 502,
      retryable: false,
    });
  });

  it('tells an application-level Yahoo denial from a resource-level one', () => {
    expect(
      isYahooAppLevelDenialBody('{"error":{"description":"This application is not authorized to perform this action."}}')
    ).toBe(true);
    expect(
      isYahooAppLevelDenialBody('{"error":{"description":"You are not allowed to view this league."}}')
    ).toBe(false);
    expect(isYahooAppLevelDenialBody('')).toBe(false);
  });

  it('keeps the two outage messages telling one story', () => {
    // Both doors name Yahoo, say it is platform-wide and not the user's fault,
    // and say what still works. Only discovery adds the "connection is saved,
    // no reconnect" sentence, because only a new user needs to hear it.
    for (const message of Object.values(YAHOO_APP_REVIEW_OUTAGE_MESSAGE)) {
      expect(message).toContain('Yahoo is currently reviewing third-party app access');
      expect(message).toContain('all third-party apps, including this one');
      expect(message).toContain('ESPN and Sleeper leagues are unaffected');
    }
    expect(YAHOO_APP_REVIEW_OUTAGE_MESSAGE.discovery).toContain('nothing needs to be redone');
    expect(YAHOO_APP_REVIEW_OUTAGE_MESSAGE.data).not.toContain('redone');
    // The discovery message is classified by TEXT in the fantasy-mcp widget:
    // any of these substrings would flip it to "reconnect" or "try again".
    // The authoritative pin lives in fantasy-mcp against the real classifier;
    // this one just fails fast, next to the words, on the obvious slips.
    expect(YAHOO_APP_REVIEW_OUTAGE_MESSAGE.discovery.toLowerCase()).not.toMatch(
      /auth|credential|connect|expired|invalid.token|revoked|rate.?limit|too many|try again/
    );
    // No em dashes in public-facing copy.
    expect(YAHOO_APP_REVIEW_OUTAGE_MESSAGE.discovery).not.toContain('—');
  });
});
