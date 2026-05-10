import { describe, expect, it } from 'vitest';
import { toExecuteErrorResponse } from '../handlers/utils';
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
      retryable: true,
      retryAfter: 900,
    }))).toEqual({
      success: false,
      error: 'YAHOO_RATE_LIMITED: Too many requests. Please wait.',
      code: 'YAHOO_RATE_LIMITED',
      status: 429,
      retryable: true,
      retry_after: 900,
    });
  });
});
