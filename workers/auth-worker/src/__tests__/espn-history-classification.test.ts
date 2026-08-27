import { describe, expect, it } from 'vitest';
import { EspnApiError, EspnAuthenticationFailed, EspnLeagueNotFound } from '../espn-types';
import { classifyEspnHistoryUpstreamError } from '../espn-history';

describe('classifyEspnHistoryUpstreamError', () => {
  it.each([new EspnAuthenticationFailed(), new EspnApiError('no', 401), new EspnApiError('no', 403)])('classifies auth failures', (error) => expect(classifyEspnHistoryUpstreamError(error)).toBe('auth'));
  it.each([new EspnLeagueNotFound(), new EspnApiError('missing', 404), new EspnApiError('bad', 400)])('classifies permanent failures', (error) => expect(classifyEspnHistoryUpstreamError(error)).toBe('permanent'));
  it.each([new EspnApiError('request timeout', 408), new EspnApiError('too early', 425), new EspnApiError('rate', 429), new EspnApiError('server', 500), new EspnApiError('unknown'), new Error('network'), new Error('Unable to read ESPN credentials'), new DOMException('timeout', 'TimeoutError')])('classifies retryable failures', (error) => expect(classifyEspnHistoryUpstreamError(error)).toBe('retryable'));
});
