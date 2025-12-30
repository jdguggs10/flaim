import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export const runtime = 'edge';

/**
 * POST /api/oauth/code
 * -----------------------------------------------------------
 * Create an OAuth authorization code after user consent.
 * Called by the frontend consent page after user approves.
 * Proxies to auth-worker POST /oauth/code with Clerk JWT.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json() as {
      redirect_uri: string;
      scope?: string;
      state?: string;
      code_challenge?: string;
      code_challenge_method?: string;
      resource?: string; // RFC 8707
    };

    // Validate required fields
    if (!body.redirect_uri) {
      return NextResponse.json({
        error: 'invalid_request',
        error_description: 'redirect_uri is required'
      }, { status: 400 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const bearer = (await getToken?.()) || undefined;

    const workerRes = await fetch(`${authWorkerUrl}/oauth/code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Clerk-User-ID': userId,
        ...(bearer ? { 'Authorization': `Bearer ${bearer}` } : {})
      },
      body: JSON.stringify({
        redirect_uri: body.redirect_uri,
        scope: body.scope,
        state: body.state,
        code_challenge: body.code_challenge,
        code_challenge_method: body.code_challenge_method,
        resource: body.resource // RFC 8707
      })
    });

    if (!workerRes.ok) {
      const err = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as {
        error?: string;
        error_description?: string
      };
      return NextResponse.json(
        { error: err.error || 'Failed to create authorization code', error_description: err.error_description },
        { status: workerRes.status }
      );
    }

    const data = await workerRes.json() as {
      success?: boolean;
      code?: string;
      redirect_url?: string
    };

    return NextResponse.json({
      success: true,
      code: data.code,
      redirect_url: data.redirect_url
    });
  } catch (error) {
    console.error('OAuth code route error:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to create authorization code' },
      { status: 500 }
    );
  }
}
