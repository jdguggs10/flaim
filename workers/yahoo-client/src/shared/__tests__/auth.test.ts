import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { authWorkerFetch } from '@flaim/worker-shared';
import type { Env } from '../../types';
import { getYahooCredentials, resolveUserTeamKey } from '../auth';

vi.mock('@flaim/worker-shared', () => ({
  authWorkerFetch: vi.fn(),
}));

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

  it('classifies retryable auth-worker refresh failures as temporarily unavailable', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'refresh_temporarily_unavailable',
          error_description: 'Yahoo token refresh is temporarily unavailable',
          retryable: true,
        }),
        { status: 503 }
      )
    );

    await expect(getYahooCredentials(env, 'Bearer token')).rejects.toThrow(
      'YAHOO_AUTH_UNAVAILABLE: refresh_temporarily_unavailable: Yahoo token refresh is temporarily unavailable'
    );
  });

  it('classifies transient Yahoo auth failures while resolving team keys', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'refresh_temporarily_unavailable',
          error_description: 'Try again later',
          retryable: true,
        }),
        { status: 503 }
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
});
