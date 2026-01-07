import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/extension/set-default
 * -----------------------------------------------------------
 * Set a league as the user's default.
 * Called by the extension at the end of setup flow.
 * Requires Bearer token authentication (extension token).
 * Proxies to auth-worker POST /extension/set-default.
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return NextResponse.json({
        error: 'unauthorized',
        error_description: 'Missing Authorization header'
      }, { status: 401 });
    }

    const body = await request.json() as {
      leagueId?: string;
      sport?: string;
      seasonYear?: number;
    };

    if (!body.leagueId || !body.sport || body.seasonYear === undefined) {
      return NextResponse.json({
        error: 'invalid_request',
        error_description: 'leagueId, sport, and seasonYear are required'
      }, { status: 400 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({
        error: 'server_error',
        error_description: 'AUTH_WORKER_URL is not configured'
      }, { status: 500 });
    }

    const workerRes = await fetch(`${authWorkerUrl}/extension/set-default`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify({
        leagueId: body.leagueId,
        sport: body.sport,
        seasonYear: body.seasonYear,
      }),
    });

    const data = await workerRes.json() as Record<string, unknown>;

    if (!workerRes.ok) {
      return NextResponse.json(data, { status: workerRes.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Extension set-default route error:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to set default league' },
      { status: 500 }
    );
  }
}
