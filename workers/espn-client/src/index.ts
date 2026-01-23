// workers/espn-client/src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, ExecuteRequest, ExecuteResponse, Sport, ToolParams } from './types';
import { baseballHandlers } from './sports/baseball/handlers';
import { footballHandlers } from './sports/football/handlers';
import { CORRELATION_ID_HEADER, getCorrelationId } from '@flaim/worker-shared';

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

// Main execute endpoint - called by fantasy-mcp gateway via service binding
app.post('/execute', async (c) => {
  const correlationId = getCorrelationId(c.req.raw);
  const body = await c.req.json<ExecuteRequest>();
  const { tool, params, authHeader } = body;
  const { sport, league_id, season_year } = params;

  const startTime = Date.now();
  console.log(`[espn-client] ${correlationId} ${tool} ${sport} league=${league_id} season=${season_year}`);

  // Route to sport-specific handler
  try {
    const result = await routeToSport(c.env, sport, tool, params, authHeader, correlationId);
    const duration = Date.now() - startTime;
    console.log(`[espn-client] ${correlationId} ${tool} ${sport} completed in ${duration}ms success=${result.success}`);
    const response = c.json(result);
    response.headers.set(CORRELATION_ID_HEADER, correlationId);
    return response;
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[espn-client] ${correlationId} ${tool} ${sport} failed in ${duration}ms: ${message}`);
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
      '/execute': 'POST - Execute tool (called by gateway)'
    }
  }, 404);
});

export default app;
