import { describe, expect, it } from 'vitest';
import { YahooAuthWorkerErrorCode } from '@flaim/worker-shared';
import {
  formatYahooRetryAfter,
  getYahooConnectErrorMessage,
  getYahooTransientAuthMessage,
  isYahooReconnectRequired,
  isYahooTransientAuthResponse,
  parseYahooDiscoverErrorResponse,
  parseYahooRetryAfterSeconds,
} from '../yahoo-auth-errors';

describe('Yahoo auth error helpers', () => {
  it('formats retry-after values for user-facing copy', () => {
    expect(formatYahooRetryAfter(30)).toBe('30 seconds');
    expect(formatYahooRetryAfter(60)).toBe('about 1 minute');
    expect(formatYahooRetryAfter(61)).toBe('about 1 minute');
    expect(formatYahooRetryAfter(0)).toBeNull();
    expect(formatYahooRetryAfter(-1)).toBeNull();
    expect(formatYahooRetryAfter(undefined)).toBeNull();
    expect(formatYahooRetryAfter(Number.NaN)).toBeNull();
  });

  it('parses retry-after query params defensively', () => {
    expect(parseYahooRetryAfterSeconds('45')).toBe(45);
    expect(parseYahooRetryAfterSeconds(' 45 ')).toBe(45);
    expect(parseYahooRetryAfterSeconds(null)).toBeUndefined();
    expect(parseYahooRetryAfterSeconds('')).toBeUndefined();
    expect(parseYahooRetryAfterSeconds('0')).toBeUndefined();
    expect(parseYahooRetryAfterSeconds('-1')).toBeUndefined();
    expect(parseYahooRetryAfterSeconds('1e10')).toBeUndefined();
    expect(parseYahooRetryAfterSeconds('45 seconds')).toBeUndefined();
    expect(parseYahooRetryAfterSeconds('Infinity')).toBeUndefined();
  });

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
      error_description: 'Try Yahoo again shortly.',
    })).toBe('Try Yahoo again shortly.');
  });

  it('adds retry timing to retryable transient messages', () => {
    expect(getYahooTransientAuthMessage({
      error: 'refresh_temporarily_unavailable',
      retry_after: 300,
    })).toBe('Yahoo is temporarily unavailable. Try again in about 5 minutes.');

    expect(getYahooTransientAuthMessage({
      error: 'server_timeout',
      error_description: 'Try syncing Yahoo leagues again shortly.',
      retry_after: 45,
    })).toBe('Try syncing Yahoo leagues again shortly. Try again in 45 seconds.');
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
