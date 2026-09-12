import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * GET /api/espn/history
 * Caller-owned status for a durable ESPN history refresh.
 */
export async function GET() {
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

    const workerRes = await fetch(`${authWorkerUrl.replace(/\/+$/, '')}/history/espn`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${bearer}` },
      cache: 'no-store',
    });
    const data = await workerRes.json().catch(() => ({ error: 'Unknown error' }));

    return NextResponse.json(data, {
      status: workerRes.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('ESPN history status route error:', error);
    return NextResponse.json({ error: 'Failed to get ESPN history status' }, { status: 500 });
  }
}
