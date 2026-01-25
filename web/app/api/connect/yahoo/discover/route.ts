import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * POST /api/connect/yahoo/discover
 * Trigger Yahoo league discovery.
 */
export async function POST() {
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
    const workerRes = await fetch(`${authWorkerUrl}/connect/yahoo/discover`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
    });

    const data = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as Record<string, unknown>;
    return NextResponse.json(data, { status: workerRes.status });
  } catch (error) {
    console.error('Yahoo discover route error:', error);
    return NextResponse.json({ error: 'Failed to discover Yahoo leagues' }, { status: 500 });
  }
}
