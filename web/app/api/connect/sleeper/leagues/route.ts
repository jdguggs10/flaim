import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * GET /api/connect/sleeper/leagues
 * List user's Sleeper leagues.
 */
export async function GET() {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'AUTH_WORKER_URL not configured' }, { status: 500 });
    }

    const bearer = (await getToken?.()) || undefined;
    const workerRes = await fetch(`${authWorkerUrl}/leagues/sleeper`, {
      headers: {
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
    });

    if (workerRes.status === 404) {
      return NextResponse.json({ leagues: [] });
    }

    const data = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as Record<string, unknown>;
    return NextResponse.json(data, { status: workerRes.status });
  } catch (error) {
    console.error('Sleeper leagues route error:', error);
    return NextResponse.json({ error: 'Failed to fetch Sleeper leagues' }, { status: 500 });
  }
}
