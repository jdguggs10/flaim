export function normalizeMcpAcceptHeader(request: Request): Request {
  const headers = new Headers(request.headers);
  const accept = headers.get('Accept') || '';
  const hasJson = accept.includes('application/json');
  const hasEventStream = accept.includes('text/event-stream');

  if (hasJson && hasEventStream) {
    return request;
  }

  headers.set('Accept', 'application/json, text/event-stream');
  return new Request(request, { headers });
}

export async function isPublicMcpHandshakeRequest(request: Request): Promise<boolean> {
  if (request.method === 'GET') {
    return true;
  }

  if (request.method !== 'POST') {
    return false;
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return false;
  }

  try {
    const payload = await request.clone().json() as { method?: unknown };
    const method = typeof payload?.method === 'string' ? payload.method : '';
    return method === 'initialize' || method === 'notifications/initialized' || method === 'tools/list';
  } catch {
    return false;
  }
}
