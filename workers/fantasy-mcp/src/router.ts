// workers/fantasy-mcp/src/router.ts
import type { Env, Platform, ToolParams } from './types';
import { withCorrelationId, withEvalHeaders } from '@flaim/worker-shared';

export interface RouteResult {
  success: boolean;
  data?: unknown;
  error?: string;
  code?: string;
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
    return {
      success: false,
      error: `Platform "${platform}" is not yet supported`,
      code: 'PLATFORM_NOT_SUPPORTED'
    };
  }

  // Forward request to platform worker
  try {
    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authHeader) {
      baseHeaders['Authorization'] = authHeader;
    }
    const withCorrelation = correlationId ? withCorrelationId(baseHeaders, correlationId) : new Headers(baseHeaders);
    const headers = withEvalHeaders(withCorrelation, evalRunId, evalTraceId);

    const response = await client.fetch(
      new Request('https://internal/execute', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tool,
          params,
          authHeader
        })
      })
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { error?: string; code?: string };
      return {
        success: false,
        error: errorData.error || `Platform worker returned ${response.status}`,
        code: errorData.code || 'PLATFORM_ERROR'
      };
    }

    return await response.json() as RouteResult;
  } catch (error) {
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
    default:
      return null;
  }
}
