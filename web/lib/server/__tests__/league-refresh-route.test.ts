import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: mocks.auth,
}));

import { POST } from '../../../app/api/leagues/refresh/route';

const ORIGINAL_AUTH_WORKER_URL = process.env.AUTH_WORKER_URL;
const ORIGINAL_NEXT_PUBLIC_AUTH_WORKER_URL = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;

function mockSignedInUser() {
  const getToken = vi.fn(async () => 'test-token');
  mocks.auth.mockResolvedValue({
    userId: 'user_123',
    getToken,
  });
  return { getToken };
}

function makeRequest(body?: unknown): NextRequest {
  return new Request('https://flaim.app/api/leagues/refresh', {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as NextRequest;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_AUTH_WORKER_URL = 'https://auth.example/';
  delete process.env.AUTH_WORKER_URL;
  mockSignedInUser();
});

afterEach(() => {
  vi.useRealTimers();
  if (ORIGINAL_AUTH_WORKER_URL === undefined) {
    delete process.env.AUTH_WORKER_URL;
  } else {
    process.env.AUTH_WORKER_URL = ORIGINAL_AUTH_WORKER_URL;
  }
  if (ORIGINAL_NEXT_PUBLIC_AUTH_WORKER_URL === undefined) {
    delete process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
  } else {
    process.env.NEXT_PUBLIC_AUTH_WORKER_URL = ORIGINAL_NEXT_PUBLIC_AUTH_WORKER_URL;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/leagues/refresh', () => {
  it('rejects unauthenticated requests without calling the auth worker', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mocks.auth.mockResolvedValue({
      userId: null,
      getToken: vi.fn(),
    });

    const response = await POST(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Authentication required' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proxies the refresh request to auth-worker and preserves Retry-After', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        success: true,
        requestedPlatforms: ['espn'],
        results: {
          espn: { platform: 'espn', status: 'success', httpStatus: 200 },
        },
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '12',
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(makeRequest({ platforms: ['espn'] }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('Retry-After')).toBe('12');
    expect(body).toMatchObject({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://auth.example/leagues/refresh');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.body).toBe(JSON.stringify({ platforms: ['espn'] }));
  });

  it('times out a hanging auth-worker refresh request', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const responsePromise = POST(makeRequest({ platforms: ['espn'] }));
    await vi.advanceTimersByTimeAsync(15_000);
    const response = await responsePromise;
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(body).toEqual({
      error: 'refresh_timeout',
      error_description: 'League refresh timed out after 15 seconds',
    });
  });
});
