import { describe, expect, it, vi, type MockedFunction } from 'vitest';
import { getUnifiedTools, hasRequiredScope, mcpAuthError } from '../mcp/tools';
import { buildMcpAuthErrorResponse } from '../auth-response';
import type { Env } from '../types';
import { routeToClient } from '../router';

vi.mock('../router', () => ({
  routeToClient: vi.fn(),
}));

describe('fantasy-mcp tools', () => {
  it('exposes the unified tool set', () => {
    const tools = getUnifiedTools();
    const names = tools.map((tool) => tool.name).sort();

    expect(names).toEqual([
      'get_ancient_history',
      'get_free_agents',
      'get_league_info',
      'get_matchups',
      'get_roster',
      'get_standings',
      'get_transactions',
      'get_user_session',
    ]);
  });

  it('get_user_session returns auth error with _meta on 401', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_user_session');
    expect(tool).toBeTruthy();

    const env = {
      AUTH_WORKER: {
        fetch: async () => new Response('unauthorized', { status: 401 }),
      },
    } as unknown as Env;

    const result = await tool!.handler({}, env, 'Bearer test-token');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('AUTH_FAILED');
    expect(result._meta?.['mcp/www_authenticate']).toBeDefined();
  });

  it('get_user_session returns success payload for empty leagues', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_user_session');
    expect(tool).toBeTruthy();

    const env = {
      AUTH_WORKER: {
        fetch: async () =>
          new Response(JSON.stringify({ leagues: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      },
    } as unknown as Env;

    const result = await tool!.handler({}, env, 'Bearer test-token');
    const text = result.content?.[0]?.text;
    expect(typeof text).toBe('string');

    const payload = JSON.parse(text as string) as { success?: boolean; totalLeaguesFound?: number };
    expect(payload.success).toBe(true);
    expect(payload.totalLeaguesFound).toBe(0);
  });

  it('get_league_info routes to client and formats a success payload', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_league_info');
    expect(tool).toBeTruthy();

    const routeToClientMock = routeToClient as MockedFunction<typeof routeToClient>;
    routeToClientMock.mockResolvedValue({
      success: true,
      data: { league: { id: 123, name: 'Test League' } },
    });

    const env = {} as Env;
    const args = {
      platform: 'espn',
      sport: 'football',
      league_id: '123',
      season_year: 2024,
    };

    const correlationId = 'corr-456';
    const result = await tool!.handler(args, env, 'Bearer token', correlationId);
    expect(routeToClient).toHaveBeenCalledWith(
      env,
      'get_league_info',
      args,
      'Bearer token',
      correlationId,
      undefined,
      undefined
    );

    const text = result.content?.[0]?.text;
    const payload = JSON.parse(text as string) as { success?: boolean; data?: unknown };
    expect(payload.success).toBe(true);
    expect(payload.data).toEqual({ league: { id: 123, name: 'Test League' } });
  });

  it('get_transactions routes with clamped count and preserves filters', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_transactions');
    expect(tool).toBeTruthy();

    const routeToClientMock = routeToClient as MockedFunction<typeof routeToClient>;
    routeToClientMock.mockResolvedValue({
      success: true,
      data: { count: 1, transactions: [{ transaction_id: 'tx-1', type: 'trade' }] },
    });

    const env = {} as Env;
    const args = {
      platform: 'yahoo',
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      type: 'trade',
      count: 999,
    };

    const correlationId = 'corr-789';
    const result = await tool!.handler(args, env, 'Bearer token', correlationId);
    expect(routeToClient).toHaveBeenCalledWith(
      env,
      'get_transactions',
      {
        platform: 'yahoo',
        sport: 'football',
        league_id: '449.l.123',
        season_year: 2025,
        week: undefined,
        type: 'trade',
        count: 100,
      },
      'Bearer token',
      correlationId,
      undefined,
      undefined
    );

    const text = result.content?.[0]?.text;
    const payload = JSON.parse(text as string) as { success?: boolean; data?: { count?: number } };
    expect(payload.success).toBe(true);
    expect(payload.data?.count).toBe(1);
  });

  it('get_free_agents schema accepts sleeper platform', () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_free_agents');
    expect(tool).toBeTruthy();

    const schema = tool!.inputSchema as { platform: { parse: (value: unknown) => unknown } };
    expect(schema.platform.parse('sleeper')).toBe('sleeper');
  });

  it('get_free_agents schema still accepts espn and yahoo platforms', () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_free_agents');
    expect(tool).toBeTruthy();

    const schema = tool!.inputSchema as { platform: { parse: (value: unknown) => unknown } };
    expect(schema.platform.parse('espn')).toBe('espn');
    expect(schema.platform.parse('yahoo')).toBe('yahoo');
  });

  it('get_free_agents routes sleeper params to client', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_free_agents');
    expect(tool).toBeTruthy();

    const routeToClientMock = routeToClient as MockedFunction<typeof routeToClient>;
    routeToClientMock.mockResolvedValue({
      success: true,
      data: { count: 0, players: [] },
    });

    const env = {} as Env;
    const args = {
      platform: 'sleeper',
      sport: 'football',
      league_id: '123',
      season_year: 2025,
      count: 10,
    };

    const correlationId = 'corr-free-agents';
    const result = await tool!.handler(args, env, 'Bearer token', correlationId);
    expect(routeToClient).toHaveBeenCalledWith(
      env,
      'get_free_agents',
      {
        platform: 'sleeper',
        sport: 'football',
        league_id: '123',
        season_year: 2025,
        position: undefined,
        count: 10,
      },
      'Bearer token',
      correlationId,
      undefined,
      undefined
    );

    const text = result.content?.[0]?.text;
    const payload = JSON.parse(text as string) as { success?: boolean; data?: { count?: number } };
    expect(payload.success).toBe(true);
    expect(payload.data?.count).toBe(0);
  });

  it.each(['espn', 'yahoo'] as const)('get_free_agents routing remains unchanged for %s', async (platform) => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_free_agents');
    expect(tool).toBeTruthy();

    const routeToClientMock = routeToClient as MockedFunction<typeof routeToClient>;
    routeToClientMock.mockResolvedValue({
      success: true,
      data: { count: 2, players: [{ id: 'p1' }, { id: 'p2' }] },
    });

    const env = {} as Env;
    const args = {
      platform,
      sport: 'football',
      league_id: '123',
      season_year: 2025,
      position: 'QB',
      count: 15,
    };

    const correlationId = `corr-free-agents-${platform}`;
    const result = await tool!.handler(args, env, 'Bearer token', correlationId);
    expect(routeToClient).toHaveBeenCalledWith(
      env,
      'get_free_agents',
      {
        platform,
        sport: 'football',
        league_id: '123',
        season_year: 2025,
        position: 'QB',
        count: 15,
      },
      'Bearer token',
      correlationId,
      undefined,
      undefined
    );

    const text = result.content?.[0]?.text;
    const payload = JSON.parse(text as string) as { success?: boolean; data?: { count?: number } };
    expect(payload.success).toBe(true);
    expect(payload.data?.count).toBe(2);
  });

  it('each tool declares a required scope', () => {
    const tools = getUnifiedTools();
    for (const tool of tools) {
      expect(tool.requiredScope).toBeDefined();
      expect(['mcp:read', 'mcp:write']).toContain(tool.requiredScope);
    }
  });

  it('each tool declares securitySchemes (source) for _meta mirror', () => {
    const tools = getUnifiedTools();
    for (const tool of tools) {
      // Source: explicit securitySchemes field on UnifiedTool
      expect(tool.securitySchemes).toBeDefined();
      expect(tool.securitySchemes).toEqual([
        { type: 'oauth2', scopes: [tool.requiredScope] },
      ]);

      // Mirror construction: { securitySchemes: tool.securitySchemes } should match
      // what server.ts passes to registerTool's _meta
      const mirrorMeta = { securitySchemes: tool.securitySchemes };
      expect(mirrorMeta.securitySchemes[0]?.scopes).toContain(tool.requiredScope);
    }
  });
});

