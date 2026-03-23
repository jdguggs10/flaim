import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * GET /api/connect/yahoo/authorize
 * Initiates Yahoo OAuth flow.
 * Proxies to auth-worker which returns a 302 redirect to Yahoo.
 */
export async function GET() {
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
    const workerRes = await fetch(`${authWorkerUrl}/connect/yahoo/authorize`, {
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'X-Forwarded-Origin': process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '',
      },
    });

    // auth-worker returns 302 with Location header
    const location = workerRes.headers.get('Location');
    if (workerRes.status === 302 && location) {
      // Validate redirect target to prevent open redirect attacks
      try {
        const redirectUrl = new URL(location);
        if (redirectUrl.hostname !== 'api.login.yahoo.com' && !redirectUrl.hostname.endsWith('.yahoo.com')) {
          console.error('Yahoo authorize: unexpected redirect target:', redirectUrl.hostname);
          return NextResponse.json({ error: 'Invalid redirect target' }, { status: 502 });
        }
      } catch (e) {
        console.error('Yahoo authorize: failed to parse redirect URL', e);
        return NextResponse.json({ error: 'Invalid redirect URL' }, { status: 502 });
      }
      return NextResponse.redirect(location);
    }

    // If not a redirect, proxy the error
    const data = await workerRes.json().catch(() => ({ error: 'Unknown error' }));
    return NextResponse.json(data, { status: workerRes.status });
  } catch (error) {
    console.error('Yahoo authorize route error:', error);
    return NextResponse.json({ error: 'Failed to start Yahoo connection' }, { status: 500 });
  }
}
