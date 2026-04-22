// workers/espn-client/src/index.ts
import { Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, ExecuteRequest, ExecuteResponse, RoutedToolParams, Sport } from './types';
import { baseballHandlers } from './sports/baseball/handlers';
import { basketballHandlers } from './sports/basketball/handlers';
import { footballHandlers } from './sports/football/handlers';
import { hockeyHandlers } from './sports/hockey/handlers';
import {
  CORRELATION_ID_HEADER,
  EVAL_RUN_HEADER,
  EVAL_TRACE_HEADER,
  extractErrorCode,
  getCorrelationId,
  getEvalContext,
  validateInternalService,
} from '@flaim/worker-shared';
import { withSeasonContext } from './shared/season';
import { logEvalEvent } from './logging';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

async function requireInternalService(c: Context<{ Bindings: Env }>, target: string): Promise<Response | null> {
  const result = await validateInternalService(c.req.raw, c.env, target);
  if (!result.authorized) return c.json(result.error, result.status);
  return null;
}

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'espn-client',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Main execute endpoint - called by fantasy-mcp gateway via service binding
app.post('/execute', async (c) => {
  const internalAuthError = await requireInternalService(c, '/execute');
  if (internalAuthError) return internalAuthError;

  const correlationId = getCorrelationId(c.req.raw);
  const { evalRunId, evalTraceId } = getEvalContext(c.req.raw);
  const body = await c.req.json<ExecuteRequest>();
  const { tool, params } = body;
  const authHeader = c.req.header('Authorization');
  const { sport, league_id, season_year } = params;
  const routedParams = withSeasonContext(params);
  const { espnYear } = routedParams.seasonContext;

  const startTime = Date.now();
  console.log(`[espn-client] ${correlationId} ${tool} ${sport} league=${league_id} season=${season_year} espnSeason=${espnYear}`);
  logEvalEvent({
    service: 'espn-client',
    phase: 'execute_start',
    correlation_id: correlationId,
    run_id: evalRunId,
    trace_id: evalTraceId,
    tool,
    sport,
    league_id,
    message: `${tool} ${sport} league=${league_id} season=${season_year} espnSeason=${espnYear}`,
  });

  // Route to sport-specific handler
  try {
    const result = await routeToSport(c.env, sport, tool, routedParams, authHeader, correlationId);
    const duration = Date.now() - startTime;
    console.log(`[espn-client] ${correlationId} ${tool} ${sport} completed in ${duration}ms success=${result.success}`);
    logEvalEvent({
      service: 'espn-client',
      phase: 'execute_end',
      correlation_id: correlationId,
      run_id: evalRunId,
      trace_id: evalTraceId,
      tool,
      sport,
      league_id,
      duration_ms: duration,
      status: String(result.success),
      message: `${tool} ${sport} completed success=${result.success}`,
    });
    const response = c.json(result);
    response.headers.set(CORRELATION_ID_HEADER, correlationId);
    if (evalRunId) response.headers.set(EVAL_RUN_HEADER, evalRunId);
    if (evalTraceId) response.headers.set(EVAL_TRACE_HEADER, evalTraceId);
    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[espn-client] ${correlationId} ${tool} ${sport} failed in ${duration}ms: ${message}`);
    logEvalEvent({
      service: 'espn-client',
      phase: 'execute_error',
      correlation_id: correlationId,
      run_id: evalRunId,
      trace_id: evalTraceId,
      tool,
      sport,
      league_id,
      duration_ms: duration,
      status: 'error',
      message: `${tool} ${sport} failed`,
      error: message,
    });
    const response = c.json({
      success: false,
      error: message,
      code: extractErrorCode(error),
    } satisfies ExecuteResponse, 500);
    response.headers.set(CORRELATION_ID_HEADER, correlationId);
    if (evalRunId) response.headers.set(EVAL_RUN_HEADER, evalRunId);
    if (evalTraceId) response.headers.set(EVAL_TRACE_HEADER, evalTraceId);
    return response;
  }
});

async function routeToSport(
  env: Env,
  sport: Sport,
  tool: string,
  params: RoutedToolParams,
  authHeader?: string,
  correlationId?: string
): Promise<ExecuteResponse> {
  switch (sport) {
    case 'football': {
      const handler = footballHandlers[tool];
      if (!handler) {
        return {
          success: false,
          error: `Unknown football tool: ${tool}`,
          code: 'UNKNOWN_TOOL'
        };
      }
      return handler(env, params, authHeader, correlationId);
    }

    case 'baseball': {
      const handler = baseballHandlers[tool];
      if (!handler) {
        return {
          success: false,
          error: `Unknown baseball tool: ${tool}`,
          code: 'UNKNOWN_TOOL'
        };
      }
      return handler(env, params, authHeader, correlationId);
    }

    case 'basketball': {
      const handler = basketballHandlers[tool];
      if (!handler) {
        return {
          success: false,
          error: `Unknown basketball tool: ${tool}`,
          code: 'UNKNOWN_TOOL'
        };
      }
      return handler(env, params, authHeader, correlationId);
    }

    case 'hockey': {
      const handler = hockeyHandlers[tool];
      if (!handler) {
        return {
          success: false,
          error: `Unknown hockey tool: ${tool}`,
          code: 'UNKNOWN_TOOL'
        };
      }
      return handler(env, params, authHeader, correlationId);
    }

    default:
      return { success: false, error: `Unknown sport: ${sport}`, code: 'INVALID_SPORT' };
  }
}

// 404 handler
app.notFound((c) => {
  return c.json({
    error: 'Endpoint not found',
    endpoints: {
      '/health': 'GET - Health check',
      '/execute': 'POST - Execute tool (called by gateway)'
    }
  }, 404);
});

export default app;
