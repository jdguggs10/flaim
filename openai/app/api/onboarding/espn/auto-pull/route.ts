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
} from '@/auth/espn/types';

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    
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

    // Determine which sport worker to call based on sport
    const sportWorkerUrls = {
      'baseball': process.env.NEXT_PUBLIC_BASEBALL_ESPN_MCP_URL,
      'football': process.env.NEXT_PUBLIC_FOOTBALL_ESPN_MCP_URL,
      // Basketball and hockey workers are not yet implemented
      // 'basketball': process.env.NEXT_PUBLIC_BASKETBALL_ESPN_MCP_URL,
      // 'hockey': process.env.NEXT_PUBLIC_HOCKEY_ESPN_MCP_URL
    };

    const workerUrl = sportWorkerUrls[sport as keyof typeof sportWorkerUrls];
    if (!workerUrl) {
      const supportedSports = Object.keys(sportWorkerUrls).join(', ');
      return NextResponse.json({ 
        error: `Sport "${sport}" is not yet supported. Currently supported sports: ${supportedSports}`,
        code: 'SPORT_NOT_SUPPORTED'
      }, { status: 503 });
    }

    try {
      // Call the sport worker's onboarding initialize endpoint
      const workerResponse = await fetch(`${workerUrl}/onboarding/initialize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Clerk-User-ID': userId
        },
        body: JSON.stringify({
          sport: sport,
          leagueId: leagueId
        })
      });

      if (!workerResponse.ok) {
        const errorData = await workerResponse.json().catch(() => ({})) as { 
          code?: string; 
          error?: string; 
        };
        console.error('Sport worker error:', workerResponse.status, errorData);
        
        if (workerResponse.status === 404) {
          if (errorData.code === 'CREDENTIALS_MISSING') {
            return NextResponse.json({ 
              error: 'ESPN credentials not found. Please add your ESPN credentials first.',
              code: 'CREDENTIALS_MISSING'
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
        return NextResponse.json({ 
          error: 'No teams found in this league - there may be an issue with the league data' 
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