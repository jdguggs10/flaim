import { describe, expect, it } from 'vitest';
import { handleYahooError } from '../yahoo-api';

describe('Yahoo API errors', () => {
  it('treats Yahoo HTTP 999 as rate limiting with default retry metadata', async () => {
    const response = {
      status: 999,
      headers: new Headers(),
      text: async () => '',
    } as unknown as Response;

    await expect(handleYahooError(response)).rejects.toThrow(
      expect.objectContaining({
        code: 'YAHOO_RATE_LIMITED',
        status: 429,
        retryable: true,
        retryAfter: 900,
      })
    );
  });

  it('preserves Retry-After for Yahoo rate-limit responses', async () => {
    const response = new Response(null, {
      status: 429,
      headers: { 'Retry-After': '120' },
    });

    await expect(handleYahooError(response)).rejects.toThrow(
      expect.objectContaining({
        code: 'YAHOO_RATE_LIMITED',
        status: 429,
        retryable: true,
        retryAfter: 120,
      })
    );
  });

  it('classifies upstream 5xx as a transient Yahoo error', async () => {
    const response = new Response(null, {
      status: 503,
      headers: { 'Retry-After': '60' },
    });

    await expect(handleYahooError(response)).rejects.toThrow(
      expect.objectContaining({
        code: 'YAHOO_TRANSIENT_ERROR',
        status: 503,
        retryable: true,
        retryAfter: 60,
      })
    );
  });

  it('classifies upstream 400 as a Yahoo bad-request error', async () => {
    const response = new Response('{"error":"invalid"}', {
      status: 400,
    });

    await expect(handleYahooError(response)).rejects.toThrow(
      expect.objectContaining({
        code: 'YAHOO_BAD_REQUEST',
        status: 400,
        retryable: false,
      })
    );
  });
});
