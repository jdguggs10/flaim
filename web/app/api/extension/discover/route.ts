import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/extension/discover
 * -----------------------------------------------------------
 * Discover and save all ESPN leagues for a user.
 * Called by the extension after syncing credentials.
 * Requires Bearer token authentication (Clerk JWT).
 * Proxies to auth-worker POST /extension/discover.
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

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({
        error: 'server_error',
        error_description: 'AUTH_WORKER_URL is not configured'
      }, { status: 500 });
    }

    const workerRes = await fetch(`${authWorkerUrl}/extension/discover`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
    });

    if (!workerRes.ok) {
      const err = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as {
        error?: string;
        error_description?: string;
      };
      return NextResponse.json(
        { error: err.error || 'Failed to discover leagues', error_description: err.error_description },
        { status: workerRes.status }
      );
    }

    const data = await workerRes.json().catch(() => null) as {
      discovered?: unknown[];
      currentSeason?: Record<string, number>;
      pastSeasons?: Record<string, number>;
    } | null;

    if (!data || !Array.isArray(data.discovered)) {
      return NextResponse.json(
        { error: 'server_error', error_description: 'Unexpected response from discovery service' },
        { status: 502 }
      );
    }

    return NextResponse.json({
      discovered: data.discovered,
      currentSeason: data.currentSeason,
      pastSeasons: data.pastSeasons,
    });
  } catch (error) {
    console.error('Extension discover route error:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to discover leagues' },
      { status: 500 }
    );
  }
}
