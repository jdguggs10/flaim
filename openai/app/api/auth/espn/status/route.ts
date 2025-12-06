import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export const runtime = 'edge';

// Response shape returned to client
interface EspnCredentialsStatus {
  hasCredentials: boolean;
}

/**
 * GET /api/auth/espn/status
 * -----------------------------------------------------------
 * Lightweight endpoint the frontend can hit to find out whether
 * the current Clerk user already has ESPN credentials stored in
 * auth-worker.  We forward the request to auth-worker and return a
 * simple boolean so that UI code can decide whether to skip the
 * credential collection step.
 */
export async function GET() {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;;
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

    // auth-worker returns 404 when the user has never stored creds
    if (workerRes.status === 404) {
      const response: EspnCredentialsStatus = { hasCredentials: false };
      return NextResponse.json(response);
    }

    if (!workerRes.ok) {
      const err = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
      return NextResponse.json(
        { error: err.error || 'Failed to fetch credential status' },
        { status: workerRes.status }
      );
    }

    const data = (await workerRes.json()) as { hasCredentials?: boolean; swid?: string; s2?: string };
    const response: EspnCredentialsStatus = {
      hasCredentials: data.hasCredentials ?? (!!data.swid && !!data.s2),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('ESPN credential status route error', error);
    return NextResponse.json(
      { error: 'Failed to retrieve credential status' },
      { status: 500 }
    );
  }
} 
