import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: mocks.auth,
}));

import { POST } from '../../../app/api/signals/route';

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

function makeRequest(body: unknown): NextRequest {
  return new Request('https://flaim.app/api/signals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as NextRequest;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_AUTH_WORKER_URL = 'https://auth.example/';
  delete process.env.AUTH_WORKER_URL;
  mockSignedInUser();
});

afterEach(() => {
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

describe('POST /api/signals', () => {
  it('rejects unauthenticated requests without calling the auth worker', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mocks.auth.mockResolvedValue({
      userId: null,
      getToken: vi.fn(),
    });

    const response = await POST(makeRequest({ event: 'espn_connect_ui_view' }));

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards the signal body to auth-worker with the Clerk bearer', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const body = { event: 'espn_connect_ui_view', device: 'mobile', connected: false };
    const response = await POST(makeRequest(body));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://auth.example/signals/web');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-token' });
    expect(init.body).toBe(JSON.stringify(body));
  });

  it('prefers the direct AUTH_WORKER_URL over the public gateway when both are set', async () => {
    process.env.AUTH_WORKER_URL = 'https://direct.workers.dev';
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await POST(makeRequest({ event: 'espn_connect_ui_view' }));

    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe('https://direct.workers.dev/signals/web');
  });

  it('passes through auth-worker rejections', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'unknown_event' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST(makeRequest({ event: 'nope' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'unknown_event' });
  });
});
