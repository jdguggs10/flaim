import { describe, expect, it } from 'vitest';
import { INTERNAL_SERVICE_TOKEN_HEADER, hasValidInternalServiceToken, validateInternalService } from '../internal-service';

describe('internal service validation', () => {
  it('returns 500 when INTERNAL_SERVICE_TOKEN is missing', async () => {
    const request = new Request('https://example.com/internal');

    const result = await validateInternalService(request, {}, 'espn-client');

    expect(result).toEqual({
      authorized: false,
      error: {
        success: false,
        error: 'INTERNAL_SERVICE_TOKEN is not configured for espn-client',
        code: 'INTERNAL_AUTH_NOT_CONFIGURED',
      },
      status: 500,
    });
  });

  it('returns 403 for missing or invalid token', async () => {
    const missingHeaderRequest = new Request('https://example.com/internal');
    const invalidHeaderRequest = new Request('https://example.com/internal', {
      headers: { [INTERNAL_SERVICE_TOKEN_HEADER]: 'wrong-token' },
    });

    const missingResult = await validateInternalService(missingHeaderRequest, { INTERNAL_SERVICE_TOKEN: 'expected-token' }, 'yahoo-client');
    const invalidResult = await validateInternalService(invalidHeaderRequest, { INTERNAL_SERVICE_TOKEN: 'expected-token' }, 'yahoo-client');

    expect(missingResult).toEqual({
      authorized: false,
      error: {
        success: false,
        error: `Missing or invalid ${INTERNAL_SERVICE_TOKEN_HEADER}`,
        code: 'INTERNAL_AUTH_REQUIRED',
      },
      status: 403,
    });

    expect(invalidResult).toEqual({
      authorized: false,
      error: {
        success: false,
        error: `Missing or invalid ${INTERNAL_SERVICE_TOKEN_HEADER}`,
        code: 'INTERNAL_AUTH_REQUIRED',
      },
      status: 403,
    });
  });

  it('authorizes valid token', async () => {
    const request = new Request('https://example.com/internal', {
      headers: { [INTERNAL_SERVICE_TOKEN_HEADER]: 'expected-token' },
    });

    const validCheck = await hasValidInternalServiceToken(request, { INTERNAL_SERVICE_TOKEN: 'expected-token' });
    const result = await validateInternalService(request, { INTERNAL_SERVICE_TOKEN: 'expected-token' }, 'sleeper-client');

    expect(validCheck).toBe(true);
    expect(result).toEqual({ authorized: true });
  });
});
