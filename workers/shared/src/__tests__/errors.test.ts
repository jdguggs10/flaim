import { describe, expect, it } from 'vitest';
import { ErrorCode, YahooAuthWorkerErrorCode, extractErrorCode } from '../errors';

describe('error utilities', () => {
  it('extractErrorCode parses CODE: message format', () => {
    expect(extractErrorCode(new Error('ESPN_NOT_FOUND: League not found'))).toBe('ESPN_NOT_FOUND');
  });

  it('extractErrorCode returns INTERNAL_ERROR for unprefixed messages', () => {
    expect(extractErrorCode(new Error('something went wrong'))).toBe('INTERNAL_ERROR');
  });

  it('extractErrorCode handles non-Error values', () => {
    expect(extractErrorCode('string error')).toBe('INTERNAL_ERROR');
  });

  it('ErrorCode enum contains all known codes', () => {
    expect(ErrorCode.NOT_SUPPORTED).toBe('NOT_SUPPORTED');
    expect(ErrorCode.MISSING_PARAM).toBe('MISSING_PARAM');
    expect(ErrorCode.AUTH_FAILED).toBe('AUTH_FAILED');
    expect(ErrorCode.INTERNAL_AUTH_NOT_CONFIGURED).toBe('INTERNAL_AUTH_NOT_CONFIGURED');
    expect(ErrorCode.INTERNAL_AUTH_REQUIRED).toBe('INTERNAL_AUTH_REQUIRED');
    expect(ErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
    expect(ErrorCode.ESPN_NOT_FOUND).toBe('ESPN_NOT_FOUND');
    expect(ErrorCode.YAHOO_AUTH_UNAVAILABLE).toBe('YAHOO_AUTH_UNAVAILABLE');
    expect(ErrorCode.YAHOO_API_ERROR).toBe('YAHOO_API_ERROR');
    expect(ErrorCode.SLEEPER_NOT_FOUND).toBe('SLEEPER_NOT_FOUND');
    expect(ErrorCode.SLEEPER_TIMEOUT).toBe('SLEEPER_TIMEOUT');
  });

  it('Yahoo auth-worker error codes include transient auth failures', () => {
    expect(YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE).toBe('refresh_temporarily_unavailable');
    expect(YahooAuthWorkerErrorCode.TOKEN_REFRESH_VALIDATION_UNAVAILABLE).toBe('token_refresh_validation_unavailable');
    expect(YahooAuthWorkerErrorCode.TOKEN_EXCHANGE_UNAVAILABLE).toBe('token_exchange_unavailable');
  });
});
