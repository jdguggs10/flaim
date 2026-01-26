import { describe, expect, it, vi, type MockedFunction } from 'vitest';
import { getUnifiedTools } from '../mcp/tools';
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
      'get_user_session',
    ]);
  });

  it('get_user_session throws on auth failure', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_user_session');
    expect(tool).toBeTruthy();

    const env = {
      AUTH_WORKER: {
        fetch: async () => new Response('unauthorized', { status: 401 }),
      },
    } as unknown as Env;

    await expect(tool!.handler({}, env, 'Bearer test-token')).rejects.toThrow('AUTH_FAILED');
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
    expect(routeToClient).toHaveBeenCalledWith(env, 'get_league_info', args, 'Bearer token', correlationId);

    const text = result.content?.[0]?.text;
    const payload = JSON.parse(text as string) as { success?: boolean; data?: unknown };
    expect(payload.success).toBe(true);
    expect(payload.data).toEqual({ league: { id: 123, name: 'Test League' } });
  });
});
