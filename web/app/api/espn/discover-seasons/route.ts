/**
 * ESPN Discover Seasons API Route
 * ---------------------------------------------------------------------------
 * Proxies to sport workers' /onboarding/discover-seasons endpoints.
 * Probes ESPN API for all historical seasons of a league and auto-saves them.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export async function POST(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const { sport, leagueId } = body as { sport?: string; leagueId?: string };

    if (!sport || !leagueId) {
      return NextResponse.json({
        error: 'Missing required fields: sport and leagueId'
      }, { status: 400 });
    }

    if (sport !== 'baseball' && sport !== 'football') {
      return NextResponse.json({
        error: 'Sport must be baseball or football'
      }, { status: 400 });
    }

    const bearer = await getToken?.();
    if (!bearer) {
      return NextResponse.json({
        error: 'Authentication token unavailable'
      }, { status: 401 });
    }

    // Use correct env var names
    const workerUrl = sport === 'baseball'
      ? process.env.NEXT_PUBLIC_BASEBALL_ESPN_MCP_URL
      : process.env.NEXT_PUBLIC_FOOTBALL_ESPN_MCP_URL;

    if (!workerUrl) {
      return NextResponse.json({
        error: `Worker URL not configured for ${sport}`
      }, { status: 500 });
    }

    console.log(`[discover-seasons] Calling ${sport} worker: ${workerUrl}/onboarding/discover-seasons`);

    try {
      const response = await fetch(`${workerUrl}/onboarding/discover-seasons`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Clerk-User-ID': userId,
          'Authorization': `Bearer ${bearer}`
        },
        body: JSON.stringify({ leagueId })
      });

      const data = await response.json();
      console.log(`[discover-seasons] Worker response status: ${response.status}`);

      return NextResponse.json(data, { status: response.status });
    } catch (workerError) {
      console.error('Worker connection error:', workerError);
      return NextResponse.json({
        error: 'Failed to connect to league discovery service'
      }, { status: 502 });
    }

  } catch (error) {
    console.error('Discover seasons API error:', error);
    return NextResponse.json(
      { error: 'Failed to discover seasons' },
      { status: 500 }
    );
  }
}
