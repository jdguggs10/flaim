import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { authWorkerFetch } from '@flaim/worker-shared';
import type { Env } from '../../types';
import { getCredentials } from '../auth';

vi.mock('@flaim/worker-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@flaim/worker-shared')>();
  return {
    ...actual,
    authWorkerFetch: vi.fn(),
  };
});

const mockAuthWorkerFetch = authWorkerFetch as MockedFunction<typeof authWorkerFetch>;

describe('getCredentials', () => {
  const env = {} as Env;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when credentials are not found', async () => {
    mockAuthWorkerFetch.mockResolvedValue(new Response(null, { status: 404 }));

    await expect(getCredentials(env, 'Bearer token')).resolves.toBeNull();
  });

  it('throws AUTH_RATE_LIMITED when the auth-worker responds 429', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 })
    );

    await expect(getCredentials(env, 'Bearer token')).rejects.toThrow(
      'AUTH_RATE_LIMITED: Too many credential requests. Please wait and try again.'
    );
  });

  it('includes auth-worker error details in other failures', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(JSON.stringify({ error: 'boom' }), { status: 500 })
    );

    await expect(getCredentials(env, 'Bearer token')).rejects.toThrow('Auth-worker error: boom');
  });

  it('returns credentials on success', async () => {
    mockAuthWorkerFetch.mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, credentials: { swid: '{abc}', s2: 's2value' } }),
        { status: 200 }
      )
    );

    await expect(getCredentials(env, 'Bearer token')).resolves.toEqual({
      swid: '{abc}',
      s2: 's2value',
    });
  });
});
