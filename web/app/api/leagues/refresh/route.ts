import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

const LEAGUE_REFRESH_TIMEOUT_MS = 15_000;

/**
 * POST /api/leagues/refresh
 * Broad league refresh proxy for the /leagues UI.
 */
export async function POST(request: NextRequest) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL || process.env.AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const bearer = await getToken();
    if (!bearer) {
      return NextResponse.json({ error: 'Authentication token unavailable' }, { status: 401 });
    }

    const rawBody = await request.text();
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), LEAGUE_REFRESH_TIMEOUT_MS);
    const workerRes = await fetch(`${authWorkerUrl.replace(/\/+$/, '')}/leagues/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearer}`,
      },
      signal: controller.signal,
      ...(rawBody.trim() ? { body: rawBody } : {}),
    });
    if (timeoutId) clearTimeout(timeoutId);

    const data = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as Record<string, unknown>;
    const headers = new Headers();
    const retryAfter = workerRes.headers.get('Retry-After');
    if (retryAfter) {
      headers.set('Retry-After', retryAfter);
    }

    return NextResponse.json(data, { status: workerRes.status, headers });
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({
        error: 'refresh_timeout',
        error_description: 'League refresh timed out after 15 seconds',
      }, { status: 504 });
    }
    console.error('League refresh route error:', error);
    return NextResponse.json({ error: 'Failed to refresh leagues' }, { status: 500 });
  }
}
