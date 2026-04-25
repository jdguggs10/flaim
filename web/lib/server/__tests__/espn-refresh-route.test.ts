import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeSeasonCountValue,
  normalizeSeasonCounts,
  normalizeWorkerErrorStatus,
} from '../espn-refresh';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: mocks.auth,
}));

import { POST } from '../../../app/api/espn/refresh/route';

const ORIGINAL_AUTH_WORKER_URL = process.env.AUTH_WORKER_URL;

function mockSignedInUser() {
  const getToken = vi.fn(async () => 'test-token');
  mocks.auth.mockResolvedValue({
    userId: 'user_123',
    getToken,
  });
  return { getToken };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  process.env.AUTH_WORKER_URL = 'https://auth.example/';
  mockSignedInUser();
});

afterEach(() => {
  process.env.AUTH_WORKER_URL = ORIGINAL_AUTH_WORKER_URL;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('ESPN refresh normalization helpers', () => {
  it('normalizes missing season counts to zero', () => {
    expect(normalizeSeasonCounts(undefined)).toEqual({
      found: 0,
      added: 0,
      alreadySaved: 0,
    });
    expect(normalizeSeasonCounts({ found: 3 })).toEqual({
      found: 3,
      added: 0,
      alreadySaved: 0,
    });
  });

  it('rejects present-but-invalid season count fields', () => {
    expect(normalizeSeasonCounts({ found: '3', added: 1, alreadySaved: 0 })).toBeNull();
    expect(normalizeSeasonCounts({ found: Number.NaN, added: 1, alreadySaved: 0 })).toBeNull();
    expect(normalizeSeasonCounts({ found: -1, added: 1, alreadySaved: 0 })).toBeNull();
  });

  it('rejects invalid individual season count values', () => {
    expect(normalizeSeasonCountValue(Number.NaN)).toBeNull();
    expect(normalizeSeasonCountValue(-1)).toBeNull();
  });

  it('passes expected upstream statuses and maps other worker errors to bad gateway', () => {
    expect(normalizeWorkerErrorStatus(401)).toBe(401);
    expect(normalizeWorkerErrorStatus(403)).toBe(403);
    expect(normalizeWorkerErrorStatus(429)).toBe(429);
    expect(normalizeWorkerErrorStatus(422)).toBe(502);
    expect(normalizeWorkerErrorStatus(503)).toBe(502);
  });
});

describe('POST /api/espn/refresh', () => {
  it('rejects unauthenticated requests without calling the auth worker', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mocks.auth.mockResolvedValue({
      userId: null,
      getToken: vi.fn(),
    });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Authentication required' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails fast when AUTH_WORKER_URL is not configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    delete process.env.AUTH_WORKER_URL;

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'AUTH_WORKER_URL not configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects requests when Clerk cannot issue a bearer token', async () => {
    const fetchMock = vi.fn();
    const getToken = vi.fn(async () => null);
    vi.stubGlobal('fetch', fetchMock);
    mocks.auth.mockResolvedValue({
      userId: 'user_123',
      getToken,
    });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: 'Authentication token unavailable' });
    expect(getToken).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proxies to the auth worker and returns normalized counts', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      currentSeason: {
        found: 2,
        added: 1,
        alreadySaved: 1,
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      currentSeason: {
        found: 2,
        added: 1,
        alreadySaved: 1,
      },
      pastSeasons: {
        found: 0,
        added: 0,
        alreadySaved: 0,
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.example/extension/discover',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-token',
        },
      })
    );
  });

  it('passes through expected auth-worker credential errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      error: 'credentials_not_found',
      error_description: 'Reconnect ESPN credentials',
    }, 403)));

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: 'credentials_not_found',
      error_description: 'Reconnect ESPN credentials',
    });
  });

  it('normalizes auth-worker 5xx responses to bad gateway', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      error: 'upstream_unavailable',
      error_description: 'Auth worker unavailable',
    }, 503)));

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: 'upstream_unavailable',
      error_description: 'Auth worker unavailable',
    });
  });

  it('returns bad gateway when the auth worker returns a null body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(null)));

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: 'server_error',
      error_description: 'Unexpected response from ESPN refresh service',
    });
  });
});
