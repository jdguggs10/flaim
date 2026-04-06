import { describe, expect, it, vi } from 'vitest';
import app from '../../src/index';
import type { Env } from '../../src/types';
import { getUnifiedTools } from '../../src/mcp/tools';
import { INTERNAL_SERVICE_TOKEN_HEADER } from '@flaim/worker-shared';

function buildMcpRequest(pathname: '/mcp' | '/fantasy/mcp'): Request {
  return new Request(`https://api.flaim.app${pathname}`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'wire-test-1',
      method: 'tools/list',
      params: {},
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

async function parseJsonRpcResponse(response: Response): Promise<{
  result?: {
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
      _meta?: { securitySchemes?: Array<{ type?: string; scopes?: string[] }> };
    }>;
  };
}> {
  const contentType = response.headers.get('Content-Type') || '';

  if (contentType.includes('application/json')) {
    return response.json() as Promise<{
      result?: {
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
          _meta?: { securitySchemes?: Array<{ type?: string; scopes?: string[] }> };
        }>;
      };
    }>;
  }

  if (contentType.includes('text/event-stream')) {
    const text = await response.text();
    const data = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
      .trim();
    return JSON.parse(data) as {
      result?: {
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
          _meta?: { securitySchemes?: Array<{ type?: string; scopes?: string[] }> };
        }>;
      };
    };
  }

  throw new Error(`Unsupported MCP response content type: ${contentType}`);
}

function mockExecutionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
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
  it('accepts GET on MCP transport endpoints for SSE streaming', async () => {
    const authFetch = vi.fn(async () => new Response('unexpected', { status: 500 }));
    const env = buildEnv(authFetch);

    const mcpResponse = await app.fetch(buildMcpGetRequest('/mcp'), env, mockExecutionContext());
    expect(mcpResponse.status).toBe(200);

    const fantasyResponse = await app.fetch(buildMcpGetRequest('/fantasy/mcp'), env, mockExecutionContext());
    expect(fantasyResponse.status).toBe(200);

    // Auth should not be called for unauthenticated GET (public handshake)
    expect(authFetch).not.toHaveBeenCalled();
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

    const scopeByTool = new Map(getUnifiedTools().map((tool) => [tool.name, tool.requiredScope]));
    for (const tool of tools || []) {
      expect(tool._meta?.securitySchemes?.[0]?.type).toBe('oauth2');
      expect(tool._meta?.securitySchemes?.[0]?.scopes).toContain(scopeByTool.get(tool.name));
      // OpenAI Apps Directory review expects these hints to be explicitly declared.
      expect(tool.annotations).toEqual({
        readOnlyHint: true,
        openWorldHint: true,
        destructiveHint: false,
        idempotentHint: true,
      });
    }

    expect(authFetch).toHaveBeenCalledTimes(1);
    const introspectReq = authFetch.mock.calls[0]?.[0] as Request;
    expect(introspectReq.url).toBe('https://internal/internal/introspect');
    expect(introspectReq.headers.get('X-Flaim-Expected-Resource')).toBe('https://api.flaim.app/mcp');
    expect(introspectReq.headers.get(INTERNAL_SERVICE_TOKEN_HEADER)).toBe('internal-secret');
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
});
