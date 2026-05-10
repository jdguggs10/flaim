import { describe, expect, it } from 'vitest';
import { YahooAuthWorkerErrorCode } from '@flaim/worker-shared';
import {
  getYahooConnectErrorMessage,
  getYahooTransientAuthMessage,
  isYahooReconnectRequired,
  isYahooTransientAuthResponse,
  parseYahooDiscoverErrorResponse,
} from '../yahoo-auth-errors';

describe('Yahoo auth error helpers', () => {
  it('uses the shared connect-message copy for transient notices', () => {
    expect(getYahooTransientAuthMessage({ error: 'refresh_temporarily_unavailable' }))
      .toBe(getYahooConnectErrorMessage('refresh_temporarily_unavailable', null));

    expect(getYahooTransientAuthMessage({ error: 'token_exchange_unavailable' }))
      .toBe(getYahooConnectErrorMessage('token_exchange_unavailable', null));
  });

  it('routes retryable auth-worker failures to a notice instead of reconnect', () => {
    const response = { error: 'refresh_temporarily_unavailable', retryable: true };

    expect(isYahooTransientAuthResponse(response)).toBe(true);
    expect(isYahooReconnectRequired(503, response)).toBe(false);
  });

  it('routes temporary Yahoo API failures to a notice instead of reconnect', () => {
    const response = {
      error: YahooAuthWorkerErrorCode.YAHOO_API_TEMPORARILY_UNAVAILABLE,
      retryable: true,
    };

    expect(isYahooTransientAuthResponse(response)).toBe(true);
    expect(isYahooReconnectRequired(429, response)).toBe(false);
  });

  it('keeps definitive Yahoo auth failures on the reconnect path', () => {
    expect(isYahooReconnectRequired(401, { error: 'refresh_failed' })).toBe(true);
    expect(isYahooReconnectRequired(403, {})).toBe(true);
    expect(isYahooTransientAuthResponse({ error: 'refresh_failed' })).toBe(false);
    expect(isYahooTransientAuthResponse({ error: 'refresh_failed', retryable: true })).toBe(false);
  });

  it('uses the upstream description when a retryable response has no known transient code', () => {
    expect(getYahooTransientAuthMessage({
      error: 'server_timeout',
      error_description: 'Try the Yahoo refresh again shortly.',
    })).toBe('Try the Yahoo refresh again shortly.');
  });

  it('parses retryable worker error bodies defensively', () => {
    expect(parseYahooDiscoverErrorResponse({
      error: 'refresh_temporarily_unavailable',
      error_description: 'Try again later',
      retryable: true,
      retry_after: 300,
    })).toEqual({
      error: 'refresh_temporarily_unavailable',
      error_description: 'Try again later',
      retryable: true,
      retry_after: 300,
    });

    expect(parseYahooDiscoverErrorResponse({
      error: 'refresh_temporarily_unavailable',
      retryable: 1,
      retry_after: '300',
    })).toEqual({
      error: 'refresh_temporarily_unavailable',
      error_description: undefined,
      retryable: undefined,
      retry_after: undefined,
    });

    expect(parseYahooDiscoverErrorResponse(null)).toEqual({});
  });
});
