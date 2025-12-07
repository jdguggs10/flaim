import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export const runtime = 'edge';

/**
 * GET /api/auth/espn/credentials
 * -----------------------------------------------------------
 * Check if user has stored ESPN credentials.
 * Proxies to auth-worker with proper JWT forwarding.
 */
export async function GET() {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const bearer = (await getToken?.()) || undefined;
    const workerRes = await fetch(`${authWorkerUrl}/credentials/espn`, {
      headers: {
        'X-Clerk-User-ID': userId,
        ...(bearer ? { 'Authorization': `Bearer ${bearer}` } : {})
      },
    });

    // auth-worker returns 404 when user has no stored credentials; treat as empty state
    if (workerRes.status === 404) {
      return NextResponse.json({ hasCredentials: false }, { status: 200 });
    }

    if (!workerRes.ok) {
      const err = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
      return NextResponse.json(
        { error: err.error || 'Failed to fetch credentials' },
        { status: workerRes.status }
      );
    }

    const data = await workerRes.json() as { hasCredentials?: boolean; swid?: string; s2?: string; email?: string; lastUpdated?: string };
    const hasCredentials = data.hasCredentials ?? (!!data.swid && !!data.s2);

    return NextResponse.json({
      hasCredentials,
      email: data.email,
      lastUpdated: data.lastUpdated
    });
  } catch (error) {
    console.error('ESPN credentials GET route error', error);
    return NextResponse.json(
      { error: 'Failed to retrieve credentials' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/auth/espn/credentials
 * -----------------------------------------------------------
 * Store ESPN credentials for the authenticated user.
 * Proxies to auth-worker with proper JWT forwarding.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json() as { swid?: string; s2?: string; email?: string };

    if (!body.swid || !body.s2) {
      return NextResponse.json({
        error: 'Invalid credentials',
        message: 'ESPN credentials require swid and s2 fields'
      }, { status: 400 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const bearer = (await getToken?.()) || undefined;
    const workerRes = await fetch(`${authWorkerUrl}/credentials/espn`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Clerk-User-ID': userId,
        ...(bearer ? { 'Authorization': `Bearer ${bearer}` } : {})
      },
      body: JSON.stringify({
        swid: body.swid,
        s2: body.s2,
        email: body.email
      })
    });

    if (!workerRes.ok) {
      const err = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as { error?: string; message?: string };
      return NextResponse.json(
        { error: err.error || 'Failed to store credentials', message: err.message },
        { status: workerRes.status }
      );
    }

    const data = await workerRes.json() as { success?: boolean; message?: string };
    return NextResponse.json({
      success: true,
      message: data.message || 'ESPN credentials stored successfully'
    });
  } catch (error) {
    console.error('ESPN credentials POST route error', error);
    return NextResponse.json(
      { error: 'Failed to store credentials' },
      { status: 500 }
    );
  }
}
