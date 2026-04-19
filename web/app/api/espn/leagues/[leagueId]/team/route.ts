/**
 * ESPN League Team Selection API Route
 * ---------------------------------------------------------------------------
 * Proxy to auth-worker PATCH /leagues/:leagueId/team endpoint.
 * Handles saving team selection for a specific league after auto-pull.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';

const PatchBodySchema = z.object({
  teamId: z.string().min(1, 'teamId is required'),
  sport: z.string().optional(),
  teamName: z.string().optional(),
  leagueName: z.string().optional(),
  seasonYear: z.number().optional(),
});

const AuthWorkerErrorSchema = z
  .object({
    error: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();

const AuthWorkerLeagueSchema = z
  .object({
    leagueId: z.string(),
    sport: z.string(),
    teamId: z.string().nullish(),
    leagueName: z.string().nullish(),
    hasTeamSelected: z.boolean().nullish(),
  })
  .passthrough();

const PatchResponseSchema = z
  .object({
    league: AuthWorkerLeagueSchema.optional(),
  })
  .passthrough();

const ListLeaguesSchema = z
  .object({
    leagues: z.array(AuthWorkerLeagueSchema),
  })
  .passthrough();

type AuthWorkerLeague = z.infer<typeof AuthWorkerLeagueSchema>;

async function parseAuthWorkerError(response: Response): Promise<z.infer<typeof AuthWorkerErrorSchema>> {
  const raw = await response.json().catch(() => ({}));
  const parsed = AuthWorkerErrorSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { leagueId } = await params;
    const rawBody = await request.json().catch(() => null);
    const bodyParsed = PatchBodySchema.safeParse(rawBody);
    if (!bodyParsed.success) {
      const teamIdIssue = bodyParsed.error.issues.find((issue) => issue.path[0] === 'teamId');
      return NextResponse.json(
        { error: teamIdIssue?.message ?? 'Invalid request body' },
        { status: 400 },
      );
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
    const response = await fetch(`${authWorkerUrl}/leagues/${encodeURIComponent(leagueId)}/team`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bearer}`,
      },
      body: JSON.stringify({
        teamId: body.teamId,
        sport: body.sport,
        teamName: body.teamName,
        leagueName: body.leagueName,
        seasonYear: body.seasonYear
      })
    });

    if (!response.ok) {
      const errorData = await parseAuthWorkerError(response);
      console.error('Auth-worker error:', response.status, errorData);

      return NextResponse.json({
        error: errorData.error || 'Failed to save team selection',
        details: errorData.message
      }, { status: response.status });
    }

    const rawData = await response.json().catch(() => null);
    const dataParsed = PatchResponseSchema.safeParse(rawData);
    if (!dataParsed.success) {
      console.error('Auth-worker PATCH response failed validation:', dataParsed.error.issues);
      return NextResponse.json(
        { error: 'Upstream returned an unexpected response shape' },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Team selection saved successfully',
      league: dataParsed.data.league
    });

  } catch (error) {
    console.error('Team selection API error:', error);
    return NextResponse.json(
      { error: 'Failed to save team selection' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { leagueId } = await params;
    const { searchParams } = new URL(request.url);
    const sport = searchParams.get('sport');

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const bearer = await getToken?.();
    if (!bearer) {
      return NextResponse.json({ error: 'Authentication token unavailable' }, { status: 401 });
    }
    const response = await fetch(`${authWorkerUrl}/leagues`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bearer}`,
      }
    });

    if (!response.ok) {
      const errorData = await parseAuthWorkerError(response);
      console.error('Auth-worker error:', response.status, errorData);

      return NextResponse.json({
        error: errorData.error || 'Failed to retrieve leagues'
      }, { status: response.status });
    }

    const rawData = await response.json().catch(() => null);
    const dataParsed = ListLeaguesSchema.safeParse(rawData);
    if (!dataParsed.success) {
      console.error('Auth-worker leagues list failed validation:', dataParsed.error.issues);
      return NextResponse.json(
        { error: 'Upstream returned an unexpected response shape' },
        { status: 502 },
      );
    }
    const leagues = dataParsed.data.leagues;

    if (leagues.length === 0) {
      return NextResponse.json({
        error: 'No leagues found for user'
      }, { status: 404 });
    }

    const league = leagues.find((item: AuthWorkerLeague) =>
      item.leagueId === leagueId &&
      (sport ? item.sport === sport : true)
    );

    if (!league) {
      return NextResponse.json({
        error: 'League not found'
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      league: {
        leagueId: league.leagueId,
        sport: league.sport,
        teamId: league.teamId || null,
        leagueName: league.leagueName || null,
        hasTeamSelected: !!league.teamId
      }
    });

  } catch (error) {
    console.error('Team selection GET API error:', error);
    return NextResponse.json(
      { error: 'Failed to retrieve team selection' },
      { status: 500 }
    );
  }
}
