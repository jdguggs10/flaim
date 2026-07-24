import { describe, expect, it, vi } from 'vitest';
import app from '../../src/index';
import type { Env } from '../../src/types';
import { getUnifiedTools, type UnifiedTool } from '../../src/mcp/tools';
import {
  LEGACY_USER_SESSION_WIDGET_URI,
  USER_SESSION_WIDGET_HTML,
  USER_SESSION_WIDGET_URI,
} from '../../src/widgets/user-session-widget';
import { INTERNAL_SERVICE_TOKEN_HEADER, getDefaultSeasonYear } from '@flaim/worker-shared';

// Mock the tools module so a single test can inject a custom tool (e.g. a
// throwing handler) via mockReturnValueOnce, while every other test/request
// transparently falls through to the real getUnifiedTools implementation.
vi.mock('../../src/mcp/tools', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/mcp/tools')>();
  return {
    ...actual,
    getUnifiedTools: vi.fn(actual.getUnifiedTools),
  };
});

function buildMcpRequest(pathname: '/mcp' | '/fantasy/mcp'): Request {
  return buildMcpJsonRpcRequest(pathname, 'tools/list');
}

function buildMcpJsonRpcRequest(
  pathname: '/mcp' | '/fantasy/mcp',
  method: string,
  params: Record<string, unknown> = {},
  id = 'wire-test-1'
): Request {
  return new Request(`https://api.flaim.app${pathname}`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }),
  });
}

function buildUnauthenticatedMcpJsonRpcRequest(
  pathname: '/mcp' | '/fantasy/mcp',
  method: string,
  params: Record<string, unknown> = {},
  id = 'unauthenticated-wire-test-1'
): Request {
  return new Request(`https://api.flaim.app${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }),
  });
}

function buildMcpGetRequest(pathname: '/mcp' | '/fantasy/mcp'): Request {
  return new Request(`https://api.flaim.app${pathname}`, {
    method: 'GET',
    headers: {
      Accept: 'text/event-stream',
    },
  });
}

type JsonRpcTestPayload = {
  error?: {
    code?: number;
    message?: string;
  };
  result?: {
    serverInfo?: {
      name?: string;
      version?: string;
    };
    instructions?: string;
    tools?: Array<{
      name: string;
      inputSchema?: {
        properties?: {
          platform?: {
            enum?: string[];
          };
        };
      };
      annotations?: {
        readOnlyHint?: boolean;
        openWorldHint?: boolean;
        destructiveHint?: boolean;
        idempotentHint?: boolean;
      };
      _meta?: Record<string, unknown> & {
        securitySchemes?: Array<{ type?: string; scopes?: string[] }>;
        ui?: { resourceUri?: string };
        'openai/outputTemplate'?: string;
        'openai/widgetAccessible'?: boolean;
        'openai/resultCanProduceWidget'?: boolean;
        'openai/widgetDomain'?: string;
      };
    }>;
    resources?: Array<{
      uri: string;
      name?: string;
      mimeType?: string;
      _meta?: Record<string, unknown>;
    }>;
    contents?: Array<{
      uri?: string;
      mimeType?: string;
      text?: string;
      _meta?: Record<string, unknown> & {
        ui?: { csp?: { connectDomains?: unknown[]; resourceDomains?: unknown[] }; domain?: string };
        'openai/widgetCSP'?: { connect_domains?: unknown[]; resource_domains?: unknown[] };
        'openai/widgetDomain'?: string;
      };
    }>;
  };
};

async function parseJsonRpcResponse(response: Response): Promise<JsonRpcTestPayload> {
  const contentType = response.headers.get('Content-Type') || '';

  if (contentType.includes('application/json')) {
    return response.json() as Promise<JsonRpcTestPayload>;
  }

  if (contentType.includes('text/event-stream')) {
    const text = await response.text();
    const data = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
      .trim();
    return JSON.parse(data) as JsonRpcTestPayload;
  }

  throw new Error(`Unsupported MCP response content type: ${contentType}`);
}

function mockExecutionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

// Execution context that collects waitUntil promises so fire-and-forget work
// (e.g. the FLA-156 usage-event emit) can be awaited and asserted in tests.
function collectingExecutionContext(): { ctx: ExecutionContext; settled: () => Promise<void> } {
  const pending: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: vi.fn((p: Promise<unknown>) => {
      pending.push(Promise.resolve(p));
    }),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
  return {
    ctx,
    settled: async () => {
      await Promise.allSettled(pending);
    },
  };
}

function emittedSetupSignal(spy: { mock: { calls: unknown[][] } }): boolean {
  return spy.mock.calls.some((call) => String(call[0]).includes('"schema_version":1'));
}

function buildEnv(authFetch: (request: Request) => Promise<Response>): Env {
  return {
    INTERNAL_SERVICE_TOKEN: 'internal-secret',
    AUTH_WORKER: { fetch: authFetch } as unknown as Fetcher,
    ESPN: { fetch: vi.fn() } as unknown as Fetcher,
    YAHOO: { fetch: vi.fn() } as unknown as Fetcher,
    SLEEPER: { fetch: vi.fn() } as unknown as Fetcher,
    MCP_RATE_LIMITER: { limit: async () => ({ success: true }) },
  } as unknown as Env;
}

