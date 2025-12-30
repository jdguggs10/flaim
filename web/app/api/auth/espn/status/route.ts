import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export const runtime = 'edge';

// Response shape returned to client
interface EspnSetupStatus {
  hasCredentials: boolean;
  hasLeagues: boolean;
  hasDefaultTeam: boolean;
}

/**
 * GET /api/auth/espn/status
 * -----------------------------------------------------------
 * Returns the user's ESPN setup status for the chat app inline banner.
 * - hasCredentials: whether ESPN cookies are stored
 * - hasLeagues: whether at least one league is configured
 * - hasDefaultTeam: whether a default league with team is set
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

    if (!workerRes.ok) {
      const err = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
      return NextResponse.json(
        { error: err.error || 'Failed to fetch setup status' },
        { status: workerRes.status }
      );
    }

    const data = await workerRes.json() as {
      hasCredentials?: boolean;
      hasLeagues?: boolean;
      hasDefaultTeam?: boolean;
    };

    const response: EspnSetupStatus = {
      hasCredentials: data.hasCredentials ?? false,
      hasLeagues: data.hasLeagues ?? false,
      hasDefaultTeam: data.hasDefaultTeam ?? false,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('ESPN setup status route error', error);
    return NextResponse.json(
      { error: 'Failed to retrieve setup status' },
      { status: 500 }
    );
  }
} 
