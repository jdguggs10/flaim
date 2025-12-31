import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

/**
 * POST /api/extension/pair
 * -----------------------------------------------------------
 * Exchange a pairing code for an access token.
 * Called by the Chrome extension popup after user enters code.
 * No authentication required - the code IS the authentication.
 * Proxies to auth-worker POST /extension/pair.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { code?: string };

    if (!body.code) {
      return NextResponse.json({
        error: 'invalid_request',
        error_description: 'code is required'
      }, { status: 400 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    // Forward client IP for rate limiting
    // Vercel/Next.js edge provides x-forwarded-for, x-real-ip headers
    const clientIP = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                     request.headers.get('x-real-ip') ||
                     request.ip ||
                     '';

    const workerRes = await fetch(`${authWorkerUrl}/extension/pair`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': clientIP,
      },
      body: JSON.stringify({ code: body.code })
    });

    if (!workerRes.ok) {
      const err = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as {
        error?: string;
        error_description?: string;
      };
      return NextResponse.json(
        { error: err.error || 'Invalid pairing code', error_description: err.error_description },
        { status: workerRes.status }
      );
    }

    const data = await workerRes.json() as {
      success?: boolean;
      token?: string;
      userId?: string;
    };

    return NextResponse.json({
      success: true,
      token: data.token,
      userId: data.userId,
    });
  } catch (error) {
    console.error('Extension pair route error:', error);
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to pair extension' },
      { status: 500 }
    );
  }
}
