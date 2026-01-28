import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, ExecuteRequest, ExecuteResponse, Sport } from './types';
import { footballHandlers } from './sports/football/handlers';
import { CORRELATION_ID_HEADER, getCorrelationId } from '@flaim/worker-shared';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'yahoo-client',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.post('/execute', async (c) => {
  const correlationId = getCorrelationId(c.req.raw);
  const startTime = Date.now();

  try {
    const body = await c.req.json<ExecuteRequest>();
    const { tool, params, authHeader } = body;
    const { sport, league_id, season_year } = params;

    console.log(`[yahoo-client] ${correlationId} ${tool} ${sport} league=${league_id} season=${season_year}`);

    const result = await routeToSport(c.env, sport, tool, params, authHeader, correlationId);

    const duration = Date.now() - startTime;
    console.log(`[yahoo-client] ${correlationId} ${tool} ${sport} completed in ${duration}ms success=${result.success}`);

    const response = c.json(result);
    response.headers.set(CORRELATION_ID_HEADER, correlationId);
    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[yahoo-client] ${correlationId} error in ${duration}ms: ${message}`);

    const response = c.json({
      success: false,
      error: message,
      code: 'INTERNAL_ERROR'
    } satisfies ExecuteResponse, 500);
    response.headers.set(CORRELATION_ID_HEADER, correlationId);
    return response;
  }
});

async function routeToSport(
  env: Env,
  sport: Sport,
  tool: string,
  params: ExecuteRequest['params'],
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

    case 'baseball':
      return { success: false, error: 'Yahoo baseball not yet supported', code: 'NOT_SUPPORTED' };

    case 'basketball':
      return { success: false, error: 'Yahoo basketball not yet supported', code: 'NOT_SUPPORTED' };

    case 'hockey':
      return { success: false, error: 'Yahoo hockey not yet supported', code: 'NOT_SUPPORTED' };

    default:
      return { success: false, error: `Unknown sport: ${sport}`, code: 'INVALID_SPORT' };
  }
}

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
