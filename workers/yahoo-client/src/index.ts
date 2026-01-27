import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, ExecuteRequest, ExecuteResponse } from './types';
import { CORRELATION_ID_HEADER, getCorrelationId } from '@flaim/worker-shared';

const app = new Hono<{ Bindings: Env }>();

app.use('*', cors());

// Health check
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    service: 'yahoo-client',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Main execute endpoint - called by fantasy-mcp gateway
app.post('/execute', async (c) => {
  const correlationId = getCorrelationId(c.req.raw);
  const startTime = Date.now();

  try {
    const body = await c.req.json<ExecuteRequest>();
    const { tool, params, authHeader: _authHeader } = body;
    const { sport, league_id, season_year } = params;

    console.log(`[yahoo-client] ${correlationId} ${tool} ${sport} league=${league_id} season=${season_year}`);

    // Placeholder - will be implemented in Task 3
    const result: ExecuteResponse = {
      success: false,
      error: 'Yahoo client not yet implemented',
      code: 'NOT_IMPLEMENTED'
    };

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
