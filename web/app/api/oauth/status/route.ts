import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * GET /api/oauth/status
 * -----------------------------------------------------------
 * Check if the user has active OAuth connections.
 * Proxies to auth-worker GET /oauth/status with Clerk JWT.
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

    const workerRes = await fetch(`${authWorkerUrl}/oauth/status`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { 'Authorization': `Bearer ${bearer}` } : {})
      }
    });

    if (!workerRes.ok) {
      const err = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as {
        error?: string;
        error_description?: string
      };
      return NextResponse.json(
        { error: err.error || 'Failed to check status', error_description: err.error_description },
        { status: workerRes.status }
      );
    }

    const data = await workerRes.json() as {
      success?: boolean;
      hasConnection?: boolean;
      connections?: Array<{
        id: string;
        expiresAt: string;
        scope: string;
        clientName?: string;
      }>;
    };

    return NextResponse.json({
      success: true,
      hasConnection: data.hasConnection,
      connections: data.connections || []
    });
  } catch (error) {
    console.error('OAuth status route error:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to check status' },
      { status: 500 }
    );
  }
}
