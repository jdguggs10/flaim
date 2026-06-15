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
  logSetupSignal,
  withInternalServiceToken,
  type SetupSignalEvent,
} from '@flaim/worker-shared';
import type { Env } from './types';
import { createFantasyMcpServer } from './mcp/server';
import { createMcpHandler } from './mcp/create-mcp-handler';
import { isPublicMcpHandshakeRequest, normalizeMcpAcceptHeader } from './mcp/auth-gate';
import { logRequestBoundary } from './logging';
import { buildMcpAuthErrorResponse } from './auth-response';
import { USER_SESSION_WIDGET_HTML } from './widgets/user-session-widget';

const app = new Hono<{ Bindings: Env }>();

const API_ROBOTS_TXT = [
  'User-agent: *',
  'Allow: /.well-known/',
  'Allow: /mcp',
  'Allow: /mcp/',
  'Allow: /fantasy/mcp',
  'Allow: /fantasy/mcp/',
  'Allow: /favicon.ico',
  'Allow: /apple-icon.png',
  'Disallow: /',
  '',
].join('\n');

function robotsResponse(): Response {
  return new Response(API_ROBOTS_TXT, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

function logFantasySetupFailure(
  c: Context<{ Bindings: Env }>,
  event: string,
  fields: Omit<SetupSignalEvent, 'service' | 'event' | 'outcome'>
): void {
  const url = new URL(c.req.raw.url);
  logSetupSignal({
    service: 'fantasy-mcp',
    event,
    request_path: url.pathname,
    method: c.req.method,
    has_auth_header: c.req.raw.headers.has('Authorization'),
    correlation_id: c.req.raw.headers.get(CORRELATION_ID_HEADER) || undefined,
    cf_ray: c.req.raw.headers.get('CF-Ray') || undefined,
    environment: c.env.ENVIRONMENT || c.env.NODE_ENV,
    ...fields,
    outcome: 'failure',
  } as SetupSignalEvent & Record<string, unknown>);
}

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
      sleeper: !!env.SLEEPER,
      auth: !!env.AUTH_WORKER,
    }
  };

  // Test client connectivity in parallel
  const checks = [
    { key: 'espn_status', binding: env.ESPN },
    { key: 'yahoo_status', binding: env.YAHOO },
    { key: 'sleeper_status', binding: env.SLEEPER },
  ] as const;

  const results = await Promise.allSettled(
    checks.map(async ({ key, binding }) => {
      if (!binding) return { key, status: 'no_binding' as const };
      const res = await binding.fetch(new Request('https://internal/health'));
      return { key, status: res.ok ? 'connected' as const : 'error' as const };
    })
  );

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      healthData[result.value.key] = result.value.status;
      // Preserve previous health semantics: degrade only when unavailable.
      if (result.value.status === 'no_binding') healthData.status = 'degraded';
    } else {
      // Promise rejected — binding threw
      const check = checks[index];
      healthData[check.key] = 'unreachable';
      healthData.status = 'degraded';
    }
  });

  return healthData;
}

// Health check
app.get('/health', async (c) => {
  const healthData = await buildHealthData(c.env);
  const statusCode = healthData.status === 'healthy' ? 200 : 503;
  return c.json(healthData, statusCode);
});

app.get('/robots.txt', () => robotsResponse());
app.get('/fantasy/robots.txt', () => robotsResponse());

// OAuth Protected Resource Metadata (RFC 9728)
// Path-sensitive: /mcp is canonical, /fantasy/mcp is legacy alias
function buildOauthMetadata(resource: string) {
  return {
    resource,
    authorization_servers: ['https://api.flaim.app'],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp:read'],
  };
}

function buildResourceFromSuffix(baseResource: string, suffix: string): string {
  if (!suffix || suffix === '/') {
    return baseResource;
  }
  const normalizedSuffix = suffix.startsWith('/') ? suffix : `/${suffix}`;
  return `https://api.flaim.app${normalizedSuffix}`;
}

