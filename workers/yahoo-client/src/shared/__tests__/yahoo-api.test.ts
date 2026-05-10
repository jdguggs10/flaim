import { describe, expect, it } from 'vitest';
import { handleYahooError } from '../yahoo-api';

describe('Yahoo API errors', () => {
  it('treats Yahoo HTTP 999 as rate limiting with default retry metadata', () => {
    const response = {
      status: 999,
      headers: new Headers(),
    } as Response;

    expect(() => handleYahooError(response)).toThrow(
      expect.objectContaining({
        code: 'YAHOO_RATE_LIMITED',
        status: 429,
        retryable: true,
        retryAfter: 900,
      })
    );
  });

  it('preserves Retry-After for Yahoo rate-limit responses', () => {
    const response = new Response(null, {
      status: 429,
      headers: { 'Retry-After': '120' },
    });

    expect(() => handleYahooError(response)).toThrow(
      expect.objectContaining({
        code: 'YAHOO_RATE_LIMITED',
        status: 429,
        retryable: true,
        retryAfter: 120,
      })
    );
  });

  it('classifies upstream 5xx as a transient Yahoo error', () => {
    const response = new Response(null, {
      status: 503,
      headers: { 'Retry-After': '60' },
    });

    expect(() => handleYahooError(response)).toThrow(
      expect.objectContaining({
        code: 'YAHOO_TRANSIENT_ERROR',
        status: 503,
        retryable: true,
        retryAfter: 60,
      })
    );
  });
});
