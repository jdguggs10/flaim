/**
 * League Archive API Route
 * ---------------------------------------------------------------------------
 * Proxies the manual league archive endpoints to the Auth-Worker (FLA-124).
 *
 * - GET    → list the user's suppressed leagues (feeds the Inactive/Hidden UI sections)
 * - POST   → set a league's archive mode (hide it from the AI's active view; survives re-sync)
 * - DELETE → unarchive a league (restore it to the visible/AI surfaces)
 *
 * Body for POST: { platform, sport, recurringLeagueId, mode }, where `mode` is
 * 'historical' (Archive — still browsable for past seasons) or 'hidden' (Hide —
 * completely hidden from the AI); it defaults to 'historical' when omitted.
 * Body for DELETE: { platform, sport, recurringLeagueId }. All three platforms
 * (ESPN, Yahoo, Sleeper) support the three-state visibility flow.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

type ArchiveMode = 'historical' | 'hidden';

interface ArchiveRequestBody {
  platform?: string;
  sport?: string;
  recurringLeagueId?: string;
  mode?: ArchiveMode;
}

// Shared auth/url/token resolution for the GET/POST/DELETE handlers. Returns the
// bearer token + worker URL, or a NextResponse to return early when something is
// missing (callers check via `instanceof NextResponse`).
async function getArchiveAuthContext(): Promise<{ bearer: string; workerUrl: string } | NextResponse> {
  const { userId, getToken } = await auth();
  if (!userId) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const workerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
  if (!workerUrl) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_AUTH_WORKER_URL is not configured' }, { status: 500 });
  }

  const bearer = await getToken();
  if (!bearer) {
    return NextResponse.json({ error: 'Authentication token unavailable' }, { status: 401 });
  }

  return { bearer, workerUrl };
}

// Intentional aggregate archived-leagues feed across all platforms. The leagues page
// currently derives `archived` from the per-platform endpoints, so this is not on the
// hot path — it's kept for future use (e.g. a dedicated archived-leagues view) and is
// not dead code.
export async function GET() {
  try {
    const authContext = await getArchiveAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { bearer, workerUrl } = authContext;

    const workerResponse = await fetch(`${workerUrl}/leagues/archive`, {
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
    const authContext = await getArchiveAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { bearer, workerUrl } = authContext;

    const body = await request.json() as ArchiveRequestBody;
    if (!body.platform || !body.sport || !body.recurringLeagueId) {
      return NextResponse.json({
        error: 'platform, sport, and recurringLeagueId are required',
      }, { status: 400 });
    }
    // `mode` is optional; the Auth-Worker defaults it to 'historical'. Validate it
    // when present so only the two supported modes are forwarded.
    if (body.mode !== undefined && body.mode !== 'historical' && body.mode !== 'hidden') {
      return NextResponse.json({
        error: "mode must be 'historical' or 'hidden'",
      }, { status: 400 });
    }

    const workerResponse = await fetch(`${workerUrl}/leagues/archive`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bearer}`,
      },
      body: JSON.stringify({
        platform: body.platform,
        sport: body.sport,
        recurringLeagueId: body.recurringLeagueId,
        ...(body.mode !== undefined ? { mode: body.mode } : {}),
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
    const authContext = await getArchiveAuthContext();
    if (authContext instanceof NextResponse) {
      return authContext;
    }
    const { bearer, workerUrl } = authContext;

    const body = await request.json() as ArchiveRequestBody;
    if (!body.platform || !body.sport || !body.recurringLeagueId) {
      return NextResponse.json({
        error: 'platform, sport, and recurringLeagueId are required',
      }, { status: 400 });
    }

    const workerResponse = await fetch(`${workerUrl}/leagues/archive`, {
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