// OpenAI Apps Directory domain verification (token set via `wrangler secret put OPENAI_APPS_VERIFICATION_TOKEN`)
app.get('/.well-known/openai-apps-challenge', (c) => {
  const token = c.env.OPENAI_APPS_VERIFICATION_TOKEN;
  if (!token) {
    return c.text('Verification token not configured', 404);
  }
  return c.text(token, 200);
});

app.get('/.well-known/oauth-protected-resource', (c) => {
  return c.json(buildOauthMetadata('https://api.flaim.app/mcp'), 200, { 'Cache-Control': 'public, max-age=3600' });
});

app.get('/fantasy/.well-known/oauth-protected-resource', (c) => {
  return c.json(buildOauthMetadata('https://api.flaim.app/fantasy/mcp'), 200, { 'Cache-Control': 'public, max-age=3600' });
});

async function proxyAuthorizationServerMetadata(c: Context<{ Bindings: Env }>): Promise<Response> {
  const metadataResponse = await c.env.AUTH_WORKER.fetch(
    new Request('https://internal/.well-known/oauth-authorization-server')
  );
  const headers = new Headers(metadataResponse.headers);
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', 'public, max-age=3600');
  }
  return new Response(metadataResponse.body, {
    status: metadataResponse.status,
    headers,
  });
}

function buildMethodNotAllowedResponse(allow: string): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Method not allowed.',
      },
      id: null,
    }),
    {
      status: 405,
      headers: {
        Allow: allow,
        'Content-Type': 'application/json',
      },
    }
  );
}

async function isAuthenticatedMcpToolAttemptRequest(request: Request): Promise<boolean> {
  if (request.method !== 'POST') {
    return false;
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return false;
  }

  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > 65536) {
    return false;
  }

  try {
    // Clone so this logging heuristic never consumes the MCP handler body.
    const payload = await request.clone().json() as { method?: unknown; params?: unknown };
    if (payload?.method !== 'tools/call') {
      return false;
    }
    const params = payload.params;
    return Boolean(params && typeof params === 'object' && 'name' in params);
  } catch {
    return false;
  }
}

