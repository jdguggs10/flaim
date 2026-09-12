import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }));

import { GET } from '../../../app/api/espn/history/route';

const originalAuthWorkerUrl = process.env.AUTH_WORKER_URL;
const originalPublicAuthWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;

beforeEach(() => {
  process.env.AUTH_WORKER_URL = 'https://auth.example/';
  delete process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
  mocks.auth.mockResolvedValue({ userId: 'user_123', getToken: vi.fn(async () => 'test-token') });
});

afterEach(() => {
  if (originalAuthWorkerUrl === undefined) delete process.env.AUTH_WORKER_URL;
  else process.env.AUTH_WORKER_URL = originalAuthWorkerUrl;
  if (originalPublicAuthWorkerUrl === undefined) delete process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
  else process.env.NEXT_PUBLIC_AUTH_WORKER_URL = originalPublicAuthWorkerUrl;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/espn/history', () => {
  it('proxies only the caller-owned history status without caching it', async () => {
    const history = {
      jobId: 'job_123',
      state: 'running',
      counts: { planned: 200, completed: 15, skipped: 2, failed: 0 },
      retryable: false,
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ history }), {
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ history });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.example/history/espn',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer test-token' },
        cache: 'no-store',
      }),
    );
  });

  it('rejects an unauthenticated request before contacting auth-worker', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mocks.auth.mockResolvedValue({ userId: null, getToken: vi.fn() });

    const response = await GET();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Authentication required' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
