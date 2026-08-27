import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock('@clerk/nextjs/server', () => ({ auth: mocks.auth }));

import { POST } from '../../../app/api/espn/leagues/route';

const originalAuthWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_AUTH_WORKER_URL = 'https://auth.example';
  mocks.auth.mockResolvedValue({
    userId: 'user-1',
    getToken: vi.fn(async () => 'test-token'),
  });
});

afterEach(() => {
  if (originalAuthWorkerUrl === undefined) {
    delete process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
  } else {
    process.env.NEXT_PUBLIC_AUTH_WORKER_URL = originalAuthWorkerUrl;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/espn/leagues', () => {
  it('proxies more than 100 distinct league-season rows without an arbitrary cap', async () => {
    const leagues = Array.from({ length: 101 }, (_, index) => ({
      leagueId: `league-${index}`,
      sport: 'baseball',
      seasonYear: 2026 - index,
    }));
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ leagues }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const request = new Request('https://flaim.app/api/espn/leagues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leagues }),
    }) as NextRequest;
    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith('https://auth.example/leagues', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ leagues }),
    }));
  });
});
