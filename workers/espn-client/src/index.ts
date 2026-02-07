// workers/espn-client/src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, ExecuteRequest, ExecuteResponse, Sport, ToolParams } from './types';
import { baseballHandlers } from './sports/baseball/handlers';
import { footballHandlers } from './sports/football/handlers';
import {
  CORRELATION_ID_HEADER,
  EVAL_RUN_HEADER,
  EVAL_TRACE_HEADER,
  getCorrelationId,
  getEvalContext,
} from '@flaim/worker-shared';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { discoverSeasons, initializeOnboarding } from './onboarding/handlers';
import { toEspnSeasonYear } from './shared/season';
import { logEvalEvent } from './logging';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'espn-client',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Onboarding initialize endpoint (manual ESPN flow)
app.post('/onboarding/initialize', async (c) => {
  const correlationId = getCorrelationId(c.req.raw);
  const authHeader = c.req.header('Authorization');
  const body = await c.req.json().catch(() => ({})) as {
    sport?: string;
    leagueId?: string;
    seasonYear?: number;
  };

  const result = await initializeOnboarding(c.env, body, authHeader, correlationId);
  const response = c.json(result.body, { status: result.status as ContentfulStatusCode });
  response.headers.set(CORRELATION_ID_HEADER, correlationId);
  return response;
});

// Onboarding discover seasons endpoint (manual ESPN flow)
app.post('/onboarding/discover-seasons', async (c) => {
  const correlationId = getCorrelationId(c.req.raw);
  const authHeader = c.req.header('Authorization');
  const body = await c.req.json().catch(() => ({})) as {
    sport?: string;
    leagueId?: string;
  };

  const result = await discoverSeasons(c.env, body, authHeader, correlationId);
  const response = c.json(result.body, { status: result.status as ContentfulStatusCode });
  response.headers.set(CORRELATION_ID_HEADER, correlationId);
  return response;
});

// Main execute endpoint - called by fantasy-mcp gateway via service binding
app.post('/execute', async (c) => {
  const correlationId = getCorrelationId(c.req.raw);
  const { evalRunId, evalTraceId } = getEvalContext(c.req.raw);
  const body = await c.req.json<ExecuteRequest>();
  const { tool, params, authHeader } = body;
  const { sport, league_id, season_year } = params;

  // Translate canonical start-year to ESPN-native before routing to handlers.
  // For basketball/hockey ESPN expects end-year; for football/baseball this is a no-op.
  const espnParams = { ...params, season_year: toEspnSeasonYear(season_year, sport) };

  const startTime = Date.now();
  console.log(`[espn-client] ${correlationId} ${tool} ${sport} league=${league_id} season=${espnParams.season_year}`);
  logEvalEvent({
    service: 'espn-client',
    phase: 'execute_start',
    correlation_id: correlationId,
    run_id: evalRunId,
    trace_id: evalTraceId,
    tool,
    sport,
    league_id,
    message: `${tool} ${sport} league=${league_id} season=${espnParams.season_year}`,
  });

  // Route to sport-specific handler
  try {
    const result = await routeToSport(c.env, sport, tool, espnParams, authHeader, correlationId);
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
      code: 'INTERNAL_ERROR'
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
  params: ToolParams,
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

    case 'basketball':
      return { success: false, error: 'Basketball not yet supported', code: 'NOT_SUPPORTED' };

    case 'hockey':
      return { success: false, error: 'Hockey not yet supported', code: 'NOT_SUPPORTED' };

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
      '/onboarding/initialize': 'POST - Initialize onboarding with league data (requires Authorization header)',
      '/onboarding/discover-seasons': 'POST - Discover and save historical seasons (requires Authorization header)',
      '/execute': 'POST - Execute tool (called by gateway)'
    }
  }, 404);
});

export default app;
