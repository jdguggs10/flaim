import { describe, expect, it } from 'vitest';
import { toExecuteErrorResponse } from '../handlers/utils';

describe('shared handler utilities', () => {
  it('preserves YAHOO_AUTH_UNAVAILABLE when converting thrown errors to MCP responses', () => {
    expect(toExecuteErrorResponse(new Error('YAHOO_AUTH_UNAVAILABLE: Try again later'))).toEqual({
      success: false,
      error: 'YAHOO_AUTH_UNAVAILABLE: Try again later',
      code: 'YAHOO_AUTH_UNAVAILABLE',
    });
  });
});
