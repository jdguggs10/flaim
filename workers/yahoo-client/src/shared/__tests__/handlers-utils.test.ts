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
