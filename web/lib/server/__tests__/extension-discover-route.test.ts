import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

import { POST } from '../../../app/api/extension/discover/route';

const originalAuthWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;

function request(): NextRequest {
  return new Request('https://flaim.app/api/extension/discover', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token' },
  }) as NextRequest;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_AUTH_WORKER_URL = 'https://auth.example/';
});

afterEach(() => {
  if (originalAuthWorkerUrl === undefined) delete process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
  else process.env.NEXT_PUBLIC_AUTH_WORKER_URL = originalAuthWorkerUrl;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/extension/discover', () => {
  it('preserves the additive ESPN history status for the popup', async () => {
    const history = {
      jobId: 'job_123',
      state: 'queued',
      counts: { planned: 0, completed: 0, skipped: 0, failed: 0 },
      retryable: false,
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      discovered: [],
      currentSeason: { found: 1, added: 1, alreadySaved: 0 },
      pastSeasons: { found: 0, added: 0, alreadySaved: 0 },
      history,
    }), { headers: { 'content-type': 'application/json' } })));

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      discovered: [],
      currentSeason: { found: 1, added: 1, alreadySaved: 0 },
      pastSeasons: { found: 0, added: 0, alreadySaved: 0 },
      history,
    });
  });
});
