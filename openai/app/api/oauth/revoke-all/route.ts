import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export const runtime = 'edge';

/**
 * POST /api/oauth/revoke-all
 * -----------------------------------------------------------
 * Revoke all active OAuth connections for the user.
 * Proxies to auth-worker POST /oauth/revoke-all with Clerk JWT.
 */
export async function POST(request: NextRequest) {
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

    const workerRes = await fetch(`${authWorkerUrl}/oauth/revoke-all`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Clerk-User-ID': userId,
        ...(bearer ? { 'Authorization': `Bearer ${bearer}` } : {})
      }
    });

    if (!workerRes.ok) {
      const err = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as {
        error?: string;
        error_description?: string
      };
      return NextResponse.json(
        { error: err.error || 'Failed to revoke connections', error_description: err.error_description },
        { status: workerRes.status }
      );
    }

    const data = await workerRes.json() as {
      success?: boolean;
      revokedCount?: number;
    };

    return NextResponse.json({
      success: true,
      revokedCount: data.revokedCount
    });
  } catch (error) {
    console.error('OAuth revoke-all route error:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to revoke connections' },
      { status: 500 }
    );
  }
}
