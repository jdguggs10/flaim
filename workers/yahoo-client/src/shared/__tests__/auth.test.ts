import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { authWorkerFetch } from '@flaim/worker-shared';
import type { Env } from '../../types';
import { getYahooCredentials, resolveUserTeamKey } from '../auth';
import type { YahooClientError } from '../errors';

vi.mock('@flaim/worker-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@flaim/worker-shared')>();
  return {
    ...actual,
    authWorkerFetch: vi.fn(),
  };
});

const mockAuthWorkerFetch = authWorkerFetch as MockedFunction<typeof authWorkerFetch>;

describe('getYahooCredentials', () => {
  const env = {} as Env;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes auth-worker error descriptions in thrown errors', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'refresh_failed',
          error_description: 'Refresh token expired',
        }),
        { status: 401 }
      )
    );

    await expect(getYahooCredentials(env, 'Bearer token')).rejects.toThrow(
      'YAHOO_AUTH_ERROR: refresh_failed: Refresh token expired'
    );
  });

  it('classifies auth-worker failures while resolving Yahoo team keys', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'refresh_failed',
          error_description: 'Refresh token expired',
        }),
        { status: 401 }
      )
    );

    await expect(resolveUserTeamKey(env, '461.l.12345', 'Bearer token')).rejects.toThrow(
      'YAHOO_AUTH_ERROR: refresh_failed: Refresh token expired'
    );
  });

  it('classifies 503 auth-worker failures as temporarily unavailable', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'server_timeout',
          error_description: 'Yahoo token refresh is temporarily unavailable',
        }),
        { status: 503 }
      )
    );

    await expect(getYahooCredentials(env, 'Bearer token')).rejects.toThrow(
      'YAHOO_AUTH_UNAVAILABLE: server_timeout: Yahoo token refresh is temporarily unavailable'
    );
  });

  it('classifies retryable auth-worker failures as temporarily unavailable', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'upstream_busy',
          error_description: 'Try again later',
          retryable: true,
        }),
        { status: 502 }
      )
    );

    await expect(getYahooCredentials(env, 'Bearer token')).rejects.toThrow(
      'YAHOO_AUTH_UNAVAILABLE: upstream_busy: Try again later'
    );
  });

  it('preserves auth-worker retry metadata on transient failures', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'refresh_temporarily_unavailable',
          error_description: 'Try again later',
          retryable: true,
          retry_after: 120,
        }),
        { status: 503, headers: { 'Retry-After': '120' } }
      )
    );

    await expect(getYahooCredentials(env, 'Bearer token')).rejects.toMatchObject({
      code: 'YAHOO_AUTH_UNAVAILABLE',
      status: 503,
      retryable: true,
      retryAfter: 120,
    } satisfies Partial<YahooClientError>);
  });

  it('prefers Retry-After header over body retry_after on transient failures', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'refresh_temporarily_unavailable',
          error_description: 'Try again later',
          retryable: true,
          retry_after: 120,
        }),
        { status: 503, headers: { 'Retry-After': '30' } }
      )
    );

    await expect(getYahooCredentials(env, 'Bearer token')).rejects.toMatchObject({
      code: 'YAHOO_AUTH_UNAVAILABLE',
      status: 503,
      retryable: true,
      retryAfter: 30,
    } satisfies Partial<YahooClientError>);
  });

  it('classifies known transient Yahoo auth codes while resolving team keys', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'refresh_temporarily_unavailable',
          error_description: 'Try again later',
        }),
        { status: 400 }
      )
    );

    await expect(resolveUserTeamKey(env, '461.l.12345', 'Bearer token')).rejects.toThrow(
      'YAHOO_AUTH_UNAVAILABLE: refresh_temporarily_unavailable: Try again later'
    );
  });

  it('returns null when Yahoo team key resolution receives a 404', async () => {
    mockAuthWorkerFetch.mockResolvedValue(new Response(null, { status: 404 }));

    await expect(resolveUserTeamKey(env, '461.l.12345', 'Bearer token')).resolves.toBeNull();
  });

  it('returns the persisted Yahoo team key for the requested league', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          leagues: [
            { leagueKey: '461.l.99999', teamKey: '461.l.99999.t.9' },
            { leagueKey: '461.l.12345', teamKey: '461.l.12345.t.4' },
          ],
        }),
        { status: 200 }
      )
    );

    await expect(resolveUserTeamKey(env, '461.l.12345', 'Bearer token')).resolves.toBe(
      '461.l.12345.t.4'
    );
  });
});
