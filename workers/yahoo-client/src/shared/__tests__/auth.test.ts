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

  it('returns null when Yahoo team key resolution receives a 404', async () => {
    mockAuthWorkerFetch.mockResolvedValue(new Response(null, { status: 404 }));

    await expect(resolveUserTeamKey(env, '461.l.12345', 'Bearer token')).resolves.toBeNull();
  });
});
