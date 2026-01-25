import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * POST /api/connect/yahoo/leagues/[id]/default
 * Set a Yahoo league as the user's default.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { id: leagueId } = await params;
    if (!leagueId) {
      return NextResponse.json({ error: 'League ID required' }, { status: 400 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'AUTH_WORKER_URL not configured' }, { status: 500 });
    }

    const bearer = (await getToken?.()) || undefined;
    const workerRes = await fetch(`${authWorkerUrl}/leagues/yahoo/${leagueId}/default`, {
      method: 'POST',
      headers: {
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
    });

    const data = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as Record<string, unknown>;
    return NextResponse.json(data, { status: workerRes.status });
  } catch (error) {
    console.error('Yahoo set-default route error:', error);
    return NextResponse.json({ error: 'Failed to set default league' }, { status: 500 });
  }
}
