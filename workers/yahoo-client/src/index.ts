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
  const body = await c.req.json<ExecuteRequest>();
  const { tool, params } = body;

  console.log(`[yahoo-client] ${correlationId} ${tool} ${params.sport} league=${params.league_id}`);

  // Placeholder - will be implemented in Task 3
  const response = c.json({
    success: false,
    error: 'Yahoo client not yet implemented',
    code: 'NOT_IMPLEMENTED'
  } satisfies ExecuteResponse);
  response.headers.set(CORRELATION_ID_HEADER, correlationId);
  return response;
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
