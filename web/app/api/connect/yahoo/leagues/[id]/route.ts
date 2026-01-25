import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * DELETE /api/connect/yahoo/leagues/[id]
 * Delete a specific Yahoo league.
 */
export async function DELETE(
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
    const workerRes = await fetch(`${authWorkerUrl}/leagues/yahoo/${leagueId}`, {
      method: 'DELETE',
      headers: {
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
    });

    const data = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as Record<string, unknown>;
    return NextResponse.json(data, { status: workerRes.status });
  } catch (error) {
    console.error('Yahoo delete league route error:', error);
    return NextResponse.json({ error: 'Failed to delete league' }, { status: 500 });
  }
}
