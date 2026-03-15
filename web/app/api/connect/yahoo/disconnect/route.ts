import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * DELETE /api/connect/yahoo/disconnect
 * Disconnect Yahoo account and remove all Yahoo leagues.
 */
export async function DELETE() {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'AUTH_WORKER_URL not configured' }, { status: 500 });
    }

    const bearer = await getToken?.();
    if (!bearer) {
      return NextResponse.json({ error: 'Authentication token unavailable' }, { status: 401 });
    }
    const workerRes = await fetch(`${authWorkerUrl}/connect/yahoo/disconnect`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${bearer}`,
      },
    });

    const data = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as Record<string, unknown>;
    return NextResponse.json(data, { status: workerRes.status });
  } catch (error) {
    console.error('Yahoo disconnect route error:', error);
    return NextResponse.json({ error: 'Failed to disconnect Yahoo' }, { status: 500 });
  }
}
