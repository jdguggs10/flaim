import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/extension/history
 * Caller-owned ESPN history status for the extension popup.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      return NextResponse.json({ error: 'unauthorized', error_description: 'Missing Authorization header' }, { status: 401 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const workerRes = await fetch(`${authWorkerUrl.replace(/\/+$/, '')}/history/espn`, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: authHeader },
      cache: 'no-store',
    });
    const data = await workerRes.json().catch(() => ({ error: 'Unknown error' }));
    return NextResponse.json(data, {
      status: workerRes.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('Extension ESPN history status route error:', error);
    return NextResponse.json({ error: 'server_error', error_description: 'Failed to get ESPN history status' }, { status: 500 });
  }
}
