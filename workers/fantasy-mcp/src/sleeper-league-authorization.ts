import type { Env, ToolParams } from './types';
import {
  withCorrelationId,
  withEvalHeaders,
  withInternalServiceToken,
} from '@flaim/worker-shared';
import type { RouteResult } from './router';

const AUTHORIZATION_TIMEOUT_MS = 5_000;

/**
 * Restrict Sleeper reads to league seasons previously discovered for the
 * authenticated user's configured Sleeper identity. Historical rows remain
 * eligible; explicitly hidden rows stay unavailable, matching the existing
 * get_ancient_history archive semantics.
 */
export async function authorizeSleeperLeague(
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string,
  evalRunId?: string,
  evalTraceId?: string,
): Promise<RouteResult | undefined> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AUTHORIZATION_TIMEOUT_MS);

  try {
    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    };
    const withCorrelation = correlationId
      ? withCorrelationId(baseHeaders, correlationId)
      : new Headers(baseHeaders);
    const withInternal = withInternalServiceToken(
      withCorrelation,
      env,
      'auth-worker /internal/leagues/sleeper authorization',
    );
    const headers = withEvalHeaders(withInternal, evalRunId, evalTraceId);
    const query = new URLSearchParams({
      league_id: params.league_id,
      sport: params.sport,
      season_year: String(params.season_year),
    });
    const response = await env.AUTH_WORKER.fetch(
      new Request(`https://internal/internal/leagues/sleeper/authorize?${query}`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      }),
    );

    if (!response.ok) {
      return unavailable(response.status);
    }

    const body = await readJsonBeforeAbort(response, controller.signal).catch(() => undefined) as { allowed?: unknown } | undefined;
    if (controller.signal.aborted) {
      return unavailable(undefined, true);
    }
    if (!body || typeof body.allowed !== 'boolean') {
      return unavailable();
    }

    if (body.allowed) return undefined;

    return {
      success: false,
      code: 'SLEEPER_LEAGUE_NOT_CONNECTED',
      status: 403,
      error: 'This Sleeper league is not connected to your Flaim account. Refresh your Sleeper leagues in Flaim, then use a league from get_user_session or get_ancient_history.',
    };
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    return unavailable(undefined, isTimeout);
  } finally {
    clearTimeout(timeoutId);
  }
}

function readJsonBeforeAbort(response: Response, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(new DOMException('The operation was aborted.', 'AbortError'));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener('abort', onAbort, { once: true });
    response.json().then(
      (body) => {
        cleanup();
        resolve(body);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function unavailable(upstreamStatus?: number, timedOut = false): RouteResult {
  return {
    success: false,
    code: 'SLEEPER_LEAGUE_AUTHORIZATION_UNAVAILABLE',
    status: 503,
    ...(upstreamStatus !== undefined ? { upstream_status: upstreamStatus } : {}),
    retryable: true,
    error: timedOut
      ? 'Sleeper league authorization timed out. Try again shortly.'
      : 'Sleeper league authorization is temporarily unavailable. Try again shortly.',
  };
}
