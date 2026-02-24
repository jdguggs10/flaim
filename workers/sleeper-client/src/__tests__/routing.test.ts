import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import app from '../index';
import type { Env } from '../types';
import { footballHandlers } from '../sports/football/handlers';

const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch;

function mockExecutionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

async function executeRequest(
  sport: string,
  tool = 'get_league_info',
  env: Env = {} as Env
): Promise<{ success: boolean; code?: string }> {
  const req = new Request('https://internal/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, params: { sport, league_id: 'lg1', season_year: 2025 } }),
  });
  const res = await app.fetch(req, env, mockExecutionContext());
  return res.json() as Promise<{ success: boolean; code?: string }>;
}

describe('sleeper-client sport routing', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns SPORT_NOT_SUPPORTED for baseball', async () => {
    const body = await executeRequest('baseball');
    expect(body.success).toBe(false);
    expect(body.code).toBe('SPORT_NOT_SUPPORTED');
  });

  it('returns SPORT_NOT_SUPPORTED for hockey', async () => {
    const body = await executeRequest('hockey');
    expect(body.success).toBe(false);
    expect(body.code).toBe('SPORT_NOT_SUPPORTED');
  });

  it('passes env bindings through execute route', async () => {
    const env = {
      SLEEPER_PLAYERS_CACHE: {} as KVNamespace,
    } as Env;
    const handlerSpy = vi.spyOn(footballHandlers, 'get_league_info').mockImplementation(async (receivedEnv: Env) => ({
      success: receivedEnv === env,
    }));

    const body = await executeRequest('football', 'get_league_info', env);
    expect(handlerSpy).toHaveBeenCalledTimes(1);
    expect(body.success).toBe(true);
  });

  it('returns UNKNOWN_TOOL for unknown football tool when env is provided', async () => {
    const env = {
      SLEEPER_PLAYERS_CACHE: {} as KVNamespace,
    } as Env;
    const body = await executeRequest('football', 'unknown_tool_name', env);
    expect(body.success).toBe(false);
    expect(body.code).toBe('UNKNOWN_TOOL');
  });

  it('routes get_free_agents for supported sport with structured success payload', async () => {
    const env = {
      SLEEPER_PLAYERS_CACHE: {
        get: vi.fn().mockResolvedValueOnce(JSON.stringify([
          { player_id: 'p1', full_name: 'Rostered', position: 'QB', team: 'BUF', active: true },
          { player_id: 'p2', full_name: 'Available', position: 'QB', team: 'KC', active: true },
        ])),
        put: vi.fn(),
      } as unknown as KVNamespace,
    } as Env;

    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([
      { players: ['p1'] },
    ]), { status: 200 }));

    const req = new Request('https://internal/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'get_free_agents',
        params: { sport: 'football', league_id: 'lg1', season_year: 2025, count: 10, position: 'QB' },
      }),
    });

    const res = await app.fetch(req, env, mockExecutionContext());
    const body = await res.json() as {
      success: boolean;
      data?: { players?: Array<{ id: string }>; count?: number; league_id?: string };
    };

    expect(body.success).toBe(true);
    expect(body.data?.league_id).toBe('lg1');
    expect(body.data?.count).toBe(1);
    expect(body.data?.players?.[0]?.id).toBe('p2');
  });

  it('routes get_free_agents for basketball with structured success payload', async () => {
    const env = {
      SLEEPER_PLAYERS_CACHE: {
        get: vi.fn().mockResolvedValueOnce(JSON.stringify([
          { player_id: 'b1', full_name: 'Rostered Guard', position: 'PG', team: 'BOS', active: true },
          { player_id: 'b2', full_name: 'Available Guard', position: 'PG', team: 'NYK', active: true },
        ])),
        put: vi.fn(),
      } as unknown as KVNamespace,
    } as Env;

    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify([
      { players: ['b1'] },
    ]), { status: 200 }));

    const req = new Request('https://internal/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'get_free_agents',
        params: { sport: 'basketball', league_id: 'lg2', season_year: 2025, count: 10, position: 'PG' },
      }),
    });

    const res = await app.fetch(req, env, mockExecutionContext());
    const body = await res.json() as {
      success: boolean;
      data?: { players?: Array<{ id: string }>; count?: number; league_id?: string };
    };

    expect(body.success).toBe(true);
    expect(body.data?.league_id).toBe('lg2');
    expect(body.data?.count).toBe(1);
    expect(body.data?.players?.[0]?.id).toBe('b2');
  });
});
