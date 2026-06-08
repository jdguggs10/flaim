import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: mocks.auth,
}));

import { GET } from '../../../app/api/auth/espn/credentials/route';

const ORIGINAL_AUTH_WORKER_URL = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;

function mockSignedInUser() {
  const getToken = vi.fn(async () => 'test-clerk-token');
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

function credentialsRequest(search = '') {
  return new NextRequest(`https://flaim.app/api/auth/espn/credentials${search}`);
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_AUTH_WORKER_URL = 'https://auth.example';
  mockSignedInUser();
});

afterEach(() => {
  if (ORIGINAL_AUTH_WORKER_URL === undefined) {
    delete process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
  } else {
    process.env.NEXT_PUBLIC_AUTH_WORKER_URL = ORIGINAL_AUTH_WORKER_URL;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/auth/espn/credentials?forEdit=true', () => {
  it('sanitizes raw ESPN credentials from upstream replace metadata', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      hasCredentials: true,
      platform: 'espn',
      email: 'user@example.com',
      lastUpdated: '2026-06-08T16:30:00.000Z',
      replaceOnly: true,
      maskedSwid: '{********-****-****-****-************}',
      maskedS2: '************',
      swid: '{11111111-2222-3333-4444-555555555555}',
      s2: 'raw-espn-s2-secret-value-that-should-not-return-to-browser',
    }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await GET(credentialsRequest('?forEdit=true'));
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual({
      hasCredentials: true,
      platform: 'espn',
      email: 'user@example.com',
      lastUpdated: '2026-06-08T16:30:00.000Z',
      replaceOnly: true,
      maskedSwid: '{********-****-****-****-************}',
      maskedS2: '************',
    });
    expect(body).not.toHaveProperty('swid');
    expect(body).not.toHaveProperty('s2');
    expect(JSON.stringify(body)).not.toContain('raw-espn-s2-secret-value');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.example/credentials/espn?forEdit=true',
      {
        headers: {
          Authorization: 'Bearer test-clerk-token',
        },
      },
    );
  });

  it('returns replace-only empty state for missing credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      error: 'Credentials not found',
    }, 404)));

    const response = await GET(credentialsRequest('?forEdit=true'));
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toEqual({
      hasCredentials: false,
      platform: 'espn',
      replaceOnly: true,
    });
    expect(body).not.toHaveProperty('swid');
    expect(body).not.toHaveProperty('s2');
  });
});