async function handleMcpRequest(c: Context<{ Bindings: Env }>): Promise<Response> {
  const correlationId = getCorrelationId(c.req.raw);
  const { evalRunId, evalTraceId } = getEvalContext(c.req.raw);
  const startTime = Date.now();

  logRequestBoundary({
    service: 'fantasy-mcp',
    phase: 'request_start',
    correlation_id: correlationId,
    run_id: evalRunId,
    trace_id: evalTraceId,
    message: evalRunId ? `${c.req.path} eval=${evalRunId}` : c.req.path,
  });

  const authHeader = c.req.header('Authorization');
  const allowPublicHandshake = !authHeader && await isPublicMcpHandshakeRequest(c.req.raw);
  if (!authHeader && !allowPublicHandshake) {
    if (await isAuthenticatedMcpToolAttemptRequest(c.req.raw)) {
      logFantasySetupFailure(c, 'auth_trust_path_failed', {
        component: 'mcp-auth',
        stage: 'authorization_header',
        failure_kind: 'auth',
        error_code: 'missing_authorization',
        http_status: 401,
        correlation_id: correlationId,
      });
    }
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
        new Request('https://internal/internal/introspect', {
          headers: withInternalServiceToken({
            Authorization: authHeader,
            'X-Flaim-Expected-Resource': expectedResource,
          }, c.env, 'auth-worker /internal/introspect'),
        })
      );
      if (!introspectRes.ok) {
        logFantasySetupFailure(c, 'auth_trust_path_failed', {
          component: 'mcp-auth',
          stage: 'token_introspection',
          failure_kind: 'auth',
          error_code: 'introspection_failed',
          http_status: 401,
          upstream_status: introspectRes.status,
          correlation_id: correlationId,
        });
        return buildMcpAuthErrorResponse(c.req.raw);
      }
      const tokenInfo = await introspectRes.json() as {
        valid: boolean;
        scope?: string;
        userId?: string;
        authType?: 'clerk' | 'oauth' | 'eval-api-key' | 'demo-api-key';
      };
      if (!tokenInfo.valid) {
        logFantasySetupFailure(c, 'auth_trust_path_failed', {
          component: 'mcp-auth',
          stage: 'token_introspection',
          failure_kind: 'auth',
          error_code: 'invalid_token',
          http_status: 401,
          auth_type: tokenInfo.authType,
          correlation_id: correlationId,
        });
        return buildMcpAuthErrorResponse(c.req.raw);
      }
      tokenScope = typeof tokenInfo.scope === 'string' ? tokenInfo.scope.trim() : undefined;
      if (!tokenScope) {
        logFantasySetupFailure(c, 'auth_trust_path_failed', {
          component: 'mcp-auth',
          stage: 'scope_validation',
          failure_kind: 'auth',
          error_code: 'missing_scope',
          http_status: 401,
          auth_type: tokenInfo.authType,
          correlation_id: correlationId,
        });
        return buildMcpAuthErrorResponse(c.req.raw);
      }

      // Rate limit authenticated MCP requests.
      // Opt-out: all auth types are rate-limited unless explicitly exempted.
      // Internal API key paths (eval-api-key, demo-api-key) are exempt so the
      // eval pipeline and demo runner are never throttled by user-facing limits.
      // Unknown future auth types are rate-limited by default (safe fallback).
      if (!tokenInfo.authType) {
        console.warn('[fantasy-mcp] introspect returned valid=true but authType is absent — rate limiting will apply');
      }
      const isExempt = tokenInfo.authType === 'eval-api-key' || tokenInfo.authType === 'demo-api-key';
      if (!tokenInfo.userId) {
        console.warn('[fantasy-mcp] introspect returned valid=true but userId is absent — rate limiting skipped');
      }
      if (!isExempt && tokenInfo.userId) {
        const { success } = await c.env.MCP_RATE_LIMITER.limit({ key: `user:${tokenInfo.userId}` });
        if (!success) {
          // JSON-RPC 2.0 specifies that id should mirror the request id when known.
          // The rate limit check fires before the request body is dispatched to the
          // MCP handler, so the id is not available here without re-parsing the body.
          // null is spec-legal for cases where the id cannot be determined.
          // Error code -32029 is an implementation-defined server error in the
          // JSON-RPC 2.0 reserved range (-32000 to -32099).
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              error: {
                code: -32029,
                message: 'Too many requests. Please wait 60 seconds and try again.',
              },
              id: null,
            }),
            {
              status: 429,
              headers: {
                'Content-Type': 'application/json',
                'Retry-After': '60',
              },
            }
          );
        }
      }
    } catch {
      logFantasySetupFailure(c, 'auth_trust_path_failed', {
        component: 'mcp-auth',
        stage: 'token_introspection',
        failure_kind: 'fetch_error',
        error_code: 'introspection_exception',
        http_status: 401,
        correlation_id: correlationId,
      });
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
  const handler = createMcpHandler(server, { enableJsonResponse: false });
  const normalizedRequest = normalizeMcpAcceptHeader(c.req.raw);
  const response = await handler(normalizedRequest, c.env, c.executionCtx);

  response.headers.set(CORRELATION_ID_HEADER, correlationId);
  if (evalRunId) {
    response.headers.set(EVAL_RUN_HEADER, evalRunId);
  }
  if (evalTraceId) {
    response.headers.set(EVAL_TRACE_HEADER, evalTraceId);
  }

  logRequestBoundary({
    service: 'fantasy-mcp',
    phase: 'request_end',
    correlation_id: correlationId,
    run_id: evalRunId,
    trace_id: evalTraceId,
    duration_ms: Date.now() - startTime,
    status: String(response.status),
    message: evalRunId ? `${c.req.path} eval=${evalRunId}` : c.req.path,
  });

  return response;
}

async function handleMcpEndpoint(c: Context<{ Bindings: Env }>): Promise<Response> {
  // Diagnostic probe: fires synchronously at invocation entry, before auth or streaming.
  // Used to distinguish CF invocation-recording gaps from log-buffering gaps.
  // Remove once CF partial-capture issue (FLA-86) is resolved.
  console.log(`[fantasy-mcp] probe method=${c.req.method} path=${c.req.path}`);

  if (c.req.method !== 'POST') {
    return buildMethodNotAllowedResponse('POST');
  }

  return handleMcpRequest(c);
}

