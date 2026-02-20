/**
 * Default League API Route
 * ---------------------------------------------------------------------------
 * Sets a league as the user's default for a sport (works for ESPN and Yahoo).
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export async function POST(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body: {
      platform?: 'espn' | 'yahoo' | 'sleeper';
      leagueId?: string;
      sport?: string;
      seasonYear?: number;
    } = await request.json();

    if (!body.platform || !body.leagueId || !body.sport || body.seasonYear === undefined) {
      return NextResponse.json({
        error: 'platform, leagueId, sport, and seasonYear are required in request body'
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
        ...(bearer ? { 'Authorization': `Bearer ${bearer}` } : {})
      },
      body: JSON.stringify(body)
    });

    const workerData = await workerResponse.json() as any;

    if (!workerResponse.ok) {
      return NextResponse.json({
        error: workerData?.error || 'Failed to set default league'
      }, { status: workerResponse.status });
    }

    return NextResponse.json(workerData, { status: 200 });

  } catch (error) {
    console.error('Default league API error:', error);
    return NextResponse.json({
      error: 'Failed to set default league'
    }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sport = searchParams.get('sport');

    if (!sport) {
      return NextResponse.json({ error: 'sport query param is required' }, { status: 400 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const bearer = (await getToken?.()) || undefined;
    const workerResponse = await fetch(`${authWorkerUrl}/leagues/default/${sport}`, {
      method: 'DELETE',
      headers: bearer ? { 'Authorization': `Bearer ${bearer}` } : {}
    });

    const workerData = await workerResponse.json() as any;

    if (!workerResponse.ok) {
      return NextResponse.json({
        error: workerData?.error || 'Failed to clear default league'
      }, { status: workerResponse.status });
    }

    return NextResponse.json(workerData, { status: 200 });

  } catch (error) {
    console.error('Clear default league API error:', error);
    return NextResponse.json({ error: 'Failed to clear default league' }, { status: 500 });
  }
}
