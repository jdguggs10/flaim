import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export const runtime = 'edge';

/**
 * POST /api/extension/code
 * -----------------------------------------------------------
 * Generate a new pairing code for the Chrome extension.
 * Called by the /extension page when user clicks "Generate Code".
 * Proxies to auth-worker POST /extension/code with Clerk JWT.
 */
export async function POST(_request: NextRequest) {
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

    const workerRes = await fetch(`${authWorkerUrl}/extension/code`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Clerk-User-ID': userId,
        ...(bearer ? { 'Authorization': `Bearer ${bearer}` } : {})
      },
      body: JSON.stringify({})
    });

    if (!workerRes.ok) {
      const err = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as {
        error?: string;
        error_description?: string;
      };
      return NextResponse.json(
        { error: err.error || 'Failed to create pairing code', error_description: err.error_description },
        { status: workerRes.status }
      );
    }

    const data = await workerRes.json() as {
      success?: boolean;
      code?: string;
      expiresAt?: string;
      expiresInSeconds?: number;
    };

    return NextResponse.json({
      success: true,
      code: data.code,
      expiresAt: data.expiresAt,
      expiresInSeconds: data.expiresInSeconds,
    });
  } catch (error) {
    console.error('Extension code route error:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to create pairing code' },
      { status: 500 }
    );
  }
}