describe('auth error _meta', () => {
  it('auth failure response includes _meta with mcp/www_authenticate', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_user_session');

    const env = {
      AUTH_WORKER: {
        fetch: async () => new Response('unauthorized', { status: 401 }),
      },
    } as unknown as Env;

    const result = await tool!.handler({}, env, 'Bearer bad-token');
    expect(result.isError).toBe(true);
    expect(result._meta).toBeDefined();
    expect(result._meta?.['mcp/www_authenticate']).toBeDefined();
    expect(Array.isArray(result._meta?.['mcp/www_authenticate'])).toBe(true);
  });

  it('scope-denied mcpAuthError includes correct resource_metadata URL', () => {
    const result = mcpAuthError('https://api.flaim.app/mcp');
    expect(result.isError).toBe(true);
    expect(result._meta).toBeDefined();
    expect(Array.isArray(result._meta?.['mcp/www_authenticate'])).toBe(true);
    const challenge = (result._meta?.['mcp/www_authenticate'] as string[])[0];
    expect(challenge).toContain('Bearer');
    // Must point to the actual served route, not /mcp/.well-known
    expect(challenge).toContain('resource_metadata="https://api.flaim.app/.well-known/oauth-protected-resource"');
    expect(challenge).not.toContain('/mcp/.well-known');
  });

  it('mcpAuthError derives correct metadata URL for /fantasy/mcp resource', () => {
    const result = mcpAuthError('https://api.flaim.app/fantasy/mcp');
    const challenge = (result._meta?.['mcp/www_authenticate'] as string[])[0];
    expect(challenge).toContain('resource_metadata="https://api.flaim.app/fantasy/.well-known/oauth-protected-resource"');
    expect(challenge).not.toContain('/fantasy/mcp/.well-known');
  });
});

