/**
 * ESPN Leagues Management API Route
 * ---------------------------------------------------------------------------
 * Handles saving and managing ESPN league arrays for the new manual entry flow.
 * Supports up to 10 leagues per user with duplicate validation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export async function GET() {
  try {
    const { userId, getToken } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    // -----------------------------------------------------------------------
    // Proxy request to Auth-Worker to fetch stored leagues
    // -----------------------------------------------------------------------

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const bearer = (await getToken?.()) || undefined;
    const workerResponse = await fetch(`${authWorkerUrl}/leagues`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        // Pass Clerk user in header (Auth-Worker uses this instead of JWT)
        'X-Clerk-User-ID': userId,
        ...(bearer ? { 'Authorization': `Bearer ${bearer}` } : {})
      }
    });

    if (!workerResponse.ok) {
      // If leagues not found, return empty array instead of error
      if (workerResponse.status === 404) {
        return NextResponse.json({ leagues: [] }, { status: 200 });
      }
      
      const workerData = await workerResponse.json() as any;
      return NextResponse.json({
        error: workerData?.error || 'Failed to fetch leagues'
      }, { status: workerResponse.status });
    }

    const workerData = await workerResponse.json() as any;
    return NextResponse.json(workerData, { status: 200 });

  } catch (error) {
    console.error('ESPN leagues GET API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch ESPN leagues' }, 
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body: { leagues: Array<{ leagueId: string; sport: string }> } = await request.json();
    
    if (!body.leagues || !Array.isArray(body.leagues)) {
      return NextResponse.json({ 
        error: 'Invalid request: leagues array is required' 
      }, { status: 400 });
    }

    // Validate league limit
    if (body.leagues.length > 10) {
      return NextResponse.json({ 
        error: 'Maximum of 10 leagues allowed per user' 
      }, { status: 400 });
    }

    // Validate each league
    const validationErrors: string[] = [];
    const seenLeagues = new Set<string>();

    for (const [index, league] of body.leagues.entries()) {
      // Check required fields
      if (!league.leagueId || !league.sport) {
        validationErrors.push(`League ${index + 1}: Missing leagueId or sport`);
        continue;
      }

      // Check for duplicates
      const leagueKey = `${league.leagueId}-${league.sport}`;
      if (seenLeagues.has(leagueKey)) {
        validationErrors.push(`League ${index + 1}: Duplicate league ${league.leagueId} for ${league.sport}`);
      }
      seenLeagues.add(leagueKey);

      // Validate sport
      const validSports = ['football', 'hockey', 'baseball', 'basketball'];
      if (!validSports.includes(league.sport)) {
        validationErrors.push(`League ${index + 1}: Invalid sport "${league.sport}"`);
      }
    }

    if (validationErrors.length > 0) {
      return NextResponse.json({ 
        error: 'Validation failed',
        details: validationErrors
      }, { status: 400 });
    }

    // -----------------------------------------------------------------------
    // Proxy request to Auth-Worker (centralized credential + league storage)
    // -----------------------------------------------------------------------

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const bearer = (await getToken?.()) || undefined;
    const workerResponse = await fetch(`${authWorkerUrl}/leagues`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Pass Clerk user in header (Auth-Worker uses this instead of JWT)
        'X-Clerk-User-ID': userId,
        ...(bearer ? { 'Authorization': `Bearer ${bearer}` } : {})
      },
      body: JSON.stringify({ leagues: body.leagues })
    });

    const workerData = await workerResponse.json() as any;

    if (!workerResponse.ok) {
      return NextResponse.json({
        error: workerData?.error || 'Failed to save leagues'
      }, { status: workerResponse.status });
    }

    return NextResponse.json(workerData, { status: 200 });

  } catch (error) {
    console.error('ESPN leagues API error:', error);
    return NextResponse.json(
      { error: 'Failed to save ESPN leagues' }, 
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const leagueId = searchParams.get('leagueId');
    const sport = searchParams.get('sport');

    if (!leagueId || !sport) {
      return NextResponse.json({
        error: 'leagueId and sport query parameters are required'
      }, { status: 400 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const bearer = (await getToken?.()) || undefined;
    const workerResponse = await fetch(`${authWorkerUrl}/leagues?leagueId=${encodeURIComponent(leagueId)}&sport=${encodeURIComponent(sport)}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Clerk-User-ID': userId,
        ...(bearer ? { 'Authorization': `Bearer ${bearer}` } : {})
      }
    });

    const workerData = await workerResponse.json() as any;

    if (!workerResponse.ok) {
      return NextResponse.json({
        error: workerData?.error || 'Failed to remove league'
      }, { status: workerResponse.status });
    }

    return NextResponse.json(workerData, { status: 200 });

  } catch (error) {
    console.error('ESPN leagues DELETE API error:', error);
    return NextResponse.json({
      error: 'Failed to remove league'
    }, { status: 500 });
  }
}
