// workers/fantasy-mcp/src/mcp/usage.ts
//
// Usage analytics emit (FLA-156, gateway side).
//
// Fires exactly one fire-and-forget event per MCP tool call to the auth-worker
// (POST /internal/usage-event). This is best-effort telemetry: it MUST never add
// latency to or break a tool call. Callers run it inside ctx.executionCtx.waitUntil
// with a trailing .catch(() => {}), so it executes after the response is returned
// and any failure is swallowed. Nothing here is awaited on the request path.

import { withInternalServiceToken } from '@flaim/worker-shared';
import type { McpContext } from './server';
import type { McpToolResponse } from './tools';

export type UsageStatus = 'ok' | 'error' | 'denied';

interface UsageEventBody {
  env: string;
  user_id: string;
  auth_type: string;
  client_name: string | null;
  tool_name: string;
  platform: string | null;
  sport: string | null;
  status: UsageStatus;
  error_code: string | null;
  latency_ms: number | null;
  league_hash: string | null;
  correlation_id: string | null;
}

/** Best-effort string extraction from an unknown args/result field. */
function asStringOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  return null;
}

/**
 * SHA-256 hex of `<platform>:<league_id>`. Returns null when league_id is absent.
 * Pseudonymizes the league identity so analytics never stores raw league IDs.
 */
async function computeLeagueHash(args: Record<string, unknown>): Promise<string | null> {
  const leagueId = asStringOrNull(args.league_id);
  if (!leagueId) return null;
  const platform = asStringOrNull(args.platform) ?? '';
  const input = `${platform}:${leagueId}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Best-effort structured error code from the tool result (often null). */
function extractErrorCode(result?: McpToolResponse): string | null {
  const code = result?.structuredContent?.code;
  if (typeof code === 'string' && code.length > 0) return code;
  if (typeof code === 'number') return String(code);
  return null;
}

/**
 * Build and POST a single usage event to the auth-worker. Intended to be wrapped
 * in waitUntil(...).catch(() => {}). Being an async function, any synchronous
 * throw (e.g. missing INTERNAL_SERVICE_TOKEN) surfaces as a rejected promise that
 * the caller's .catch swallows — it never reaches the request path.
 */
export async function emitUsageEvent(
  ctx: McpContext,
  toolName: string,
  args: Record<string, unknown>,
  status: UsageStatus,
  latencyMs: number | null,
  result?: McpToolResponse,
): Promise<void> {
  // No user_id means no useful analytics row — skip the POST entirely so we
  // never write blank-user junk. introspect normally guarantees userId; this is
  // the rare valid-without-userId guard.
  if (!ctx.userId) return;

  const leagueHash = await computeLeagueHash(args);

  const body: UsageEventBody = {
    // ENVIRONMENT only ('prod' | 'preview' | 'dev'). Intentionally no NODE_ENV
    // fallback — that would emit Node's 'production' instead of our 'prod'.
    env: ctx.env.ENVIRONMENT ?? 'unknown',
    user_id: ctx.userId ?? '',
    auth_type: ctx.authType ?? 'unknown',
    client_name: ctx.clientName ?? null,
    tool_name: toolName,
    platform: asStringOrNull(args.platform),
    sport: asStringOrNull(args.sport),
    status,
    error_code: extractErrorCode(result),
    latency_ms: latencyMs,
    league_hash: leagueHash,
    correlation_id: ctx.correlationId ?? null,
  };

  const headers = withInternalServiceToken(
    { 'Content-Type': 'application/json' },
    ctx.env,
    'auth-worker /internal/usage-event',
  );

  await ctx.env.AUTH_WORKER.fetch(
    new Request('https://internal/internal/usage-event', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  );
}
