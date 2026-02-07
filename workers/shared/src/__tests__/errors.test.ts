import { describe, expect, it } from 'vitest';
import { ErrorCode, extractErrorCode } from '../errors';

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
    expect(ErrorCode.AUTH_FAILED).toBe('AUTH_FAILED');
    expect(ErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR');
    expect(ErrorCode.ESPN_NOT_FOUND).toBe('ESPN_NOT_FOUND');
    expect(ErrorCode.YAHOO_API_ERROR).toBe('YAHOO_API_ERROR');
  });
});
