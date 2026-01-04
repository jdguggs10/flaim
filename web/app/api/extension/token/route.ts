import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * DELETE /api/extension/token
 * -----------------------------------------------------------
 * Revoke an extension token (disconnect).
 * Called by the /extension page when user clicks "Disconnect".
 * Requires Clerk authentication.
 * Proxies to auth-worker DELETE /extension/token.
 */
export async function DELETE(request: NextRequest) {
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

    const workerRes = await fetch(`${authWorkerUrl}/extension/token`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Clerk-User-ID': userId,
        ...(bearer ? { 'Authorization': `Bearer ${bearer}` } : {})
      },
      body: JSON.stringify({ tokenId: body.tokenId })
    });

    if (!workerRes.ok) {
      const err = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as {
        error?: string;
        error_description?: string;
      };
      return NextResponse.json(
        { error: err.error || 'Failed to revoke token', error_description: err.error_description },
        { status: workerRes.status }
      );
    }

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error('Extension token route error:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to revoke token' },
      { status: 500 }
    );
  }
}
