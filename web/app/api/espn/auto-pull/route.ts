import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { runEspnAutoPull } from '@/lib/server/espn-onboarding';

export async function POST(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const { sport, leagueId, seasonYear } = body as {
      sport?: string;
      leagueId?: string;
      seasonYear?: number;
    };

    const bearer = await getToken?.();
    if (!bearer) {
      return NextResponse.json({
        error: 'Authentication token unavailable. Please try signing out and back in.',
        code: 'TOKEN_UNAVAILABLE',
      }, { status: 401 });
    }

    const result = await runEspnAutoPull({
      sport,
      leagueId,
      seasonYear,
      authHeader: `Bearer ${bearer}`,
      correlationId: request.headers.get('X-Correlation-ID') || undefined,
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('Auto-pull API error:', error);
    return NextResponse.json(
      { error: 'Failed to auto-pull league information' },
      { status: 500 }
    );
  }
}
