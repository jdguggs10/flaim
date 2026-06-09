// workers/fantasy-mcp/src/router.ts
import type { Env, Platform, ToolParams } from './types';
import {
  logSetupSignal,
  parseRetryAfterSeconds,
  withCorrelationId,
  withEvalHeaders,
  withInternalServiceToken,
  type SetupSignalEvent,
} from '@flaim/worker-shared';

export interface RouteResult {
  success: boolean;
  data?: unknown;
  error?: string;
  code?: string;
  status?: number;
  upstream_status?: number;
  retryable?: boolean;
  retry_after?: number;
  retry_after_source?: string;
}

function logPlatformToolFailure(
  env: Env,
  params: ToolParams,
  correlationId: string | undefined,
  fields: Omit<SetupSignalEvent, 'service' | 'component' | 'event' | 'outcome' | 'platform' | 'sport' | 'season_year' | 'correlation_id'>
): void {
  logSetupSignal({
    service: 'fantasy-mcp',
    component: 'platform-router',
    event: 'platform_tool_failed',
    platform: params.platform,
    sport: params.sport,
    season_year: params.season_year,
    correlation_id: correlationId,
    environment: env.ENVIRONMENT || env.NODE_ENV,
    ...fields,
    outcome: 'failure',
  } as SetupSignalEvent & Record<string, unknown>);
}

/**
 * Route a tool call to the appropriate platform worker via service binding.
 */
export async function routeToClient(
  env: Env,
  tool: string,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string,
  evalRunId?: string,
  evalTraceId?: string
): Promise<RouteResult> {
  const { platform } = params;

  // Select the service binding based on platform
  const client = selectClient(env, platform);
  if (!client) {
    logPlatformToolFailure(env, params, correlationId, {
      stage: 'service_binding',
      failure_kind: 'configuration',
      error_code: 'PLATFORM_NOT_SUPPORTED',
    });
    return {
      success: false,
      error: `Platform "${platform}" is not yet supported`,
      code: 'PLATFORM_NOT_SUPPORTED'
    };
  }

  // Forward request to platform worker
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  try {
    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authHeader) {
      baseHeaders['Authorization'] = authHeader;
    }
    const withCorrelation = correlationId ? withCorrelationId(baseHeaders, correlationId) : new Headers(baseHeaders);
    const withInternal = withInternalServiceToken(withCorrelation, env, `platform worker "${platform}" /execute`);
    const headers = withEvalHeaders(withInternal, evalRunId, evalTraceId);

    const response = await client.fetch(
      new Request('https://internal/execute', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tool,
          params,
        }),
        signal: controller.signal,
      })
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as {
        error?: string;
        code?: string;
        upstream_status?: number;
        retryable?: boolean;
        retry_after?: number;
        retry_after_source?: string;
      };
      const retryAfter = parseRetryAfterSeconds(response.headers.get('Retry-After')) ?? errorData.retry_after;
      logPlatformToolFailure(env, params, correlationId, {
        stage: 'platform_worker_response',
        failure_kind: errorData.retryable ? 'retryable_upstream' : 'upstream',
        error_code: errorData.code || 'PLATFORM_ERROR',
        http_status: response.status,
        upstream_status: errorData.upstream_status,
        retryable: errorData.retryable,
        retry_after: retryAfter,
        retry_after_source: errorData.retry_after_source,
      });
      return {
        success: false,
        error: errorData.error || `Platform worker returned ${response.status}`,
        code: errorData.code || 'PLATFORM_ERROR',
        status: response.status,
        upstream_status: errorData.upstream_status,
        retryable: errorData.retryable,
        retry_after: retryAfter,
        retry_after_source: errorData.retry_after_source,
      };
    }

    return await response.json() as RouteResult;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      logPlatformToolFailure(env, params, correlationId, {
        stage: 'platform_worker_fetch',
        failure_kind: 'timeout',
        error_code: 'ROUTING_ERROR',
      });
      return {
        success: false,
        error: `Platform worker "${platform}" timed out after 25s`,
        code: 'ROUTING_ERROR',
      };
    }
    logPlatformToolFailure(env, params, correlationId, {
      stage: 'platform_worker_fetch',
      failure_kind: 'fetch_error',
      error_code: 'ROUTING_ERROR',
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to reach platform worker',
      code: 'ROUTING_ERROR'
    };
  }
}

function selectClient(env: Env, platform: Platform): Fetcher | null {
  switch (platform) {
    case 'espn':
      return env.ESPN;
    case 'yahoo':
      return env.YAHOO;
    case 'sleeper':
      return env.SLEEPER;
    default:
      return null;
  }
}
