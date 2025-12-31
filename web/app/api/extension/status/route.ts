import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

/**
 * GET /api/extension/status
 * -----------------------------------------------------------
 * Check extension connection status.
 * Called by the extension to verify connection and credentials.
 * Requires Bearer token authentication (extension token).
 * Proxies to auth-worker GET /extension/status.
 */
export async function GET(request: NextRequest) {
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
      return NextResponse.json({ error: 'AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const workerRes = await fetch(`${authWorkerUrl}/extension/status`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': authHeader,
      },
    });

    if (!workerRes.ok) {
      const err = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as {
        error?: string;
        error_description?: string;
      };
      return NextResponse.json(
        { error: err.error || 'Failed to get status', error_description: err.error_description },
        { status: workerRes.status }
      );
    }

    const data = await workerRes.json() as {
      success?: boolean;
      connected?: boolean;
      hasCredentials?: boolean;
      lastSync?: string;
    };

    return NextResponse.json({
      success: true,
      connected: data.connected,
      hasCredentials: data.hasCredentials,
      lastSync: data.lastSync,
    });
  } catch (error) {
    console.error('Extension status route error:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to get status' },
      { status: 500 }
    );
  }
}
