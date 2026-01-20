import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * GET /api/extension/connection
 * -----------------------------------------------------------
 * Get extension connection status for the web UI.
 * Called by the /extension page to show connection status.
 * Requires Clerk authentication.
 * Proxies to auth-worker GET /extension/connection.
 */
export async function GET() {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const bearer = (await getToken?.()) || undefined;

    let workerRes: Response;
    try {
      workerRes = await fetch(`${authWorkerUrl}/extension/connection`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          ...(bearer ? { 'Authorization': `Bearer ${bearer}` } : {})
        },
      });
    } catch {
      // Worker unreachable (e.g., frontend-only dev mode)
      return NextResponse.json({
        success: true,
        connected: false,
        token: null,
        _workerUnavailable: true,
      });
    }

    if (!workerRes.ok) {
      const err = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as {
        error?: string;
        error_description?: string;
      };
      return NextResponse.json(
        { error: err.error || 'Failed to get connection', error_description: err.error_description },
        { status: workerRes.status }
      );
    }

    const data = await workerRes.json() as {
      success?: boolean;
      connected?: boolean;
      token?: {
        id: string;
        createdAt: string;
        lastUsedAt: string | null;
      } | null;
    };

    return NextResponse.json({
      success: true,
      connected: data.connected,
      token: data.token,
    });
  } catch (error) {
    console.error('Extension connection route error:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to get connection' },
      { status: 500 }
    );
  }
}
