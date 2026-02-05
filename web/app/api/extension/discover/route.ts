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

    const data = await workerRes.json() as Record<string, unknown>;

    if (!workerRes.ok) {
      return NextResponse.json(data, { status: workerRes.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Extension discover route error:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to discover leagues' },
      { status: 500 }
    );
  }
}
