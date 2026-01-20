// workers/fantasy-mcp/src/index.ts
import { Hono } from 'hono';
import {
  createMcpCorsHeaders,
  isCorsPreflightRequest,
} from '@flaim/worker-shared';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

// CORS middleware
app.use('*', async (c, next) => {
  if (isCorsPreflightRequest(c.req.raw)) {
    return new Response(null, {
      status: 200,
      headers: createMcpCorsHeaders(c.req.raw),
    });
  }
  await next();
  const corsHeaders = createMcpCorsHeaders(c.req.raw);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    if (!c.res.headers.has(key)) {
      c.res.headers.set(key, value);
    }
  });
  return undefined;
});

// Health check
app.get('/health', async (c) => {
  const healthData: Record<string, unknown> = {
    status: 'healthy',
    service: 'fantasy-mcp',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    bindings: {
      espn: !!c.env.ESPN,
      auth: !!c.env.AUTH,
    }
  };

  // Test ESPN client connectivity
  if (c.env.ESPN) {
    try {
      const espnHealth = await c.env.ESPN.fetch(
        new Request('https://internal/health')
      );
      healthData.espn_status = espnHealth.ok ? 'connected' : 'error';
    } catch {
      healthData.espn_status = 'unreachable';
      healthData.status = 'degraded';
    }
  } else {
    healthData.espn_status = 'no_binding';
    healthData.status = 'degraded';
  }

  const statusCode = healthData.status === 'healthy' ? 200 : 503;
  return c.json(healthData, statusCode);
});

// OAuth Protected Resource Metadata (RFC 9728)
app.get('/.well-known/oauth-protected-resource', (c) => {
  return c.json({
    resource: 'https://api.flaim.app/fantasy/mcp',
    authorization_servers: ['https://api.flaim.app'],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp:read', 'mcp:write']
  }, 200, {
    'Cache-Control': 'public, max-age=3600'
  });
});

// MCP endpoints - placeholder until MCP SDK integration
app.all('/mcp', async (c) => {
  return c.json({
    error: 'MCP endpoint not yet implemented',
    message: 'This gateway will expose unified MCP tools'
  }, 501);
});

app.all('/mcp/*', async (c) => {
  return c.json({
    error: 'MCP endpoint not yet implemented'
  }, 501);
});

// 404 handler
app.notFound((c) => {
  return c.json({
    error: 'Endpoint not found',
    endpoints: {
      '/health': 'GET - Health check with binding status',
      '/.well-known/oauth-protected-resource': 'GET - OAuth metadata',
      '/mcp': 'POST - MCP protocol (not yet implemented)'
    }
  }, 404);
});

export default app;
