/**
 * League Archive API Route
 * ---------------------------------------------------------------------------
 * Proxies the manual league archive endpoints to the Auth-Worker (FLA-124).
 *
 * - GET    → list the user's archived leagues (feeds the Archived UI section)
 * - POST   → archive a league (hide it from the AI; survives re-sync)
 * - DELETE → unarchive a league (restore it to the visible/AI surfaces)
 *
 * Body for POST/DELETE: { platform, sport, recurringLeagueId }. ESPN + Sleeper
 * only — Yahoo archive is gated to Phase 1b (D9), enforced by the Auth-Worker.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

interface ArchiveRequestBody {
  platform?: string;
  sport?: string;
  recurringLeagueId?: string;
}

// Intentional aggregate archived-leagues feed across all platforms. The leagues page
// currently derives `archived` from the per-platform endpoints, so this is not on the
// hot path — it's kept for future use (e.g. a dedicated archived-leagues view) and is
// not dead code.
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

    const bearer = await getToken?.();
    if (!bearer) {
      return NextResponse.json({ error: 'Authentication token unavailable' }, { status: 401 });
    }

    const workerResponse = await fetch(`${authWorkerUrl}/leagues/archive`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bearer}`,
      },
    });

    if (workerResponse.status === 404) {
      return NextResponse.json({ leagues: [] }, { status: 200 });
    }

    const data = await workerResponse.json().catch(() => ({ error: 'Unknown error' })) as Record<string, unknown>;
    return NextResponse.json(data, { status: workerResponse.status });
  } catch (error) {
    console.error('Archived leagues GET API error:', error);
    return NextResponse.json({ error: 'Failed to fetch archived leagues' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json() as ArchiveRequestBody;
    if (!body.platform || !body.sport || !body.recurringLeagueId) {
      return NextResponse.json({
        error: 'platform, sport, and recurringLeagueId are required',
      }, { status: 400 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const bearer = await getToken?.();
    if (!bearer) {
      return NextResponse.json({ error: 'Authentication token unavailable' }, { status: 401 });
    }

    const workerResponse = await fetch(`${authWorkerUrl}/leagues/archive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bearer}`,
      },
      body: JSON.stringify({
        platform: body.platform,
        sport: body.sport,
        recurringLeagueId: body.recurringLeagueId,
      }),
    });

    const data = await workerResponse.json().catch(() => ({ error: 'Unknown error' })) as Record<string, unknown>;
    return NextResponse.json(data, { status: workerResponse.status });
  } catch (error) {
    console.error('Archive league POST API error:', error);
    return NextResponse.json({ error: 'Failed to archive league' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json() as ArchiveRequestBody;
    if (!body.platform || !body.sport || !body.recurringLeagueId) {
      return NextResponse.json({
        error: 'platform, sport, and recurringLeagueId are required',
      }, { status: 400 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const bearer = await getToken?.();
    if (!bearer) {
      return NextResponse.json({ error: 'Authentication token unavailable' }, { status: 401 });
    }

    const workerResponse = await fetch(`${authWorkerUrl}/leagues/archive`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bearer}`,
      },
      body: JSON.stringify({
        platform: body.platform,
        sport: body.sport,
        recurringLeagueId: body.recurringLeagueId,
      }),
    });

    const data = await workerResponse.json().catch(() => ({ error: 'Unknown error' })) as Record<string, unknown>;
    return NextResponse.json(data, { status: workerResponse.status });
  } catch (error) {
    console.error('Unarchive league DELETE API error:', error);
    return NextResponse.json({ error: 'Failed to unarchive league' }, { status: 500 });
  }
}
