import { logSetupSignal } from '@flaim/worker-shared';

/**
 * Web-surface setup signals proxied through auth-worker so they land in
 * Workers Logs alongside the other setup signals (Vercel runtime logs are
 * too short-lived to measure anything over days).
 *
 * Allowlist-only: unknown event names are rejected so this endpoint can't be
 * used to spray arbitrary strings into structured logs.
 */
const WEB_SIGNAL_EVENTS = new Set(['espn_connect_ui_view']);

const WEB_SIGNAL_DEVICES = new Set(['mobile', 'desktop']);

interface WebSignalBody {
  event?: unknown;
  device?: unknown;
  connected?: unknown;
}

export async function handleWebSetupSignal(
  request: Request,
  environment: string | undefined,
  corsHeaders: Record<string, string>
): Promise<Response> {
  let body: WebSignalBody;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return jsonResponse({ error: 'invalid_json' }, 400, corsHeaders);
    }
    body = parsed as WebSignalBody;
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, corsHeaders);
  }

  const event = typeof body.event === 'string' ? body.event : '';
  if (!WEB_SIGNAL_EVENTS.has(event)) {
    return jsonResponse({ error: 'unknown_event' }, 400, corsHeaders);
  }

  const device = typeof body.device === 'string' && WEB_SIGNAL_DEVICES.has(body.device)
    ? body.device
    : undefined;
  const connected = typeof body.connected === 'boolean' ? body.connected : undefined;

  logSetupSignal({
    service: 'web',
    component: 'leagues_page',
    event,
    platform: 'espn',
    device,
    connected,
    environment,
  });

  return jsonResponse({ ok: true }, 200, corsHeaders);
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  corsHeaders: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
