import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

const SIGNAL_TIMEOUT_MS = 5_000;

/**
 * POST /api/signals
 * Forwards web-surface setup signals to auth-worker so they land in Workers
 * Logs with the other setup signals. Fire-and-forget from the client's
 * perspective; failures here should never affect the UI.
 */
export async function POST(request: NextRequest) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // Server-only route: prefer the direct .workers.dev URL over the
    // browser-facing NEXT_PUBLIC_* gateway (see docs/ARCHITECTURE.md).
    const authWorkerUrl = process.env.AUTH_WORKER_URL || process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const bearer = await getToken();
    if (!bearer) {
      return NextResponse.json({ error: 'Authentication token unavailable' }, { status: 401 });
    }

    const rawBody = await request.text();
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), SIGNAL_TIMEOUT_MS);
    const workerRes = await fetch(`${authWorkerUrl.replace(/\/+$/, '')}/signals/web`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearer}`,
      },
      signal: controller.signal,
      body: rawBody,
    });
    if (timeoutId) clearTimeout(timeoutId);

    const data = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as Record<string, unknown>;
    return NextResponse.json(data, { status: workerRes.status });
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json({ error: 'signal_timeout' }, { status: 504 });
    }
    console.error('Signal route error:', error);
    return NextResponse.json({ error: 'Failed to record signal' }, { status: 500 });
  }
}
