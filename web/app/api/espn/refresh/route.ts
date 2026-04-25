import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

interface SeasonCounts {
  found: number;
  added: number;
  alreadySaved: number;
}

function parseOptionalCount(value: unknown): number | null {
  if (value === undefined || value === null) return 0;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeSeasonCounts(value: unknown): SeasonCounts | null {
  if (value === undefined || value === null) {
    return { found: 0, added: 0, alreadySaved: 0 };
  }

  if (typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  const found = parseOptionalCount(record.found);
  const added = parseOptionalCount(record.added);
  const alreadySaved = parseOptionalCount(record.alreadySaved);

  if (found === null || added === null || alreadySaved === null) return null;

  return { found, added, alreadySaved };
}

function normalizeAuthWorkerUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

export async function POST() {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const authWorkerUrl = process.env.AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'AUTH_WORKER_URL not configured' }, { status: 500 });
    }

    const bearer = await getToken();
    if (!bearer) {
      return NextResponse.json({ error: 'Authentication token unavailable' }, { status: 401 });
    }

    const workerRes = await fetch(`${normalizeAuthWorkerUrl(authWorkerUrl)}/extension/discover`, {
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
      currentSeason?: unknown;
      pastSeasons?: unknown;
    } | null;

    if (!data) {
      return NextResponse.json(
        { error: 'server_error', error_description: 'Unexpected response from ESPN refresh service' },
        { status: 502 }
      );
    }

    const currentSeason = normalizeSeasonCounts(data.currentSeason);
    const pastSeasons = normalizeSeasonCounts(data.pastSeasons);

    if (!currentSeason || !pastSeasons) {
      return NextResponse.json(
        { error: 'server_error', error_description: 'Unexpected season counts from ESPN refresh service' },
        { status: 502 }
      );
    }

    return NextResponse.json({
      currentSeason,
      pastSeasons,
    });
  } catch (error) {
    console.error('ESPN refresh route error:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to refresh ESPN leagues' },
      { status: 500 }
    );
  }
}
