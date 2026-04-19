/**
 * Default League API Route
 * ---------------------------------------------------------------------------
 * Sets a league as the user's default for a sport (works for ESPN, Yahoo, and Sleeper).
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';

const VALID_PLATFORMS = ['espn', 'yahoo', 'sleeper'] as const;
const VALID_SPORTS = ['football', 'baseball', 'basketball', 'hockey'] as const;

const DefaultLeagueBodySchema = z.object({
  platform: z.enum(VALID_PLATFORMS),
  leagueId: z.string().min(1),
  sport: z.enum(VALID_SPORTS),
  seasonYear: z.number().int().min(2000).max(2100),
});

const AuthWorkerErrorSchema = z
  .object({
    error: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

const LeagueDefaultSchema = z
  .object({
    platform: z.enum(VALID_PLATFORMS),
    leagueId: z.string(),
    seasonYear: z.number().int(),
  })
  .passthrough();

const PreferencesSchema = z
  .object({
    defaultSport: z.enum(VALID_SPORTS).nullish(),
    defaultFootball: LeagueDefaultSchema.nullish(),
    defaultBaseball: LeagueDefaultSchema.nullish(),
    defaultBasketball: LeagueDefaultSchema.nullish(),
    defaultHockey: LeagueDefaultSchema.nullish(),
  })
  .passthrough();

const SetDefaultResponseSchema = z
  .object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    preferences: PreferencesSchema.optional(),
  })
  .passthrough();

const ClearDefaultResponseSchema = z
  .object({
    success: z.boolean().optional(),
    preferences: PreferencesSchema.optional(),
  })
  .passthrough();

const SportSchema = z.enum(VALID_SPORTS);

async function parseAuthWorkerError(response: Response): Promise<z.infer<typeof AuthWorkerErrorSchema>> {
  const raw = await response.json().catch(() => ({}));
  const parsed = AuthWorkerErrorSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

export async function POST(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const rawBody = await request.json().catch(() => null);
    if (!rawBody || typeof rawBody !== 'object') {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const bodyRecord = rawBody as Record<string, unknown>;
    if (
      bodyRecord.platform === undefined ||
      bodyRecord.leagueId === undefined ||
      bodyRecord.sport === undefined ||
      bodyRecord.seasonYear === undefined
    ) {
      return NextResponse.json({
        error: 'platform, leagueId, sport, and seasonYear are required in request body'
      }, { status: 400 });
    }

    const bodyParsed = DefaultLeagueBodySchema.safeParse(rawBody);
    if (!bodyParsed.success) {
      const invalidField = bodyParsed.error.issues[0]?.path[0];
      if (invalidField === 'platform') {
        return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
      }
      if (invalidField === 'sport') {
        return NextResponse.json({ error: 'Invalid sport' }, { status: 400 });
      }
      if (invalidField === 'seasonYear') {
        return NextResponse.json({ error: 'Invalid seasonYear' }, { status: 400 });
      }
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const body = bodyParsed.data;

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const bearer = await getToken?.();
    if (!bearer) {
      return NextResponse.json({ error: 'Authentication token unavailable' }, { status: 401 });
    }
    const workerResponse = await fetch(`${authWorkerUrl}/leagues/default`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bearer}`,
      },
      body: JSON.stringify(body)
    });

    if (!workerResponse.ok) {
      const errorData = await parseAuthWorkerError(workerResponse);
      return NextResponse.json({
        error: errorData.error || 'Failed to set default league'
      }, { status: workerResponse.status });
    }

    const rawData = await workerResponse.json().catch(() => null);
    const parsedData = SetDefaultResponseSchema.safeParse(rawData);
    if (!parsedData.success) {
      console.error('Default league POST response failed validation:', parsedData.error.issues);
      return NextResponse.json(
        { error: 'Upstream returned an unexpected response shape' },
        { status: 502 },
      );
    }

    return NextResponse.json(parsedData.data, { status: 200 });

  } catch (error) {
    console.error('Default league API error:', error);
    return NextResponse.json({
      error: 'Failed to set default league'
    }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const rawSport = searchParams.get('sport');

    if (!rawSport) {
      return NextResponse.json({ error: 'sport query param is required' }, { status: 400 });
    }
    const sportParsed = SportSchema.safeParse(rawSport);
    if (!sportParsed.success) {
      return NextResponse.json({ error: 'Invalid sport' }, { status: 400 });
    }
    const sport = sportParsed.data;

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const bearer = await getToken?.();
    if (!bearer) {
      return NextResponse.json({ error: 'Authentication token unavailable' }, { status: 401 });
    }
    const workerResponse = await fetch(`${authWorkerUrl}/leagues/default/${encodeURIComponent(sport)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${bearer}` }
    });

    if (!workerResponse.ok) {
      const errorData = await parseAuthWorkerError(workerResponse);
      return NextResponse.json({
        error: errorData.error || 'Failed to clear default league'
      }, { status: workerResponse.status });
    }

    const rawData = await workerResponse.json().catch(() => null);
    const parsedData = ClearDefaultResponseSchema.safeParse(rawData);
    if (!parsedData.success) {
      console.error('Default league DELETE response failed validation:', parsedData.error.issues);
      return NextResponse.json(
        { error: 'Upstream returned an unexpected response shape' },
        { status: 502 },
      );
    }

    return NextResponse.json(parsedData.data, { status: 200 });

  } catch (error) {
    console.error('Clear default league API error:', error);
    return NextResponse.json({ error: 'Failed to clear default league' }, { status: 500 });
  }
}