describe('buildMcpAuthErrorResponse', () => {
  it('401 includes resource_metadata in WWW-Authenticate', () => {
    const request = new Request('https://api.flaim.app/mcp', { method: 'POST' });
    const response = buildMcpAuthErrorResponse(request);

    expect(response.status).toBe(401);
    const wwwAuth = response.headers.get('WWW-Authenticate')!;
    expect(wwwAuth).toContain('resource_metadata=');
    expect(wwwAuth).toContain('.well-known/oauth-protected-resource');
  });

  it('uses /fantasy/mcp resource for /fantasy/* paths', () => {
    const request = new Request('https://api.flaim.app/fantasy/mcp', { method: 'POST' });
    const response = buildMcpAuthErrorResponse(request);

    const wwwAuth = response.headers.get('WWW-Authenticate')!;
    expect(wwwAuth).toContain('resource="https://api.flaim.app/fantasy/mcp"');
    expect(wwwAuth).toContain('resource_metadata="https://api.flaim.app/fantasy/.well-known/oauth-protected-resource"');
  });

  it('resource_metadata for /mcp points to root .well-known', () => {
    const request = new Request('https://api.flaim.app/mcp', { method: 'POST' });
    const response = buildMcpAuthErrorResponse(request);

    const wwwAuth = response.headers.get('WWW-Authenticate')!;
    expect(wwwAuth).toContain('resource_metadata="https://api.flaim.app/.well-known/oauth-protected-resource"');
    // Must NOT contain /mcp/.well-known (that route doesn't exist)
    expect(wwwAuth).not.toContain('/mcp/.well-known');
  });
});

describe('gateway introspection fail-closed', () => {
  // Tests the fail-closed contract that handleMcpRequest in index.ts relies on:
  // if introspection returns !ok, !valid, or empty scope, the gateway must reject.
  // We can't import index.ts directly (MCP SDK workerd JSON module issue),
  // so we validate the introspection contract at the component level.

  it('hasRequiredScope rejects undefined scope (fail-closed)', () => {
    expect(hasRequiredScope(undefined, 'mcp:read')).toBe(false);
  });

  it('hasRequiredScope rejects empty string scope (fail-closed)', () => {
    expect(hasRequiredScope('', 'mcp:read')).toBe(false);
    expect(hasRequiredScope('  ', 'mcp:read')).toBe(false);
  });

  it('hasRequiredScope rejects scope that does not contain required', () => {
    expect(hasRequiredScope('mcp:write', 'mcp:read')).toBe(false);
    expect(hasRequiredScope('other:scope', 'mcp:read')).toBe(false);
  });
});

describe('hasRequiredScope', () => {
  it('rejects when scope is insufficient', () => {
    expect(hasRequiredScope('mcp:write', 'mcp:read')).toBe(false);
    expect(hasRequiredScope(undefined, 'mcp:read')).toBe(false);
    expect(hasRequiredScope('', 'mcp:read')).toBe(false);
  });

  it('accepts when scope matches', () => {
    expect(hasRequiredScope('mcp:read', 'mcp:read')).toBe(true);
    expect(hasRequiredScope('mcp:read mcp:write', 'mcp:read')).toBe(true);
    expect(hasRequiredScope('mcp:read mcp:write', 'mcp:write')).toBe(true);
  });
});