describe('fantasy-mcp gateway integration', () => {
  it('serves controlled metadata at the API host root', async () => {
    const authFetch = vi.fn(async () => new Response('unexpected', { status: 500 }));
    const env = buildEnv(authFetch);

    const response = await app.fetch(
      new Request('https://api.flaim.app/'),
      env,
      mockExecutionContext()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600');
    const payload = await response.json() as {
      service?: string;
      status?: string;
      endpoints?: Record<string, string>;
    };
    expect(payload).toMatchObject({
      service: 'Flaim API',
      status: 'ok',
      endpoints: {
        mcp: 'https://api.flaim.app/mcp',
        oauth_authorization_server: 'https://api.flaim.app/.well-known/oauth-authorization-server',
        oauth_protected_resource: 'https://api.flaim.app/.well-known/oauth-protected-resource',
        health: 'https://api.flaim.app/fantasy/health',
      },
    });
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('handles HEAD at the API host root without an auth lookup', async () => {
    const authFetch = vi.fn(async () => new Response('unexpected', { status: 500 }));
    const env = buildEnv(authFetch);

    const response = await app.fetch(
      new Request('https://api.flaim.app/', { method: 'HEAD' }),
      env,
      mockExecutionContext()
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(await response.text()).toBe('');
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('rejects GET with 405 on MCP transport endpoints', async () => {
    const authFetch = vi.fn(async () => new Response('unexpected', { status: 500 }));
    const env = buildEnv(authFetch);

    const mcpResponse = await app.fetch(buildMcpGetRequest('/mcp'), env, mockExecutionContext());
    expect(mcpResponse.status).toBe(405);

    const fantasyResponse = await app.fetch(buildMcpGetRequest('/fantasy/mcp'), env, mockExecutionContext());
    expect(fantasyResponse.status).toBe(405);

    expect(mcpResponse.headers.get('Allow')).toBe('POST');

    // Auth should not be called — 405 fires before auth/introspection
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('does not emit setup signal for unauthenticated non-MCP POST probes', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const authFetch = vi.fn(async () => new Response('unexpected', { status: 500 }));
    const env = buildEnv(authFetch);

    try {
      const response = await app.fetch(
        new Request('https://api.flaim.app/mcp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ probe: true }),
        }),
        env,
        mockExecutionContext()
      );

      expect(response.status).toBe(401);
      expect(authFetch).not.toHaveBeenCalled();
      expect(emittedSetupSignal(logSpy)).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('does not emit setup signal for oversized unauthenticated tool-call probes', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const authFetch = vi.fn(async () => new Response('unexpected', { status: 500 }));
    const env = buildEnv(authFetch);
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 'oversized-probe',
      method: 'tools/call',
      params: { name: 'get_user_session', arguments: {} },
      padding: 'x'.repeat(65536),
    });

    try {
      const response = await app.fetch(
        new Request('https://api.flaim.app/mcp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': String(body.length),
            Accept: 'application/json',
          },
          body,
        }),
        env,
        mockExecutionContext()
      );

      expect(response.status).toBe(401);
      expect(authFetch).not.toHaveBeenCalled();
      expect(emittedSetupSignal(logSpy)).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });

  it('serves oauth metadata aliases under /mcp/.well-known', async () => {
    const authFetch = vi.fn(async (request: Request) => {
      if (new URL(request.url).pathname === '/.well-known/oauth-authorization-server') {
        return new Response(
          JSON.stringify({
            issuer: 'https://api.flaim.app',
            authorization_endpoint: 'https://api.flaim.app/auth/authorize',
            token_endpoint: 'https://api.flaim.app/auth/token',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('not found', { status: 404 });
    });
    const env = buildEnv(authFetch);

    const authzMetadataResponse = await app.fetch(
      new Request('https://api.flaim.app/mcp/.well-known/oauth-authorization-server'),
      env,
      mockExecutionContext()
    );
    expect(authzMetadataResponse.status).toBe(200);
    const authzPayload = await authzMetadataResponse.json() as { issuer?: string };
    expect(authzPayload.issuer).toBe('https://api.flaim.app');

    const authzMetadataSuffixedResponse = await app.fetch(
      new Request('https://api.flaim.app/mcp/.well-known/oauth-authorization-server/mcp'),
      env,
      mockExecutionContext()
    );
    expect(authzMetadataSuffixedResponse.status).toBe(200);

    const resourceMetadataResponse = await app.fetch(
      new Request('https://api.flaim.app/mcp/.well-known/oauth-protected-resource'),
      env,
      mockExecutionContext()
    );
    expect(resourceMetadataResponse.status).toBe(200);
    const resourcePayload = await resourceMetadataResponse.json() as { resource?: string };
    expect(resourcePayload.resource).toBe('https://api.flaim.app/mcp');

    const resourceMetadataSuffixedResponse = await app.fetch(
      new Request('https://api.flaim.app/mcp/.well-known/oauth-protected-resource/mcp'),
      env,
      mockExecutionContext()
    );
    expect(resourceMetadataSuffixedResponse.status).toBe(200);
    const suffixedResourcePayload = await resourceMetadataSuffixedResponse.json() as { resource?: string };
    expect(suffixedResourcePayload.resource).toBe('https://api.flaim.app/mcp');
  });

  it('emits _meta.securitySchemes in tools/list wire response', async () => {
    const authFetch = vi.fn(async () =>
      new Response(JSON.stringify({ valid: true, userId: 'user-123', scope: 'mcp:read mcp:write', authType: 'oauth' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const env = buildEnv(authFetch);

    const response = await app.fetch(buildMcpRequest('/mcp'), env, mockExecutionContext());
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');

    const payload = await parseJsonRpcResponse(response);
    const tools = payload.result?.tools;
    expect(Array.isArray(tools)).toBe(true);
    const freeAgentsTool = tools?.find((tool) => tool.name === 'get_free_agents');
    expect(freeAgentsTool).toBeDefined();
    expect(freeAgentsTool?.inputSchema?.properties?.platform?.enum).toContain('sleeper');
    const userSessionTool = tools?.find((tool) => tool.name === 'get_user_session');
    expect(userSessionTool).toBeDefined();
    expect(userSessionTool?._meta?.ui).toEqual({ resourceUri: USER_SESSION_WIDGET_URI });
    expect(userSessionTool?._meta?.['openai/outputTemplate']).toBe(USER_SESSION_WIDGET_URI);
    expect(userSessionTool?._meta?.ui?.resourceUri).not.toBe(LEGACY_USER_SESSION_WIDGET_URI);
    expect(userSessionTool?._meta?.['openai/widgetAccessible']).toBe(true);
    expect(userSessionTool?._meta?.['openai/resultCanProduceWidget']).toBe(true);
    expect(userSessionTool?._meta?.['openai/widgetDomain']).toBeUndefined();
    const refreshTool = tools?.find((tool) => tool.name === 'refresh_leagues');
    expect(refreshTool).toBeDefined();
    expect(refreshTool?._meta?.securitySchemes?.[0]?.scopes).toContain('mcp:write');
    expect(refreshTool?.annotations).toEqual({
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: false,
      idempotentHint: false,
    });

    const scopeByTool = new Map(getUnifiedTools().map((tool) => [tool.name, tool.requiredScope]));
    for (const tool of tools || []) {
      expect(tool._meta?.securitySchemes?.[0]?.type).toBe('oauth2');
      expect(tool._meta?.securitySchemes?.[0]?.scopes).toContain(scopeByTool.get(tool.name));
      // OpenAI Apps Directory review expects these hints to be explicitly declared.
      expect(tool.annotations).toMatchObject({
        openWorldHint: true,
        destructiveHint: false,
      });
      expect(tool.annotations?.idempotentHint).toBe(tool.name === 'refresh_leagues' ? false : true);
      expect(tool.annotations?.readOnlyHint).toBe(tool.name === 'refresh_leagues' ? false : true);
    }

    expect(authFetch).toHaveBeenCalledTimes(1);
    const introspectReq = authFetch.mock.calls[0]?.[0] as Request;
    expect(introspectReq.url).toBe('https://internal/internal/introspect');
    expect(introspectReq.headers.get('X-Flaim-Expected-Resource')).toBe('https://api.flaim.app/mcp');
    expect(introspectReq.headers.get(INTERNAL_SERVICE_TOKEN_HEADER)).toBe('internal-secret');
  });

  it('exposes the user session MCP Apps resource metadata', async () => {
    const authFetch = vi.fn(async () =>
      new Response(JSON.stringify({ valid: true, userId: 'user-123', scope: 'mcp:read mcp:write', authType: 'oauth' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const env = buildEnv(authFetch);

    const listResponse = await app.fetch(
      buildMcpJsonRpcRequest('/mcp', 'resources/list', {}, 'resources-list-1'),
      env,
      mockExecutionContext()
    );
    expect(listResponse.status).toBe(200);
    const listPayload = await parseJsonRpcResponse(listResponse);
    const expectedUris = [LEGACY_USER_SESSION_WIDGET_URI, USER_SESSION_WIDGET_URI];
    expect(new Set(listPayload.result?.resources?.map((item) => item.uri))).toEqual(
      new Set(expectedUris)
    );

    const widgetBodies: string[] = [];
    for (const [index, uri] of expectedUris.entries()) {
      const resource = listPayload.result?.resources?.find((item) => item.uri === uri);
      expect(resource).toBeDefined();
      expect(resource?.mimeType).toBe('text/html;profile=mcp-app');

      const readResponse = await app.fetch(
        buildMcpJsonRpcRequest(
          '/mcp',
          'resources/read',
          { uri },
          `resources-read-${index + 1}`
        ),
        env,
        mockExecutionContext()
      );
      expect(readResponse.status).toBe(200);
      const readPayload = await parseJsonRpcResponse(readResponse);
      const content = readPayload.result?.contents?.find((item) => item.uri === uri);
      expect(content?.mimeType).toBe('text/html;profile=mcp-app');
      expect(content?.text).toContain('<title>Flaim</title>');
      expect(content?.text).toBe(USER_SESSION_WIDGET_HTML);
      widgetBodies.push(content?.text || '');
      expect(content?._meta?.ui?.csp?.connectDomains).toEqual([]);
      expect(content?._meta?.ui?.csp?.resourceDomains).toEqual([]);
      expect(content?._meta?.ui?.domain).toBeUndefined();
      expect(content?._meta?.['openai/widgetDomain']).toBeUndefined();
      expect(content?._meta?.['openai/widgetCSP']).toEqual({
        connect_domains: [],
        resource_domains: [],
        redirect_domains: ['https://flaim.app'],
      });
    }
    expect(widgetBodies).toHaveLength(2);
    expect(widgetBodies[0]).toBe(widgetBodies[1]);
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('serves only the two static widget resources without authorization', async () => {
    const authFetch = vi.fn();
    const env = buildEnv(authFetch);
    const expectedUris = [LEGACY_USER_SESSION_WIDGET_URI, USER_SESSION_WIDGET_URI];

    const listResponse = await app.fetch(
      buildUnauthenticatedMcpJsonRpcRequest('/mcp', 'resources/list'),
      env,
      mockExecutionContext()
    );
    expect(listResponse.status).toBe(200);
    const listPayload = await parseJsonRpcResponse(listResponse);
    expect(listPayload.result?.resources?.map((item) => item.uri).sort()).toEqual(
      [...expectedUris].sort()
    );

    const widgetBodies: string[] = [];
    for (const [index, uri] of expectedUris.entries()) {
      const readResponse = await app.fetch(
        buildUnauthenticatedMcpJsonRpcRequest(
          '/mcp',
          'resources/read',
          { uri },
          `unauthenticated-resources-read-${index + 1}`
        ),
        env,
        mockExecutionContext()
      );
      expect(readResponse.status).toBe(200);
      const readPayload = await parseJsonRpcResponse(readResponse);
      const content = readPayload.result?.contents?.find((item) => item.uri === uri);
      expect(content?.mimeType).toBe('text/html;profile=mcp-app');
      expect(content?.text).toBe(USER_SESSION_WIDGET_HTML);
      widgetBodies.push(content?.text || '');
    }
    expect(widgetBodies).toHaveLength(2);
    expect(widgetBodies[0]).toBe(widgetBodies[1]);
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('serves a known static resource despite an invalid incidental bearer but still rejects tools', async () => {
    const authFetch = vi.fn(async () => new Response('invalid token', { status: 401 }));
    const env = buildEnv(authFetch);

    const readResponse = await app.fetch(
      buildMcpJsonRpcRequest(
        '/mcp',
        'resources/read',
        { uri: USER_SESSION_WIDGET_URI },
        'invalid-bearer-static-resource'
      ),
      env,
      mockExecutionContext()
    );
    expect(readResponse.status).toBe(200);
    const readPayload = await parseJsonRpcResponse(readResponse);
    const content = readPayload.result?.contents?.find(
      (item) => item.uri === USER_SESSION_WIDGET_URI
    );
    expect(content?.mimeType).toBe('text/html;profile=mcp-app');
    expect(content?.text).toBe(USER_SESSION_WIDGET_HTML);
    expect(authFetch).not.toHaveBeenCalled();

    const toolResponse = await app.fetch(
      buildMcpJsonRpcRequest(
        '/mcp',
        'tools/call',
        { name: 'get_user_session', arguments: {} },
        'invalid-bearer-user-data-tool'
      ),
      env,
      mockExecutionContext()
    );
    expect(toolResponse.status).toBe(401);
    expect(toolResponse.headers.get('WWW-Authenticate')).toContain(
      'resource_metadata="https://api.flaim.app/.well-known/oauth-protected-resource"'
    );
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  it('keeps unknown resources and user-data tools protected without authorization', async () => {
    const authFetch = vi.fn();
    const env = buildEnv(authFetch);

    const requests = [
      buildUnauthenticatedMcpJsonRpcRequest(
        '/mcp',
        'resources/read',
        { uri: 'ui://widget/user-session-v999.html' },
        'unauthenticated-unknown-resource'
      ),
      buildUnauthenticatedMcpJsonRpcRequest(
        '/mcp',
        'tools/call',
        { name: 'get_user_session', arguments: {} },
        'unauthenticated-user-data-tool'
      ),
    ];

    for (const request of requests) {
      const response = await app.fetch(request, env, mockExecutionContext());
      expect(response.status).toBe(401);
      expect(response.headers.get('WWW-Authenticate')).toContain(
        'resource_metadata="https://api.flaim.app/.well-known/oauth-protected-resource"'
      );
    }
    expect(authFetch).not.toHaveBeenCalled();
  });

  // ChatGPT's directory review fetches the widget template before the user's
  // OAuth header is attached, so the anonymous handshake must stay open.
  // These tests pin that at the wire level: tightening the auth gate to 401
  // anonymous initialize would reintroduce the FLA-217 rejection class while
  // every unit test stayed green.
  it('accepts an anonymous initialize handshake without authorization', async () => {
    const authFetch = vi.fn();
    const env = buildEnv(authFetch);

    const response = await app.fetch(
      buildUnauthenticatedMcpJsonRpcRequest(
        '/mcp',
        'initialize',
        {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'wire-test-client', version: '1.0.0' },
        },
        'unauthenticated-initialize'
      ),
      env,
      mockExecutionContext()
    );

    expect(response.status).not.toBe(401);
    expect(response.status).toBe(200);
    const payload = await parseJsonRpcResponse(response);
    expect(payload.error).toBeUndefined();
    expect(payload.result?.serverInfo?.name).toBe('fantasy-mcp');
    expect(payload.result?.instructions).toBeTruthy();
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('accepts an anonymous notifications/initialized without authorization', async () => {
    const authFetch = vi.fn();
    const env = buildEnv(authFetch);

    // Notifications carry no id, so build the request inline rather than via
    // the JSON-RPC request helper.
    const response = await app.fetch(
      new Request('https://api.flaim.app/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
      }),
      env,
      mockExecutionContext()
    );

    expect(response.status).not.toBe(401);
    expect(response.status).toBe(202);
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('serves a static widget resource anonymously on the /fantasy/mcp alias', async () => {
    const authFetch = vi.fn();
    const env = buildEnv(authFetch);

    const readResponse = await app.fetch(
      buildUnauthenticatedMcpJsonRpcRequest(
        '/fantasy/mcp',
        'resources/read',
        { uri: USER_SESSION_WIDGET_URI },
        'unauthenticated-fantasy-alias-resources-read'
      ),
      env,
      mockExecutionContext()
    );
    expect(readResponse.status).toBe(200);
    const readPayload = await parseJsonRpcResponse(readResponse);
    const content = readPayload.result?.contents?.find(
      (item) => item.uri === USER_SESSION_WIDGET_URI
    );
    expect(content?.mimeType).toBe('text/html;profile=mcp-app');
    expect(content?.text).toBe(USER_SESSION_WIDGET_HTML);
    expect(authFetch).not.toHaveBeenCalled();
  });

  it('rejects unknown widget resource URIs', async () => {
    const authFetch = vi.fn(async () =>
      new Response(JSON.stringify({ valid: true, userId: 'user-123', scope: 'mcp:read mcp:write', authType: 'oauth' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const env = buildEnv(authFetch);

    const response = await app.fetch(
      buildMcpJsonRpcRequest(
        '/mcp',
        'resources/read',
        { uri: 'ui://widget/user-session-v999.html' },
        'resources-read-unknown'
      ),
      env,
      mockExecutionContext()
    );
    expect(response.status).toBe(200);
    const payload = await parseJsonRpcResponse(response);
    expect(payload.error?.code).toBe(-32602);
    expect(payload.error?.message).toContain('ui://widget/user-session-v999.html not found');
  });

  it('fails closed with 401 when introspection returns non-OK', async () => {
    const authFetch = vi.fn(async () => new Response('boom', { status: 500 }));
    const env = buildEnv(authFetch);

    const response = await app.fetch(buildMcpRequest('/mcp'), env, mockExecutionContext());
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain('resource="https://api.flaim.app/mcp"');
  });

  it('fails closed with 401 when introspection reports invalid token', async () => {
    const authFetch = vi.fn(async () =>
      new Response(JSON.stringify({ valid: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const env = buildEnv(authFetch);

    const response = await app.fetch(buildMcpRequest('/mcp'), env, mockExecutionContext());
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain('resource="https://api.flaim.app/mcp"');
  });

  it('fails closed with 401 when introspection scope is empty and uses fantasy resource routing', async () => {
    const authFetch = vi.fn(async () =>
      new Response(JSON.stringify({ valid: true, userId: 'user-123', scope: '   ', authType: 'oauth' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const env = buildEnv(authFetch);

    const response = await app.fetch(buildMcpRequest('/fantasy/mcp'), env, mockExecutionContext());
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain('resource="https://api.flaim.app/fantasy/mcp"');

    expect(authFetch).toHaveBeenCalledTimes(1);
    const introspectReq = authFetch.mock.calls[0]?.[0] as Request;
    expect(introspectReq.headers.get('X-Flaim-Expected-Resource')).toBe('https://api.flaim.app/fantasy/mcp');
    expect(introspectReq.headers.get(INTERNAL_SERVICE_TOKEN_HEADER)).toBe('internal-secret');
  });

  it('routes tools/call through to platform worker and returns shaped MCP response', async () => {
    const authFetch = vi.fn(async () =>
      new Response(JSON.stringify({ valid: true, userId: 'user-123', scope: 'mcp:read mcp:write', authType: 'oauth' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const espnFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ success: true, data: { leagueId: '123', standings: [] } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const env = buildEnv(authFetch);
    env.ESPN = { fetch: espnFetch } as unknown as Fetcher;

    const request = new Request('https://api.flaim.app/mcp', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'call-test-1',
        method: 'tools/call',
        params: {
          name: 'get_standings',
          arguments: { platform: 'espn', sport: 'football', league_id: '123', season_year: 2025 },
        },
      }),
    });

    const response = await app.fetch(request, env, mockExecutionContext());
    expect(response.status).toBe(200);

    const contentType = response.headers.get('Content-Type') || '';
    let result: { isError?: boolean; content?: unknown[] };
    if (contentType.includes('text/event-stream')) {
      const text = await response.text();
      const data = text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n').trim();
      const parsed = JSON.parse(data) as { result?: { isError?: boolean; content?: unknown[] } };
      result = parsed.result ?? {};
    } else {
      const parsed = await response.json() as { result?: { isError?: boolean; content?: unknown[] } };
      result = parsed.result ?? {};
    }

    expect(result.isError).not.toBe(true);
    expect(Array.isArray(result.content)).toBe(true);
    expect(espnFetch).toHaveBeenCalledTimes(1);
  });

  it('routes get_free_agents tools/call to sleeper worker when platform is sleeper', async () => {
    const authFetch = vi.fn(async () =>
      new Response(JSON.stringify({ valid: true, userId: 'user-123', scope: 'mcp:read mcp:write', authType: 'oauth' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const sleeperFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          data: {
            platform: 'sleeper',
            sport: 'football',
            league_id: 'league-42',
            season_year: 2025,
            count: 1,
            players: [{ id: 'p9', name: 'Sleeper FA', position: 'QB', team: 'BUF' }],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const env = buildEnv(authFetch);
    env.SLEEPER = { fetch: sleeperFetch } as unknown as Fetcher;

    const request = new Request('https://api.flaim.app/mcp', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'call-test-sleeper-free-agents',
        method: 'tools/call',
        params: {
          name: 'get_free_agents',
          arguments: {
            platform: 'sleeper',
            sport: 'football',
            league_id: 'league-42',
            season_year: 2025,
            count: 10,
          },
        },
      }),
    });

    const response = await app.fetch(request, env, mockExecutionContext());
    expect(response.status).toBe(200);
    const contentType = response.headers.get('Content-Type') || '';
    let result: { isError?: boolean; content?: Array<{ text?: string }> };
    if (contentType.includes('text/event-stream')) {
      const text = await response.text();
      const data = text.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('\n').trim();
      const parsed = JSON.parse(data) as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
      result = parsed.result ?? {};
    } else {
      const parsed = await response.json() as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
      result = parsed.result ?? {};
    }

    expect(result.isError).not.toBe(true);
    const payloadText = result.content?.[0]?.text ?? '';
    expect(payloadText).toContain('"platform": "sleeper"');
    expect(payloadText).toContain('"name": "Sleeper FA"');
  });

  it('rate-limits when authType is absent (safe default)', async () => {
    const authFetch = vi.fn(async () =>
      new Response(JSON.stringify({ valid: true, userId: 'user-789', scope: 'mcp:read' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const env = {
      ...buildEnv(authFetch),
      MCP_RATE_LIMITER: { limit: async () => ({ success: false }) },
    };

    const response = await app.fetch(buildMcpRequest('/mcp'), env, mockExecutionContext());
    expect(response.status).toBe(429);
  });

  it('returns 429 with Retry-After when rate limiter rejects an oauth request', async () => {
    const authFetch = vi.fn(async () =>
      new Response(JSON.stringify({ valid: true, userId: 'user-123', scope: 'mcp:read', authType: 'oauth' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const env = {
      ...buildEnv(authFetch),
      MCP_RATE_LIMITER: { limit: async () => ({ success: false }) },
    };

    const response = await app.fetch(buildMcpRequest('/mcp'), env, mockExecutionContext());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    const body = await response.json() as { jsonrpc: string; error: { code: number; message: string } };
    expect(body.jsonrpc).toBe('2.0');
    expect(body.error.code).toBe(-32029);
  });

  it('returns 429 with Retry-After when rate limiter rejects a clerk request', async () => {
    const authFetch = vi.fn(async () =>
      new Response(JSON.stringify({ valid: true, userId: 'user-456', scope: 'mcp:read', authType: 'clerk' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const env = {
      ...buildEnv(authFetch),
      MCP_RATE_LIMITER: { limit: async () => ({ success: false }) },
    };

    const response = await app.fetch(buildMcpRequest('/mcp'), env, mockExecutionContext());
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    const body = await response.json() as { jsonrpc: string; error: { code: number; message: string } };
    expect(body.jsonrpc).toBe('2.0');
    expect(body.error.code).toBe(-32029);
  });

  it('does not rate-limit eval-api-key requests even when limiter rejects', async () => {
    const authFetch = vi.fn(async () =>
      new Response(JSON.stringify({ valid: true, userId: 'eval-user', scope: 'mcp:read', authType: 'eval-api-key' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const env = {
      ...buildEnv(authFetch),
      MCP_RATE_LIMITER: { limit: async () => ({ success: false }) },
    };

    const response = await app.fetch(buildMcpRequest('/mcp'), env, mockExecutionContext());
    expect(response.status).toBe(200);
  });

  it('does not rate-limit demo-api-key requests even when limiter rejects', async () => {
    const authFetch = vi.fn(async () =>
      new Response(JSON.stringify({ valid: true, userId: 'demo-user', scope: 'mcp:read', authType: 'demo-api-key' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const env = {
      ...buildEnv(authFetch),
      MCP_RATE_LIMITER: { limit: async () => ({ success: false }) },
    };

    const response = await app.fetch(buildMcpRequest('/mcp'), env, mockExecutionContext());
    expect(response.status).toBe(200);
  });

  it('routes get_user_session and returns leagues from all platforms', async () => {
    const currentFootballSeason = getDefaultSeasonYear('football');
    const espnLeague = {
      platform: 'espn',
      sport: 'football',
      leagueId: '336777',
      leagueName: 'Test ESPN League',
      teamId: '1',
      teamName: 'My Team',
      seasonYear: currentFootballSeason,
    };
    const yahooLeague = {
      sport: 'football',
      leagueKey: '449.l.12345',
      leagueName: 'Test Yahoo League',
      teamId: '1',
      teamName: 'My Yahoo Team',
      seasonYear: currentFootballSeason,
    };
    const sleeperLeague = {
      platform: 'sleeper',
      sport: 'football',
      leagueId: 'sleeper-league-1',
      leagueName: 'Test Sleeper League',
      teamId: 'sl-1',
      teamName: 'My Sleeper Team',
      seasonYear: currentFootballSeason,
    };

    const authFetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === '/internal/introspect') {
        return new Response(
          JSON.stringify({ valid: true, userId: 'user-123', scope: 'mcp:read mcp:write', authType: 'oauth' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.pathname === '/internal/leagues') {
        return new Response(
          JSON.stringify({ success: true, leagues: [espnLeague] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.pathname === '/internal/leagues/yahoo') {
        return new Response(
          JSON.stringify({ leagues: [yahooLeague] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.pathname === '/internal/leagues/sleeper') {
        return new Response(
          JSON.stringify({ leagues: [sleeperLeague] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('not found', { status: 404 });
    });

    const env = buildEnv(authFetch);

    const request = new Request('https://api.flaim.app/mcp', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'session-test-1',
        method: 'tools/call',
        params: { name: 'get_user_session', arguments: {} },
      }),
    });

    const response = await app.fetch(request, env, mockExecutionContext());
    expect(response.status).toBe(200);

    const contentType = response.headers.get('Content-Type') || '';
    let result: { isError?: boolean; content?: Array<{ text?: string }> };
    if (contentType.includes('text/event-stream')) {
      const text = await response.text();
      const data = text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n').trim();
      const parsed = JSON.parse(data) as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
      result = parsed.result ?? {};
    } else {
      const parsed = await response.json() as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
      result = parsed.result ?? {};
    }

    expect(result.isError).not.toBe(true);
    expect(Array.isArray(result.content)).toBe(true);
    const payloadText = result.content?.[0]?.text ?? '';
    expect(payloadText).toContain('Test ESPN League');
    expect(payloadText).toContain('Test Yahoo League');
    expect(payloadText).toContain('Test Sleeper League');
  });

  it('emits a fire-and-forget usage event to /internal/usage-event after a tool call', async () => {
    const usageRequests: Request[] = [];
    const authFetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === '/internal/introspect') {
        return new Response(
          JSON.stringify({
            valid: true,
            userId: 'user-123',
            scope: 'mcp:read mcp:write',
            authType: 'oauth',
            client_name: 'Claude',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.pathname === '/internal/usage-event') {
        // Clone so the body stays readable after the gateway consumes it.
        usageRequests.push(request.clone());
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    });
    const espnFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ success: true, data: { leagueId: '123', standings: [] } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const env = buildEnv(authFetch);
    env.ESPN = { fetch: espnFetch } as unknown as Fetcher;

    const { ctx, settled } = collectingExecutionContext();
    const request = new Request('https://api.flaim.app/mcp', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'usage-event-test-1',
        method: 'tools/call',
        params: {
          name: 'get_standings',
          arguments: { platform: 'espn', sport: 'football', league_id: '123', season_year: 2025 },
        },
      }),
    });

    const response = await app.fetch(request, env, ctx);
    expect(response.status).toBe(200);
    // Drain the SSE body so the streamed tool handler (and its finally emit) runs.
    await response.text();

    // The emit must be fire-and-forget via executionCtx.waitUntil — never awaited inline.
    expect(ctx.waitUntil).toHaveBeenCalled();
    await settled();

    expect(usageRequests).toHaveLength(1);
    const usageReq = usageRequests[0];
    expect(usageReq.method).toBe('POST');
    expect(usageReq.headers.get(INTERNAL_SERVICE_TOKEN_HEADER)).toBe('internal-secret');

    const body = await usageReq.json() as Record<string, unknown>;
    expect(body.tool_name).toBe('get_standings');
    expect(body.status).toBe('ok');
    expect(body.user_id).toBe('user-123');
    expect(body.auth_type).toBe('oauth');
    expect(body.client_name).toBe('Claude');
    expect(body.platform).toBe('espn');
    expect(body.sport).toBe('football');
    expect(typeof body.latency_ms).toBe('number');
    // league_hash is the SHA-256 hex of `espn:123` (64 hex chars).
    expect(typeof body.league_hash).toBe('string');
    expect(body.league_hash).toHaveLength(64);
    expect(body).toHaveProperty('correlation_id');
    expect(espnFetch).toHaveBeenCalledTimes(1);
  });

  it('emits a single denied usage event (latency null) and skips the handler when the scope check fails', async () => {
    const usageRequests: Request[] = [];
    const authFetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === '/internal/introspect') {
        // 'mcp:write' is non-empty so it clears the gateway scope gate, but it
        // lacks 'mcp:read' — which get_standings requires — so the per-tool
        // scope check in server.ts denies the call before the handler runs.
        return new Response(
          JSON.stringify({ valid: true, userId: 'user-123', scope: 'mcp:write', authType: 'oauth', client_name: 'Claude' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.pathname === '/internal/usage-event') {
        usageRequests.push(request.clone());
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    });
    const espnFetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    const env = buildEnv(authFetch);
    env.ESPN = { fetch: espnFetch } as unknown as Fetcher;

    const { ctx, settled } = collectingExecutionContext();
    const request = new Request('https://api.flaim.app/mcp', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'usage-denied-1',
        method: 'tools/call',
        params: {
          name: 'get_standings',
          arguments: { platform: 'espn', sport: 'football', league_id: '123', season_year: 2025 },
        },
      }),
    });

    const response = await app.fetch(request, env, ctx);
    expect(response.status).toBe(200);
    const text = await response.text();
    const data = text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n').trim();
    const parsed = JSON.parse(data) as { result?: { isError?: boolean; content?: Array<{ text?: string }>; _meta?: Record<string, unknown> } };
    // The tool call resolves to the MCP auth error, not a handler result.
    expect(parsed.result?.isError).toBe(true);
    expect(parsed.result?.content?.[0]?.text).toContain('AUTH_FAILED');
    const challenge = (parsed.result?._meta?.['mcp/www_authenticate'] as string[] | undefined)?.[0];
    expect(challenge).toContain('scope="mcp:read"');
    expect(challenge).toContain('resource_metadata="https://api.flaim.app/.well-known/oauth-protected-resource"');

    // Handler must NOT run on the denied path.
    expect(espnFetch).not.toHaveBeenCalled();

    await settled();
    expect(usageRequests).toHaveLength(1);
    const body = await usageRequests[0].json() as Record<string, unknown>;
    expect(body.tool_name).toBe('get_standings');
    expect(body.status).toBe('denied');
    expect(body.latency_ms).toBeNull();
    expect(body.user_id).toBe('user-123');
  });

  it('propagates a thrown handler error and emits a single error usage event', async () => {
    const usageRequests: Request[] = [];
    const authFetch = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      if (url.pathname === '/internal/introspect') {
        return new Response(
          JSON.stringify({ valid: true, userId: 'user-123', scope: 'mcp:read', authType: 'oauth', client_name: 'Claude' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.pathname === '/internal/usage-event') {
        usageRequests.push(request.clone());
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    });
    const env = buildEnv(authFetch);

    // Inject a single tool whose handler throws. The MCP SDK wraps a *propagated*
    // throw into an isError CallToolResult carrying the thrown message — so seeing
    // that message in the response proves server.ts re-propagated the throw and
    // its finally-block emit did not swallow it. status stays 'error' on this path.
    const explodingTool: UnifiedTool = {
      name: 'explode',
      title: 'Explode',
      description: 'Test-only tool whose handler always throws.',
      inputSchema: {},
      requiredScope: 'mcp:read',
      securitySchemes: [{ type: 'oauth2', scopes: ['mcp:read'] }],
      handler: async () => {
        throw new Error('handler boom');
      },
    };
    vi.mocked(getUnifiedTools).mockReturnValueOnce([explodingTool]);

    const { ctx, settled } = collectingExecutionContext();
    const request = new Request('https://api.flaim.app/mcp', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'usage-error-1',
        method: 'tools/call',
        params: { name: 'explode', arguments: {} },
      }),
    });

    const response = await app.fetch(request, env, ctx);
    expect(response.status).toBe(200);
    const text = await response.text();
    const data = text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n').trim();
    const parsed = JSON.parse(data) as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
    // The thrown message surfaces — only possible if the throw propagated.
    expect(parsed.result?.isError).toBe(true);
    expect(parsed.result?.content?.[0]?.text).toContain('handler boom');

    await settled();
    expect(usageRequests).toHaveLength(1);
    const body = await usageRequests[0].json() as Record<string, unknown>;
    expect(body.tool_name).toBe('explode');
    expect(body.status).toBe('error');
    expect(typeof body.latency_ms).toBe('number');
  });
});
