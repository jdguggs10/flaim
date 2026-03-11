/**
 * Default League API Route
 * ---------------------------------------------------------------------------
 * Sets a league as the user's default for a sport (works for ESPN, Yahoo, and Sleeper).
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

const VALID_PLATFORMS = ['espn', 'yahoo', 'sleeper'] as const;
const VALID_SPORTS = ['football', 'baseball', 'basketball', 'hockey'] as const;

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

    if (!VALID_PLATFORMS.includes(body.platform as typeof VALID_PLATFORMS[number])) {
      return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
    }

    if (!VALID_SPORTS.includes(body.sport as typeof VALID_SPORTS[number])) {
      return NextResponse.json({ error: 'Invalid sport' }, { status: 400 });
    }

    if (!Number.isInteger(body.seasonYear) || body.seasonYear < 2000 || body.seasonYear > 2100) {
      return NextResponse.json({ error: 'Invalid seasonYear' }, { status: 400 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const bearer = await getToken?.();
    if (!bearer) {
      return NextResponse.json({ error: 'Authentication token unavailable' }, { status: 401 });
    }
    const workerResponse = await fetch(`${authWorkerUrl}/leagues/default`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bearer}`,
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
    if (!VALID_SPORTS.includes(sport as typeof VALID_SPORTS[number])) {
      return NextResponse.json({ error: 'Invalid sport' }, { status: 400 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const bearer = await getToken?.();
    if (!bearer) {
      return NextResponse.json({ error: 'Authentication token unavailable' }, { status: 401 });
    }
    const workerResponse = await fetch(`${authWorkerUrl}/leagues/default/${encodeURIComponent(sport)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${bearer}` }
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
