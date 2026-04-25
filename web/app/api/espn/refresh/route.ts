import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

interface SeasonCounts {
  found: number;
  added: number;
  alreadySaved: number;
}

function isSeasonCounts(value: unknown): value is SeasonCounts {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).found === 'number' &&
    typeof (value as Record<string, unknown>).added === 'number' &&
    typeof (value as Record<string, unknown>).alreadySaved === 'number'
  );
}

/**
 * POST /api/espn/refresh
 * Discover and save ESPN leagues using the user's stored ESPN credentials.
 */
export async function POST() {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'AUTH_WORKER_URL not configured' }, { status: 500 });
    }

    const bearer = await getToken?.();
    if (!bearer) {
      return NextResponse.json({ error: 'Authentication token unavailable' }, { status: 401 });
    }

    const workerRes = await fetch(`${authWorkerUrl}/extension/discover`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearer}`,
      },
    });

    if (!workerRes.ok) {
      const error = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as {
        error?: string;
        error_description?: string;
      };
      return NextResponse.json(
        {
          error: error.error || 'Failed to refresh ESPN leagues',
          error_description: error.error_description,
        },
        { status: workerRes.status }
      );
    }

    const data = await workerRes.json().catch(() => null) as {
      discovered?: unknown[];
      currentSeason?: unknown;
      pastSeasons?: unknown;
    } | null;

    if (
      !data ||
      !Array.isArray(data.discovered) ||
      !isSeasonCounts(data.currentSeason) ||
      !isSeasonCounts(data.pastSeasons)
    ) {
      return NextResponse.json(
        { error: 'server_error', error_description: 'Unexpected response from ESPN refresh service' },
        { status: 502 }
      );
    }

    return NextResponse.json({
      discovered: data.discovered,
      currentSeason: data.currentSeason,
      pastSeasons: data.pastSeasons,
    });
  } catch (error) {
    console.error('ESPN refresh route error:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to refresh ESPN leagues' },
      { status: 500 }
    );
  }
}