// MCP endpoints - handle both /mcp (direct) and /fantasy/mcp (via route pattern)
app.all('/mcp', async (c) => {
  return handleMcpEndpoint(c);
});

app.all('/mcp/', async (c) => {
  return handleMcpEndpoint(c);
});

app.get('/mcp/.well-known/oauth-authorization-server', async (c) => {
  return proxyAuthorizationServerMetadata(c);
});

app.get('/mcp/.well-known/oauth-authorization-server/*', async (c) => {
  return proxyAuthorizationServerMetadata(c);
});

app.get('/mcp/.well-known/oauth-protected-resource', (c) => {
  return c.json(buildOauthMetadata('https://api.flaim.app/mcp'), 200, {
    'Cache-Control': 'public, max-age=3600',
  });
});

app.get('/mcp/.well-known/oauth-protected-resource/*', (c) => {
  const path = new URL(c.req.raw.url).pathname;
  const suffix = path.slice('/mcp/.well-known/oauth-protected-resource'.length);
  return c.json(buildOauthMetadata(buildResourceFromSuffix('https://api.flaim.app/mcp', suffix)), 200, {
    'Cache-Control': 'public, max-age=3600',
  });
});

// Routes via api.flaim.app/fantasy/* (Cloudflare route passes full path)
app.get('/fantasy/health', async (c) => {
  const healthData = await buildHealthData(c.env);
  const statusCode = healthData.status === 'healthy' ? 200 : 503;
  return c.json(healthData, statusCode);
});

app.all('/fantasy/mcp', async (c) => {
  return handleMcpEndpoint(c);
});

app.all('/fantasy/mcp/', async (c) => {
  return handleMcpEndpoint(c);
});

app.get('/fantasy/mcp/.well-known/oauth-authorization-server', async (c) => {
  return proxyAuthorizationServerMetadata(c);
});

app.get('/fantasy/mcp/.well-known/oauth-authorization-server/*', async (c) => {
  return proxyAuthorizationServerMetadata(c);
});

app.get('/fantasy/mcp/.well-known/oauth-protected-resource', (c) => {
  return c.json(buildOauthMetadata('https://api.flaim.app/fantasy/mcp'), 200, {
    'Cache-Control': 'public, max-age=3600',
  });
});

app.get('/fantasy/mcp/.well-known/oauth-protected-resource/*', (c) => {
  const path = new URL(c.req.raw.url).pathname;
  const suffix = path.slice('/fantasy/mcp/.well-known/oauth-protected-resource'.length);
  return c.json(buildOauthMetadata(buildResourceFromSuffix('https://api.flaim.app/fantasy/mcp', suffix)), 200, {
    'Cache-Control': 'public, max-age=3600',
  });
});

// Widget HTML endpoint (fallback for HTTP-fetching clients)
app.get('/widgets/user-session', (c) => {
  return c.html(USER_SESSION_WIDGET_HTML);
});
app.get('/fantasy/widgets/user-session', (c) => {
  return c.html(USER_SESSION_WIDGET_HTML);
});

// Favicon — proxy the canonical icon so crawlers (e.g. Google favicon service) receive
// the actual image bytes rather than following a redirect.
async function proxyFaviconResponse(upstreamUrl: string): Promise<Response> {
  const upstream = await fetch(upstreamUrl);
  const headers = new Headers();
  const contentType = upstream.headers.get('Content-Type');
  if (contentType) headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'public, max-age=86400');
  return new Response(upstream.body, { status: upstream.status, headers });
}

app.get('/favicon.ico', () => proxyFaviconResponse('https://flaim.app/favicon.ico'));
app.get('/fantasy/favicon.ico', () => proxyFaviconResponse('https://flaim.app/favicon.ico'));
app.get('/apple-icon.png', () => proxyFaviconResponse('https://flaim.app/apple-icon.png'));

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
