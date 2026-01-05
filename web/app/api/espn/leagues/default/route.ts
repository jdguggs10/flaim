/**
 * ESPN Default League API Route
 * ---------------------------------------------------------------------------
 * Sets a league as the user's default for the chat app.
 * Only one league can be default per user.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export async function POST(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body: { leagueId?: string; sport?: string; seasonYear?: number } = await request.json();

    if (!body.leagueId || !body.sport) {
      return NextResponse.json({
        error: 'leagueId and sport are required in request body'
      }, { status: 400 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const bearer = (await getToken?.()) || undefined;
    const workerResponse = await fetch(`${authWorkerUrl}/leagues/default`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Clerk-User-ID': userId,
        ...(bearer ? { 'Authorization': `Bearer ${bearer}` } : {})
      },
      body: JSON.stringify({ leagueId: body.leagueId, sport: body.sport, seasonYear: body.seasonYear })
    });

    const workerData = await workerResponse.json() as any;

    if (!workerResponse.ok) {
      return NextResponse.json({
        error: workerData?.error || 'Failed to set default league'
      }, { status: workerResponse.status });
    }

    return NextResponse.json(workerData, { status: 200 });

  } catch (error) {
    console.error('ESPN default league API error:', error);
    return NextResponse.json({
      error: 'Failed to set default league'
    }, { status: 500 });
  }
}
