import {
  LEGACY_USER_SESSION_WIDGET_URI,
  USER_SESSION_WIDGET_URI,
} from '../widgets/user-session-widget';

const PUBLIC_STATIC_WIDGET_URIS = new Set([
  LEGACY_USER_SESSION_WIDGET_URI,
  USER_SESSION_WIDGET_URI,
]);

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

/**
 * The widget template is public static HTML. ChatGPT may fetch it without the
 * user's OAuth header after authenticated tool discovery. Keep this exception
 * exact: list only this server's two static widgets, and read only their pinned
 * URIs. User-data tools remain behind the normal auth gate.
 */
export async function isPublicStaticWidgetResourceRequest(request: Request): Promise<boolean> {
  if (request.method !== 'POST') {
    return false;
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return false;
  }

  try {
    const payload = await request.clone().json() as {
      method?: unknown;
      params?: { uri?: unknown };
    };
    if (payload?.method === 'resources/list') {
      return true;
    }
    if (payload?.method !== 'resources/read') {
      return false;
    }
    const uri = payload.params?.uri;
    return typeof uri === 'string' && PUBLIC_STATIC_WIDGET_URIS.has(uri);
  } catch {
    return false;
  }
}
