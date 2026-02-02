// workers/fantasy-mcp/src/index.ts
import { Hono } from 'hono';
import {
  createMcpCorsHeaders,
  isCorsPreflightRequest,
  CORRELATION_ID_HEADER,
  getCorrelationId,
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

// Shared health check logic
async function buildHealthData(env: Env) {
  const healthData: Record<string, unknown> = {
    status: 'healthy',
    service: 'fantasy-mcp',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    bindings: {
      espn: !!env.ESPN,
      yahoo: !!env.YAHOO,
      auth: !!env.AUTH_WORKER,
    }
  };

  // Test ESPN client connectivity
  if (env.ESPN) {
    try {
      const espnHealth = await env.ESPN.fetch(new Request('https://internal/health'));
      healthData.espn_status = espnHealth.ok ? 'connected' : 'error';
    } catch {
      healthData.espn_status = 'unreachable';
      healthData.status = 'degraded';
    }
  } else {
    healthData.espn_status = 'no_binding';
    healthData.status = 'degraded';
  }

  // Test Yahoo client connectivity
  if (env.YAHOO) {
    try {
      const yahooHealth = await env.YAHOO.fetch(new Request('https://internal/health'));
      healthData.yahoo_status = yahooHealth.ok ? 'connected' : 'error';
    } catch {
      healthData.yahoo_status = 'unreachable';
      healthData.status = 'degraded';
    }
  } else {
    healthData.yahoo_status = 'no_binding';
    healthData.status = 'degraded';
  }

  return healthData;
}

// Health check
app.get('/health', async (c) => {
  const healthData = await buildHealthData(c.env);
  const statusCode = healthData.status === 'healthy' ? 200 : 503;
  return c.json(healthData, statusCode);
});

// OAuth Protected Resource Metadata (RFC 9728)
// Available at both paths for direct and routed access
const oauthMetadata = {
  resource: 'https://api.flaim.app/fantasy/mcp',
  authorization_servers: ['https://api.flaim.app'],
  bearer_methods_supported: ['header'],
  scopes_supported: ['mcp:read', 'mcp:write']
};

app.get('/.well-known/oauth-protected-resource', (c) => {
  return c.json(oauthMetadata, 200, { 'Cache-Control': 'public, max-age=3600' });
});

app.get('/fantasy/.well-known/oauth-protected-resource', (c) => {
  return c.json(oauthMetadata, 200, { 'Cache-Control': 'public, max-age=3600' });
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

// MCP endpoints - handle both /mcp (direct) and /fantasy/mcp (via route pattern)
app.all('/mcp', async (c) => {
  const correlationId = getCorrelationId(c.req.raw);
  // Check for Authorization header
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return buildMcpAuthErrorResponse(c.req.raw);
  }

  // Create MCP server and handler
  const server = createFantasyMcpServer({
    env: c.env,
    authHeader,
    correlationId,
  });
  const handler = createMcpHandler(server);

  // Handle the request
  const response = await handler(c.req.raw, c.env, c.executionCtx);
  response.headers.set(CORRELATION_ID_HEADER, correlationId);
  return response;
});

app.all('/mcp/*', async (c) => {
  const correlationId = getCorrelationId(c.req.raw);
  // Check for Authorization header
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return buildMcpAuthErrorResponse(c.req.raw);
  }

  // Create MCP server and handler
  const server = createFantasyMcpServer({
    env: c.env,
    authHeader,
    correlationId,
  });
  const handler = createMcpHandler(server);

  // Handle the request
  const response = await handler(c.req.raw, c.env, c.executionCtx);
  response.headers.set(CORRELATION_ID_HEADER, correlationId);
  return response;
});

// Routes via api.flaim.app/fantasy/* (Cloudflare route passes full path)
app.get('/fantasy/health', async (c) => {
  const healthData = await buildHealthData(c.env);
  const statusCode = healthData.status === 'healthy' ? 200 : 503;
  return c.json(healthData, statusCode);
});

app.all('/fantasy/mcp', async (c) => {
  const correlationId = getCorrelationId(c.req.raw);
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return buildMcpAuthErrorResponse(c.req.raw);
  }

  const server = createFantasyMcpServer({
    env: c.env,
    authHeader,
    correlationId,
  });
  const handler = createMcpHandler(server);
  const response = await handler(c.req.raw, c.env, c.executionCtx);
  response.headers.set(CORRELATION_ID_HEADER, correlationId);
  return response;
});

app.all('/fantasy/mcp/*', async (c) => {
  const correlationId = getCorrelationId(c.req.raw);
  const authHeader = c.req.header('Authorization');
  if (!authHeader) {
    return buildMcpAuthErrorResponse(c.req.raw);
  }

  const server = createFantasyMcpServer({
    env: c.env,
    authHeader,
    correlationId,
  });
  const handler = createMcpHandler(server);
  const response = await handler(c.req.raw, c.env, c.executionCtx);
  response.headers.set(CORRELATION_ID_HEADER, correlationId);
  return response;
});

// Favicon — redirect to canonical icon so crawlers/clients pick up the current asset
app.get('/favicon.ico', (c) => c.redirect('https://flaim.app/favicon.ico', 302));
app.get('/fantasy/favicon.ico', (c) => c.redirect('https://flaim.app/favicon.ico', 302));

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
