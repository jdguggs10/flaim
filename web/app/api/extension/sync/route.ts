import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/extension/sync
 * -----------------------------------------------------------
 * Sync ESPN credentials from the Chrome extension.
 * Called by the extension after capturing cookies from ESPN.
 * Requires Bearer token authentication (extension token).
 * Proxies to auth-worker POST /extension/sync.
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

    const body = await request.json() as { swid?: string; s2?: string };

    if (!body.swid || !body.s2) {
      return NextResponse.json({
        error: 'invalid_request',
        error_description: 'swid and s2 are required'
      }, { status: 400 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const workerRes = await fetch(`${authWorkerUrl}/extension/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
      },
      body: JSON.stringify({ swid: body.swid, s2: body.s2 })
    });

    if (!workerRes.ok) {
      const err = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as {
        error?: string;
        error_description?: string;
      };
      return NextResponse.json(
        { error: err.error || 'Failed to sync credentials', error_description: err.error_description },
        { status: workerRes.status }
      );
    }

    const data = await workerRes.json() as {
      success?: boolean;
      message?: string;
    };

    return NextResponse.json({
      success: true,
      message: data.message || 'Credentials synced successfully',
    });
  } catch (error) {
    console.error('Extension sync route error:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to sync credentials' },
      { status: 500 }
    );
  }
}
