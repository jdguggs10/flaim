// workers/fantasy-mcp/src/index.ts
import { Hono } from 'hono';
import {
  createMcpCorsHeaders,
  isCorsPreflightRequest,
} from '@flaim/worker-shared';
import type { Env } from './types';
import { createFantasyMcpServer } from './mcp/server';
import { createMcpHandler } from './mcp/create-mcp-handler';

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

/**
 * Build MCP-compliant 401 response with WWW-Authenticate header
 */
function buildMcpAuthErrorResponse(request: Request): Response {
  const corsHeaders = createMcpCorsHeaders(request);
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Authentication required. Please provide a valid Bearer token.',
      },
      id: null,
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'Bearer realm="fantasy-mcp", resource="https://api.flaim.app/fantasy/mcp"',
        ...corsHeaders,
      },
    }
  );
}

// MCP endpoints
app.all('/mcp', async (c) => {
  // Check for Authorization header
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return buildMcpAuthErrorResponse(c.req.raw);
  }

  // Create MCP server and handler
  const server = createFantasyMcpServer({
    env: c.env,
    authHeader,
  });
  const handler = createMcpHandler(server);

  // Handle the request
  return handler(c.req.raw, c.env, c.executionCtx);
});

app.all('/mcp/*', async (c) => {
  // Check for Authorization header
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return buildMcpAuthErrorResponse(c.req.raw);
  }

  // Create MCP server and handler
  const server = createFantasyMcpServer({
    env: c.env,
    authHeader,
  });
  const handler = createMcpHandler(server);

  // Handle the request
  return handler(c.req.raw, c.env, c.executionCtx);
});

// 404 handler
app.notFound((c) => {
  return c.json({
    error: 'Endpoint not found',
    endpoints: {
      '/health': 'GET - Health check with binding status',
      '/.well-known/oauth-protected-resource': 'GET - OAuth metadata',
      '/mcp': 'POST - MCP protocol endpoint'
    }
  }, 404);
});

export default app;
