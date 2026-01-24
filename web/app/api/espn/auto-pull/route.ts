/**
 * ESPN Auto-Pull API Route
 * ---------------------------------------------------------------------------
 * Simplified proxy to sport workers' /onboarding/initialize endpoints.
 * Credentials and league management now handled by auth-worker.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import type {
  AutoPullResponse,
  EspnLeagueInfo,
  SportName
} from '@/lib/espn-types';
import { getDefaultSeasonYear, type SeasonSport } from '@/lib/season-utils';

export async function POST(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const { sport, leagueId, seasonYear: requestedSeasonYear } = body as {
      sport?: string;
      leagueId?: string;
      seasonYear?: number;
    };

    if (!sport || !leagueId) {
      return NextResponse.json({
        error: 'Missing required fields: sport and leagueId'
      }, { status: 400 });
    }

    // Use provided seasonYear or compute default based on sport + date
    const seasonYear = requestedSeasonYear ||
      ((sport === 'baseball' || sport === 'football')
        ? getDefaultSeasonYear(sport as SeasonSport)
        : new Date().getFullYear());

    console.log(`[auto-pull] Using season year: ${seasonYear} (requested: ${requestedSeasonYear || 'none'})`);

    const bearer = (await getToken?.()) || undefined;

    // Debug: Log token availability and details (helps diagnose auth issues)
    console.log(`[auto-pull] User: ${userId}, bearer token available: ${!!bearer}`);
    if (bearer) {
      // Log JWT structure without exposing full token
      const parts = bearer.split('.');
      console.log(`[auto-pull] JWT structure: ${parts.length} parts, length: ${bearer.length} chars`);
      try {
        const payload = JSON.parse(atob(parts[1]));
        console.log(`[auto-pull] JWT payload - sub: ${payload.sub}, iss: ${payload.iss}, exp: ${new Date(payload.exp * 1000).toISOString()}`);
      } catch (parseError) {
        console.log('[auto-pull] Could not parse JWT payload', parseError);
      }
    }

    // If no bearer token, auth-worker and sport workers will reject the request
    if (!bearer) {
      console.error('[auto-pull] getToken() returned undefined - cannot authenticate with workers');
      return NextResponse.json({
        error: 'Authentication token unavailable. Please try signing out and back in.',
        code: 'TOKEN_UNAVAILABLE'
      }, { status: 401 });
    }

    // Fail fast if the user hasn't saved credentials in auth-worker yet.
    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({
        error: 'NEXT_PUBLIC_AUTH_WORKER_URL is not configured'
      }, { status: 500 });
    }

    console.log(`[auto-pull] Auth worker URL: ${authWorkerUrl}`);
    console.log(`[auto-pull] Credential pre-check URL: ${authWorkerUrl}/credentials/espn`);

    const credentialCheck = await fetch(`${authWorkerUrl}/credentials/espn`, {
      headers: {
        ...(bearer ? { 'Authorization': `Bearer ${bearer}` } : {})
      },
      cache: 'no-store'
    });

    console.log(`[auto-pull] Credential pre-check response: ${credentialCheck.status}`);

    if (credentialCheck.status === 404) {
      console.error('[auto-pull] Credential check returned 404');
      return NextResponse.json({
        error: 'ESPN credentials not found (credential check). Please add your ESPN credentials first.',
        code: 'CREDENTIALS_MISSING_CHECK'
      }, { status: 404 });
    }

    if (!credentialCheck.ok) {
      const err = await credentialCheck.json().catch(() => ({})) as { error?: string };
      return NextResponse.json({
        error: err.error || 'Failed to verify ESPN credentials'
      }, { status: credentialCheck.status });
    }

    const espnClientUrl = process.env.NEXT_PUBLIC_ESPN_CLIENT_URL;
    const workerUrl = espnClientUrl;
    console.log(`[auto-pull] ESPN client URL: ${espnClientUrl || 'NOT SET'}`);
    console.log(`[auto-pull] Sport worker URL for ${sport}: ${workerUrl || 'NOT SET'}`);

    if (!workerUrl) {
      return NextResponse.json({
        error: 'NEXT_PUBLIC_ESPN_CLIENT_URL is not configured'
      }, { status: 500 });
    }

    try {
      // Call the ESPN onboarding initialize endpoint
      const sportWorkerFullUrl = `${workerUrl}/onboarding/initialize`;
      console.log(`[auto-pull] Calling sport worker: ${sportWorkerFullUrl}`);
      console.log(`[auto-pull] Sport worker request - userId: ${userId}, sport: ${sport}, leagueId: ${leagueId}, seasonYear: ${seasonYear}`);
      console.log(`[auto-pull] Sport worker auth header: Bearer ${bearer ? `[${bearer.length} chars]` : 'MISSING'}`);

      const workerResponse = await fetch(sportWorkerFullUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(bearer ? { 'Authorization': `Bearer ${bearer}` } : {})
        },
        body: JSON.stringify({
          sport: sport,
          leagueId: leagueId,
          seasonYear: seasonYear
        })
      });

      console.log(`[auto-pull] Sport worker response status: ${workerResponse.status}`);

      if (!workerResponse.ok) {
        const errorData = await workerResponse.json().catch(() => ({})) as { 
          code?: string; 
          error?: string; 
        };
        console.error('Sport worker error:', workerResponse.status, errorData);
        
        if (workerResponse.status === 404) {
          if (errorData.code === 'CREDENTIALS_MISSING') {
            console.error('[auto-pull] Sport worker returned CREDENTIALS_MISSING');
            return NextResponse.json({
              error: 'ESPN credentials not found (sport worker auth failed). Please add your ESPN credentials first.',
              code: 'CREDENTIALS_MISSING_WORKER'
            }, { status: 404 });
          }
          
          if (errorData.code === 'LEAGUES_MISSING') {
            return NextResponse.json({ 
              error: `No ${sport} leagues found. Please add ${sport} leagues first.`,
              code: 'LEAGUES_MISSING'
            }, { status: 404 });
          }
          
          return NextResponse.json({ 
            error: errorData.error || 'Required data not found' 
          }, { status: 404 });
        }

        return NextResponse.json({ 
          error: errorData.error || 'Failed to retrieve league information' 
        }, { status: workerResponse.status });
      }

      const workerData = await workerResponse.json() as {
        success?: boolean;
        error?: string;
        leagues?: Array<{
          leagueId: string;
          sport: string;
          teamId?: string;
          leagueName?: string;
          seasonYear?: number;
          gameId?: string;
          standings?: any[];
          teams?: any[];
          success?: boolean;
          error?: string;
        }>;
      };

      if (!workerData.success) {
        return NextResponse.json({
          error: workerData.error || 'Failed to retrieve league information'
        }, { status: 400 });
      }

      // Transform sport worker response into expected format for the frontend
      // Sport worker now returns info for the specific requested league
      const targetLeague = workerData.leagues?.[0];
      if (!targetLeague) {
        return NextResponse.json({
          error: 'No league data returned from sport worker'
        }, { status: 404 });
      }

      // Check if the league itself has an error (e.g., ESPN returned 404 for this season)
      if (targetLeague.success === false && targetLeague.error) {
        return NextResponse.json({
          error: targetLeague.error
        }, { status: 404 });
      }

      const leagueInfo: EspnLeagueInfo = {
        leagueId: targetLeague.leagueId,
        leagueName: targetLeague.leagueName || `${sport} League ${targetLeague.leagueId}`,
        sport: sport as SportName,
        seasonYear: targetLeague.seasonYear || new Date().getFullYear(),
        gameId: targetLeague.gameId || (sport === 'baseball' ? 'flb' : 'ffl'),
        standings: targetLeague.standings || [],
        teams: targetLeague.teams || []
      };

      // Validate that we got meaningful data
      if (!leagueInfo.teams || leagueInfo.teams.length === 0) {
        // Provide helpful message about season-specific issues
        const suggestedYear = leagueInfo.seasonYear === new Date().getFullYear()
          ? leagueInfo.seasonYear - 1
          : leagueInfo.seasonYear;
        return NextResponse.json({
          error: `No teams found for ${sport} league ${leagueId} in season ${leagueInfo.seasonYear}. ` +
            `This league may not exist for this season. Try season ${suggestedYear} instead.`
        }, { status: 404 });
      }

      const response: AutoPullResponse = {
        success: true,
        leagueInfo
      };

      return NextResponse.json(response);

    } catch (workerError) {
      console.error('Sport worker integration error:', workerError);
      return NextResponse.json({ 
        error: 'Failed to connect to league data service' 
      }, { status: 502 });
    }

  } catch (error) {
    console.error('Auto-pull API error:', error);
    return NextResponse.json(
      { error: 'Failed to auto-pull league information' }, 
      { status: 500 }
    );
  }
}
