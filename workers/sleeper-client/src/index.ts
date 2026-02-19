import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, ExecuteRequest, ExecuteResponse, Sport } from './types';
import { footballHandlers } from './sports/football/handlers';
import { basketballHandlers } from './sports/basketball/handlers';
import {
  CORRELATION_ID_HEADER,
  EVAL_RUN_HEADER,
  EVAL_TRACE_HEADER,
  getCorrelationId,
  getEvalContext,
} from '@flaim/worker-shared';
import { logEvalEvent } from './logging';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'sleeper-client',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

app.post('/execute', async (c) => {
  const correlationId = getCorrelationId(c.req.raw);
  const { evalRunId, evalTraceId } = getEvalContext(c.req.raw);
  const startTime = Date.now();

  try {
    const body = await c.req.json<ExecuteRequest>();
    const { tool, params } = body;
    const { sport, league_id, season_year } = params;

    console.log(`[sleeper-client] ${correlationId} ${tool} ${sport} league=${league_id} season=${season_year}`);
    logEvalEvent({
      service: 'sleeper-client',
      phase: 'execute_start',
      correlation_id: correlationId,
      run_id: evalRunId,
      trace_id: evalTraceId,
      tool,
      sport,
      league_id,
      message: `${tool} ${sport} league=${league_id} season=${season_year}`,
    });

    const result = await routeToSport(sport, tool, params);

    const duration = Date.now() - startTime;
    console.log(`[sleeper-client] ${correlationId} ${tool} ${sport} completed in ${duration}ms success=${result.success}`);
    logEvalEvent({
      service: 'sleeper-client',
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
    console.error(`[sleeper-client] ${correlationId} error in ${duration}ms: ${message}`);
    logEvalEvent({
      service: 'sleeper-client',
      phase: 'execute_error',
      correlation_id: correlationId,
      run_id: evalRunId,
      trace_id: evalTraceId,
      duration_ms: duration,
      status: 'error',
      message: 'execute failed',
      error: message,
    });

    const response = c.json({
      success: false,
      error: message,
      code: 'INTERNAL_ERROR',
    } satisfies ExecuteResponse, 500);
    response.headers.set(CORRELATION_ID_HEADER, correlationId);
    if (evalRunId) response.headers.set(EVAL_RUN_HEADER, evalRunId);
    if (evalTraceId) response.headers.set(EVAL_TRACE_HEADER, evalTraceId);
    return response;
  }
});

async function routeToSport(
  sport: Sport,
  tool: string,
  params: ExecuteRequest['params'],
): Promise<ExecuteResponse> {
  switch (sport) {
    case 'football': {
      const handler = footballHandlers[tool];
      if (!handler) return { success: false, error: `Unknown football tool: ${tool}`, code: 'UNKNOWN_TOOL' };
      // Sleeper API is public — no env/authHeader needed by handlers
      return handler({} as Env, params);
    }
    case 'basketball': {
      const handler = basketballHandlers[tool];
      if (!handler) return { success: false, error: `Unknown basketball tool: ${tool}`, code: 'UNKNOWN_TOOL' };
      return handler({} as Env, params);
    }
    default:
      return { success: false, error: `Sport "${sport}" is not supported for Sleeper`, code: 'SPORT_NOT_SUPPORTED' };
  }
}

app.notFound((c) => {
  return c.json({
    error: 'Endpoint not found',
    endpoints: {
      '/health': 'GET - Health check',
      '/execute': 'POST - Execute tool (called by gateway)',
    },
  }, 404);
});

export default app;
