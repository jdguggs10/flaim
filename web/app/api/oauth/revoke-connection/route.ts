import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * POST /api/oauth/revoke-connection
 * -----------------------------------------------------------
 * Revoke a single OAuth connection by its ID.
 * Used by the connectors page to disconnect a specific AI platform.
 * Proxies to auth-worker POST /oauth/revoke.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json() as { tokenId?: string };

    if (!body.tokenId) {
      return NextResponse.json({
        error: 'invalid_request',
        error_description: 'tokenId is required'
      }, { status: 400 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const bearer = (await getToken?.()) || undefined;

    const workerRes = await fetch(`${authWorkerUrl}/oauth/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { 'Authorization': `Bearer ${bearer}` } : {})
      },
      body: JSON.stringify({ tokenId: body.tokenId })
    });

    if (!workerRes.ok) {
      const err = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as {
        error?: string;
        error_description?: string
      };
      return NextResponse.json(
        { error: err.error || 'Failed to revoke connection', error_description: err.error_description },
        { status: workerRes.status }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('OAuth revoke connection route error:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to revoke connection' },
      { status: 500 }
    );
  }
}
