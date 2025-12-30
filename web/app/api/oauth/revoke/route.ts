import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export const runtime = 'edge';

/**
 * POST /api/oauth/revoke
 * -----------------------------------------------------------
 * Revoke an OAuth access token.
 * Called by the connectors page to disconnect Claude.
 * Proxies to auth-worker POST /revoke.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json() as { token?: string };

    // Token is required for revocation
    if (!body.token) {
      return NextResponse.json({
        error: 'invalid_request',
        error_description: 'token is required'
      }, { status: 400 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const bearer = (await getToken?.()) || undefined;

    // Note: auth-worker /revoke endpoint always returns 200 per RFC 7009
    await fetch(`${authWorkerUrl}/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Clerk-User-ID': userId,
        ...(bearer ? { 'Authorization': `Bearer ${bearer}` } : {})
      },
      body: JSON.stringify({ token: body.token })
    });

    // Always return success per RFC 7009
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('OAuth revoke route error:', error);
    // Still return success per RFC 7009 (don't leak info about token validity)
    return NextResponse.json({ success: true });
  }
}
