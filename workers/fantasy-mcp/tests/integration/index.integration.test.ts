import { describe, expect, it, vi } from 'vitest';
import app from '../../src/index';
import type { Env } from '../../src/types';
import { getUnifiedTools } from '../../src/mcp/tools';

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

function mockExecutionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

function buildEnv(authFetch: (request: Request) => Promise<Response>): Env {
  return {
    AUTH_WORKER: { fetch: authFetch } as unknown as Fetcher,
    ESPN: { fetch: vi.fn() } as unknown as Fetcher,
    YAHOO: { fetch: vi.fn() } as unknown as Fetcher,
  } as unknown as Env;
}

describe('fantasy-mcp gateway integration', () => {
  it('emits _meta.securitySchemes in tools/list wire response', async () => {
    const authFetch = vi.fn(async () =>
      new Response(JSON.stringify({ valid: true, userId: 'user-123', scope: 'mcp:read mcp:write' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const env = buildEnv(authFetch);

    const response = await app.fetch(buildMcpRequest('/mcp'), env, mockExecutionContext());
    expect(response.status).toBe(200);

    const payload = await response.json() as {
      result?: {
        tools?: Array<{
          name: string;
          _meta?: { securitySchemes?: { oauth?: { type?: string; scope?: string } } };
        }>;
      };
    };
    const tools = payload.result?.tools;
    expect(Array.isArray(tools)).toBe(true);

    const scopeByTool = new Map(getUnifiedTools().map((tool) => [tool.name, tool.requiredScope]));
    for (const tool of tools || []) {
      expect(tool._meta?.securitySchemes?.oauth?.type).toBe('oauth2');
      expect(tool._meta?.securitySchemes?.oauth?.scope).toBe(scopeByTool.get(tool.name));
    }

    expect(authFetch).toHaveBeenCalledTimes(1);
    const introspectReq = authFetch.mock.calls[0]?.[0] as Request;
    expect(introspectReq.url).toBe('https://internal/auth/introspect');
    expect(introspectReq.headers.get('X-Flaim-Expected-Resource')).toBe('https://api.flaim.app/mcp');
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
      new Response(JSON.stringify({ valid: true, userId: 'user-123', scope: '   ' }), {
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
  });
});
