import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { runEspnDiscoverSeasons } from '@/lib/server/espn-onboarding';

export async function POST(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json();
    const { sport, leagueId } = body as { sport?: string; leagueId?: string };

    if (sport !== 'baseball' && sport !== 'football') {
      return NextResponse.json({
        error: 'Sport must be baseball or football',
      }, { status: 400 });
    }

    const bearer = await getToken?.();
    if (!bearer) {
      return NextResponse.json({
        error: 'Authentication token unavailable',
      }, { status: 401 });
    }

    const result = await runEspnDiscoverSeasons({
      sport,
      leagueId,
      authHeader: `Bearer ${bearer}`,
      correlationId: request.headers.get('X-Correlation-ID') || undefined,
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('Discover seasons API error:', error);
    return NextResponse.json(
      { error: 'Failed to discover seasons' },
      { status: 500 }
    );
  }
}
