// workers/espn-client/src/index.ts
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, ExecuteRequest, ExecuteResponse, Sport } from './types';

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
  const body = await c.req.json<ExecuteRequest>();
  const { tool, params, authHeader } = body;
  const { sport } = params;

  // Route to sport-specific handler
  try {
    const result = await routeToSport(c.env, sport, tool, params, authHeader);
    return c.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({
      success: false,
      error: message,
      code: 'INTERNAL_ERROR'
    } satisfies ExecuteResponse, 500);
  }
});

async function routeToSport(
  _env: Env,
  sport: Sport,
  _tool: string,
  _params: ExecuteRequest['params'],
  _authHeader?: string
): Promise<ExecuteResponse> {
  switch (sport) {
    case 'football':
      // TODO: Import and call football handlers
      return { success: false, error: 'Football handlers not yet implemented', code: 'NOT_IMPLEMENTED' };
    case 'baseball':
      // TODO: Import and call baseball handlers
      return { success: false, error: 'Baseball handlers not yet implemented', code: 'NOT_IMPLEMENTED' };
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
