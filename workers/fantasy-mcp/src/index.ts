// workers/fantasy-mcp/src/index.ts
import { Hono, type Context } from 'hono';
import {
  createMcpCorsHeaders,
  isCorsPreflightRequest,
  CORRELATION_ID_HEADER,
  EVAL_RUN_HEADER,
  EVAL_TRACE_HEADER,
  getCorrelationId,
  getEvalContext,
} from '@flaim/worker-shared';
import type { Env } from './types';
import { createFantasyMcpServer } from './mcp/server';
import { createMcpHandler } from './mcp/create-mcp-handler';
import { isPublicMcpHandshakeRequest, normalizeMcpAcceptHeader } from './mcp/auth-gate';
import { logEvalEvent } from './logging';
import { buildMcpAuthErrorResponse } from './auth-response';

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
// Path-sensitive: /mcp is canonical, /fantasy/mcp is legacy alias
function buildOauthMetadata(resource: string) {
  return {
    resource,
    authorization_servers: ['https://api.flaim.app'],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp:read', 'mcp:write'],
  };
}

app.get('/.well-known/oauth-protected-resource', (c) => {
  return c.json(buildOauthMetadata('https://api.flaim.app/mcp'), 200, { 'Cache-Control': 'public, max-age=3600' });
});

app.get('/fantasy/.well-known/oauth-protected-resource', (c) => {
  return c.json(buildOauthMetadata('https://api.flaim.app/fantasy/mcp'), 200, { 'Cache-Control': 'public, max-age=3600' });
});

async function handleMcpRequest(c: Context<{ Bindings: Env }>): Promise<Response> {
  const correlationId = getCorrelationId(c.req.raw);
  const { evalRunId, evalTraceId } = getEvalContext(c.req.raw);
  const startTime = Date.now();

  logEvalEvent({
    service: 'fantasy-mcp',
    phase: 'request_start',
    correlation_id: correlationId,
    run_id: evalRunId,
    trace_id: evalTraceId,
    message: c.req.path,
  });

  const authHeader = c.req.header('Authorization');
  const allowPublicHandshake = !authHeader && await isPublicMcpHandshakeRequest(c.req.raw);
  if (!authHeader && !allowPublicHandshake) {
    return buildMcpAuthErrorResponse(c.req.raw);
  }

  // Scope pre-flight: resolve token scope via auth-worker introspection
  const pathname = new URL(c.req.raw.url).pathname;
  const expectedResource = pathname.startsWith('/fantasy/')
    ? 'https://api.flaim.app/fantasy/mcp'
    : 'https://api.flaim.app/mcp';

  let tokenScope: string | undefined;
  if (authHeader) {
    try {
      const introspectRes = await c.env.AUTH_WORKER.fetch(
        new Request('https://internal/auth/introspect', {
          headers: {
            Authorization: authHeader,
            'X-Flaim-Expected-Resource': expectedResource,
          },
        })
      );
      if (!introspectRes.ok) {
        return buildMcpAuthErrorResponse(c.req.raw);
      }
      const tokenInfo = await introspectRes.json() as { valid: boolean; scope?: string };
      if (!tokenInfo.valid) {
        return buildMcpAuthErrorResponse(c.req.raw);
      }
      tokenScope = typeof tokenInfo.scope === 'string' ? tokenInfo.scope.trim() : undefined;
      if (!tokenScope) {
        return buildMcpAuthErrorResponse(c.req.raw);
      }
    } catch {
      return buildMcpAuthErrorResponse(c.req.raw);
    }
  }

  const server = createFantasyMcpServer({
    env: c.env,
    authHeader: authHeader ?? null,
    tokenScope,
    correlationId,
    evalRunId,
    evalTraceId,
  });
  const handler = createMcpHandler(server);
  const normalizedRequest = normalizeMcpAcceptHeader(c.req.raw);
  const response = await handler(normalizedRequest, c.env, c.executionCtx);

  response.headers.set(CORRELATION_ID_HEADER, correlationId);
  if (evalRunId) {
    response.headers.set(EVAL_RUN_HEADER, evalRunId);
  }
  if (evalTraceId) {
    response.headers.set(EVAL_TRACE_HEADER, evalTraceId);
  }

  logEvalEvent({
    service: 'fantasy-mcp',
    phase: 'request_end',
    correlation_id: correlationId,
    run_id: evalRunId,
    trace_id: evalTraceId,
    duration_ms: Date.now() - startTime,
    status: String(response.status),
    message: c.req.path,
  });

  return response;
}

// MCP endpoints - handle both /mcp (direct) and /fantasy/mcp (via route pattern)
app.all('/mcp', async (c) => {
  return handleMcpRequest(c);
});

app.all('/mcp/*', async (c) => {
  return handleMcpRequest(c);
});

// Routes via api.flaim.app/fantasy/* (Cloudflare route passes full path)
app.get('/fantasy/health', async (c) => {
  const healthData = await buildHealthData(c.env);
  const statusCode = healthData.status === 'healthy' ? 200 : 503;
  return c.json(healthData, statusCode);
});

app.all('/fantasy/mcp', async (c) => {
  return handleMcpRequest(c);
});

app.all('/fantasy/mcp/*', async (c) => {
  return handleMcpRequest(c);
});

// Favicon — redirect to canonical icon so crawlers/clients pick up the current asset
app.get('/favicon.ico', (c) => c.redirect('https://flaim.app/favicon.ico', 302));
app.get('/fantasy/favicon.ico', (c) => c.redirect('https://flaim.app/favicon.ico', 302));
app.get('/apple-icon.png', (c) => c.redirect('https://flaim.app/apple-icon.png', 302));

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
