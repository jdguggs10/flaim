/**
 * ESPN League Team Selection API Route
 * ---------------------------------------------------------------------------
 * Proxy to auth-worker PATCH /leagues/:leagueId/team endpoint.
 * Handles saving team selection for a specific league after auto-pull.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export const runtime = 'edge';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { leagueId } = await params;
    const body: { teamId: string; sport?: string } = await request.json();
    
    if (!body.teamId) {
      return NextResponse.json({ 
        error: 'teamId is required' 
      }, { status: 400 });
    }

    // Call auth-worker PATCH endpoint
    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_AUTH_WORKER_URL is not configured' }, { status: 500 });
    }
    const response = await fetch(`${authWorkerUrl}/leagues/${leagueId}/team`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Clerk-User-ID': userId
      },
      body: JSON.stringify({
        teamId: body.teamId,
        sport: body.sport
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as any;
      console.error('Auth-worker error:', response.status, errorData);
      
      return NextResponse.json({ 
        error: errorData.error || 'Failed to save team selection',
        details: errorData.message 
      }, { status: response.status });
    }

    const data = await response.json() as any;
    
    return NextResponse.json({
      success: true,
      message: 'Team selection saved successfully',
      league: data.league
    });

  } catch (error) {
    console.error('Team selection API error:', error);
    return NextResponse.json(
      { error: 'Failed to save team selection' }, 
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { leagueId } = await params;
    const { searchParams } = new URL(request.url);
    const sport = searchParams.get('sport');

    // Call auth-worker to get leagues
    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_AUTH_WORKER_URL is not configured' }, { status: 500 });
    }
    const response = await fetch(`${authWorkerUrl}/leagues`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Clerk-User-ID': userId
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as any;
      console.error('Auth-worker error:', response.status, errorData);
      
      return NextResponse.json({ 
        error: errorData.error || 'Failed to retrieve leagues'
      }, { status: response.status });
    }

    const data = await response.json() as any;
    const leagues = data.leagues || [];
    
    if (leagues.length === 0) {
      return NextResponse.json({ 
        error: 'No leagues found for user' 
      }, { status: 404 });
    }

    // Find the specific league
    const league = leagues.find((league: any) => 
      league.leagueId === leagueId && 
      (sport ? league.sport === sport : true)
    );

    if (!league) {
      return NextResponse.json({ 
        error: 'League not found' 
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      league: {
        leagueId: league.leagueId,
        sport: league.sport,
        teamId: league.teamId || null,
        leagueName: league.leagueName || null,
        hasTeamSelected: !!league.teamId
      }
    });

  } catch (error) {
    console.error('Team selection GET API error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve team selection' }, 
      { status: 500 }
    );
  }
}