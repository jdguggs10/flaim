import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * POST /api/extension/sync
 * -----------------------------------------------------------
 * Sync ESPN credentials from the Chrome extension.
 * Called by the extension after capturing cookies from ESPN.
 * Requires Bearer token authentication (Clerk JWT).
 * Proxies to auth-worker POST /extension/sync.
 */

const ExtensionSyncBodySchema = z.object({
  swid: z.string().regex(/^\{[0-9A-Fa-f-]{36}\}$/, 'Invalid SWID format (expected UUID in curly braces)'),
  s2: z.string().min(50, 'Invalid espn_s2 format (too short)'),
});

const AuthWorkerErrorSchema = z
  .object({
    error: z.string().optional(),
    error_description: z.string().optional(),
  })
  .passthrough();

const AuthWorkerSuccessSchema = z
  .object({
    success: z.boolean().optional(),
    message: z.string().optional(),
  })
  .passthrough();

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 10000
): Promise<{ response: Response; data: unknown }> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const rawText = await response.text();

    let data: unknown = null;
    if (rawText) {
      try {
        data = JSON.parse(rawText) as unknown;
      } catch {
        data = null;
      }
    }

    return { response, data };
  } catch (error) {
    if (timedOut && error instanceof Error && error.name === 'AbortError') {
      throw new TimeoutError('Extension sync timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseAuthWorkerError(raw: unknown): z.infer<typeof AuthWorkerErrorSchema> {
  const parsed = AuthWorkerErrorSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const bearerToken = authHeader?.match(/^bearer\s+(.+)$/i)?.[1]?.trim();
    if (!bearerToken) {
      return NextResponse.json({
        error: 'unauthorized',
        error_description: 'Missing Authorization header'
      }, { status: 401 });
    }

    const rawBody = await request.json().catch(() => null);
    if (!rawBody || typeof rawBody !== 'object') {
      return NextResponse.json({
        error: 'invalid_request',
        error_description: 'Invalid request body'
      }, { status: 400 });
    }

    const bodyRecord = rawBody as Record<string, unknown>;
    if (bodyRecord.swid === undefined || bodyRecord.s2 === undefined) {
      return NextResponse.json({
        error: 'invalid_request',
        error_description: 'swid and s2 are required'
      }, { status: 400 });
    }
    const bodyParsed = ExtensionSyncBodySchema.safeParse(rawBody);
    if (!bodyParsed.success) {
      return NextResponse.json({
        error: 'invalid_request',
        error_description: bodyParsed.error.issues[0]?.message || 'Invalid request body'
      }, { status: 400 });
    }
    const body = bodyParsed.data;

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const { response: workerRes, data: workerData } = await fetchJsonWithTimeout(`${authWorkerUrl}/extension/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({ swid: body.swid, s2: body.s2 })
    }, 10000);

    if (!workerRes.ok) {
      const err = parseAuthWorkerError(workerData);
      return NextResponse.json(
        { error: err.error || 'Failed to sync credentials', error_description: err.error_description },
        { status: workerRes.status }
      );
    }

    const dataParsed = AuthWorkerSuccessSchema.safeParse(workerData);
    if (!dataParsed.success) {
      console.error('Extension sync upstream response failed validation:', dataParsed.error.issues);
      return NextResponse.json(
        { error: 'bad_gateway', error_description: 'Upstream returned an unexpected response shape' },
        { status: 502 }
      );
    }
    const data = dataParsed.data;

    return NextResponse.json({
      success: true,
      message: data.message || 'Credentials synced successfully',
    });
  } catch (error) {
    if (error instanceof TimeoutError) {
      return NextResponse.json(
        { error: 'gateway_timeout', error_description: error.message },
        { status: 504 }
      );
    }
    console.error('Extension sync route error:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to sync credentials' },
      { status: 500 }
    );
  }
}
