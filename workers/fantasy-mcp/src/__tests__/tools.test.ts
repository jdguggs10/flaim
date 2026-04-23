import { describe, expect, it, vi, type MockedFunction } from 'vitest';
import type { z } from 'zod';
import { getUnifiedTools, hasRequiredScope, mcpAuthError } from '../mcp/tools';
import { buildMcpAuthErrorResponse } from '../auth-response';
import type { Env } from '../types';
import { routeToClient } from '../router';

/** Helper to cast an AnySchema value to z3 ZodTypeAny for .parse() in tests. */
const asZod = (schema: unknown) => schema as z.ZodTypeAny;

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
      'get_players',
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
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
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
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
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

    // structuredContent mirrors the text payload
    expect(result.structuredContent).toBeDefined();
    expect((result.structuredContent as Record<string, unknown>).totalLeaguesFound).toBe(0);
  });

  it('get_user_session keeps canonical current-season labels in the session payload', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_user_session');
    expect(tool).toBeTruthy();

    const env = {
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
      AUTH_WORKER: {
        fetch: async () =>
          new Response(JSON.stringify({ leagues: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
      },
    } as unknown as Env;

    const result = await tool!.handler({}, env, 'Bearer test-token');
    const payload = JSON.parse(result.content[0].text) as {
      currentSeasons: Record<string, { year: number; label: string }>;
    };

    expect(payload.currentSeasons.football.label).toBe(String(payload.currentSeasons.football.year));
    expect(payload.currentSeasons.baseball.label).toBe(String(payload.currentSeasons.baseball.year));
    expect(payload.currentSeasons.basketball.label).toBe(
      `${payload.currentSeasons.basketball.year}-${String(payload.currentSeasons.basketball.year + 1).slice(2)}`
    );
    expect(payload.currentSeasons.hockey.label).toBe(
      `${payload.currentSeasons.hockey.year}-${String(payload.currentSeasons.hockey.year + 1).slice(2)}`
    );
  });

  it('get_user_session includes widgetUri in tool definition', () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_user_session');
    expect(tool?.widgetUri).toBe('ui://widget/user-session.html');
  });

  it('get_user_session returns only current-season leagues', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_user_session');
    expect(tool).toBeTruthy();

    // Today is 2026-03-05: football current season = 2025, baseball current season = 2026
    const espnLeagues = [
      { platform: 'espn', sport: 'football', leagueId: 'fb1', leagueName: 'Gridiron', teamId: 't1', seasonYear: 2025 },
      { platform: 'espn', sport: 'football', leagueId: 'fb1', leagueName: 'Gridiron', teamId: 't1', seasonYear: 2024 },
      { platform: 'espn', sport: 'baseball', leagueId: 'bb1', leagueName: 'Diamond', teamId: 't2', seasonYear: 2026 },
      { platform: 'espn', sport: 'baseball', leagueId: 'bb1', leagueName: 'Diamond', teamId: 't2', seasonYear: 2025 },
    ];

    const env = {
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
      AUTH_WORKER: {
        fetch: async (req: Request) => {
          const url = new URL(req.url);
          if (url.pathname === '/internal/leagues') {
            return new Response(JSON.stringify({ leagues: espnLeagues }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          // Yahoo, Sleeper, preferences — empty
          return new Response(JSON.stringify({ leagues: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    } as unknown as Env;

    const result = await tool!.handler({}, env, 'Bearer test-token');
    const payload = JSON.parse(result.content[0].text) as {
      allLeagues: Array<{ leagueId: string; seasonYear: number; sport: string }>;
      totalLeaguesFound: number;
    };

    // Should have exactly 2 entries: football 2025 and baseball 2026
    expect(payload.totalLeaguesFound).toBe(2);
    const football = payload.allLeagues.find((l) => l.sport === 'football');
    const baseball = payload.allLeagues.find((l) => l.sport === 'baseball');
    expect(football?.seasonYear).toBe(2025);
    expect(baseball?.seasonYear).toBe(2026);
  });

  it('get_ancient_history includes last season from active leagues', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_ancient_history');
    expect(tool).toBeTruthy();

    // Today is 2026-03-05: football current season = 2025, baseball current season = 2026
    const espnLeagues = [
      { platform: 'espn', sport: 'football', leagueId: 'fb1', leagueName: 'Gridiron', teamId: 't1', seasonYear: 2025 },
      { platform: 'espn', sport: 'football', leagueId: 'fb1', leagueName: 'Gridiron', teamId: 't1', seasonYear: 2024 },
      { platform: 'espn', sport: 'baseball', leagueId: 'bb1', leagueName: 'Diamond', teamId: 't2', seasonYear: 2026 },
      { platform: 'espn', sport: 'baseball', leagueId: 'bb1', leagueName: 'Diamond', teamId: 't2', seasonYear: 2025 },
    ];

    const env = {
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
      AUTH_WORKER: {
        fetch: async (req: Request) => {
          const url = new URL(req.url);
          if (url.pathname === '/internal/leagues') {
            return new Response(JSON.stringify({ leagues: espnLeagues }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({ leagues: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    } as unknown as Env;

    const result = await tool!.handler({}, env, 'Bearer test-token');
    const payload = JSON.parse(result.content[0].text) as {
      oldSeasonsFromActiveLeagues: Record<string, Array<{ seasonYear: number; sport: string }>>;
      totalOldSeasons: number;
    };

    // Football 2024 and baseball 2025 should be in oldSeasonsFromActiveLeagues
    expect(payload.totalOldSeasons).toBe(2);
    const allOldSeasons = Object.values(payload.oldSeasonsFromActiveLeagues).flat();
    const fbOld = allOldSeasons.find((s) => s.sport === 'football');
    const bbOld = allOldSeasons.find((s) => s.sport === 'baseball');
    expect(fbOld?.seasonYear).toBe(2024);
    expect(bbOld?.seasonYear).toBe(2025);
  });

  it('get_ancient_history keeps recurring Yahoo seasons under active leagues', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_ancient_history');
    expect(tool).toBeTruthy();

    const yahooLeagues = [
      { sport: 'football', leagueKey: '449.l.1000', leagueName: 'Touchdown League', teamId: 't1', seasonYear: 2024 },
      { sport: 'football', leagueKey: '461.l.1000', leagueName: 'Touchdown League', teamId: 't2', seasonYear: 2025 },
    ];

    const env = {
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
      AUTH_WORKER: {
        fetch: async (req: Request) => {
          const url = new URL(req.url);
          if (url.pathname === '/internal/leagues/yahoo') {
            return new Response(JSON.stringify({ leagues: yahooLeagues }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({ leagues: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    } as unknown as Env;

    const result = await tool!.handler({}, env, 'Bearer test-token');
    const payload = JSON.parse(result.content[0].text) as {
      oldLeagues: Array<{ platform: string; leagueId: string; seasonYear: number }>;
      oldSeasonsFromActiveLeagues: Record<string, Array<{ platform: string; leagueId: string; seasonYear: number }>>;
      totalOldLeagues: number;
      totalOldSeasons: number;
    };

    expect(payload.totalOldLeagues).toBe(0);
    expect(payload.totalOldSeasons).toBe(1);
    const allOldSeasons = Object.values(payload.oldSeasonsFromActiveLeagues).flat();
    expect(allOldSeasons).toHaveLength(1);
    expect(allOldSeasons[0]).toMatchObject({
      platform: 'yahoo',
      leagueId: '449.l.1000',
      seasonYear: 2024,
    });
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

    const schema = tool!.inputSchema;
    expect(asZod(schema.platform).parse('sleeper')).toBe('sleeper');
  });

  it('get_free_agents schema still accepts espn and yahoo platforms', () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_free_agents');
    expect(tool).toBeTruthy();

    const schema = tool!.inputSchema;
    expect(asZod(schema.platform).parse('espn')).toBe('espn');
    expect(asZod(schema.platform).parse('yahoo')).toBe('yahoo');
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

  it('get_players schema remains unchanged and includes ownership guardrails in description', () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_players');
    expect(tool).toBeTruthy();

    const schema = tool!.inputSchema;
    expect(asZod(schema.query).parse('judge')).toBe('judge');
    expect(asZod(schema.platform).parse('espn')).toBe('espn');
    expect(asZod(schema.sport).parse('baseball')).toBe('baseball');
    expect(asZod(schema.league_id).parse('449.l.123')).toBe('449.l.123');
    expect(asZod(schema.season_year).parse(2025)).toBe(2025);
    expect(asZod(schema.position).parse('OF')).toBe('OF');
    expect(asZod(schema.count).parse(25)).toBe(25);

    expect(tool!.description).toContain('market/global ownership');
    expect(tool!.description).toContain('league_status');
    expect(tool!.description).toContain('league_team_name');
    expect(tool!.description).toContain('league_owner_name');
    expect(tool!.description).toContain('get_league_info');
    expect(tool!.description).toContain('get_roster');
  });

  // Test A: multi-league, no defaultSport pref → defaultLeague should be null
  it('get_user_session: multiple leagues with no defaultSport → defaultLeague is null', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_user_session');
    expect(tool).toBeTruthy();

    const twoLeagues = [
      { platform: 'espn', sport: 'football', leagueId: 'fb1', leagueName: 'Gridiron', teamId: 't1', seasonYear: 2025 },
      { platform: 'espn', sport: 'baseball', leagueId: 'bb1', leagueName: 'Diamond', teamId: 't2', seasonYear: 2026 },
    ];

    const env = {
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
      AUTH_WORKER: {
        fetch: async (req: Request) => {
          const url = new URL(req.url);
          if (url.pathname === '/internal/leagues') {
            return new Response(JSON.stringify({ leagues: twoLeagues }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (url.pathname === '/internal/user/preferences') {
            return new Response(JSON.stringify({ defaultSport: null }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({ leagues: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    } as unknown as Env;

    const result = await tool!.handler({}, env, 'Bearer test-token');
    const payload = JSON.parse(result.content[0].text) as {
      defaultLeague: unknown;
      totalLeaguesFound: number;
    };
    expect(payload.totalLeaguesFound).toBe(2);
    expect(payload.defaultLeague).toBeNull();
  });

  // Test B: single league, no prefs → defaultLeague auto-populated
  it('get_user_session: single league with no prefs → defaultLeague is auto-populated', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_user_session');
    expect(tool).toBeTruthy();

    // Yahoo leagues API uses leagueKey (not leagueId) — fetchYahooLeagues maps leagueKey → leagueId
    const oneYahooLeague = [
      { sport: 'football', leagueKey: '449.l.123', leagueName: 'My Yahoo League', teamId: 't5', seasonYear: 2025 },
    ];

    const env = {
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
      AUTH_WORKER: {
        fetch: async (req: Request) => {
          const url = new URL(req.url);
          if (url.pathname === '/internal/leagues') {
            return new Response(JSON.stringify({ leagues: [] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (url.pathname === '/internal/leagues/yahoo') {
            return new Response(JSON.stringify({ leagues: oneYahooLeague }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({ leagues: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    } as unknown as Env;

    const result = await tool!.handler({}, env, 'Bearer test-token');
    const payload = JSON.parse(result.content[0].text) as {
      defaultLeague: { leagueId: string; platform: string; sport: string } | null;
      totalLeaguesFound: number;
    };
    expect(payload.totalLeaguesFound).toBe(1);
    expect(payload.defaultLeague).not.toBeNull();
    expect(payload.defaultLeague?.leagueId).toBe('449.l.123');
    expect(payload.defaultLeague?.platform).toBe('yahoo');
    expect(payload.defaultLeague?.sport).toBe('football');
  });

  // Test C: stale default → DELETE fires with platform+leagueId params, warning appended
  it('get_user_session: stale default fires conditional DELETE and appends warning', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_user_session');
    expect(tool).toBeTruthy();

    const activeLeague = { platform: 'espn', sport: 'baseball', leagueId: 'bb1', leagueName: 'Diamond', teamId: 't2', seasonYear: 2026 };
    // Football default points to a league that is no longer active
    const stalePrefs = {
      defaultSport: 'football',
      defaultFootball: { platform: 'espn', leagueId: 'old-fb', seasonYear: 2024 },
    };

    let deleteCalled = false;
    let deleteUrl: URL | null = null;

    const env = {
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
      AUTH_WORKER: {
        fetch: async (req: Request) => {
          const url = new URL(req.url);
          if (url.pathname === '/internal/leagues') {
            return new Response(JSON.stringify({ leagues: [activeLeague] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (url.pathname === '/internal/user/preferences') {
            return new Response(JSON.stringify(stalePrefs), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (req.method === 'DELETE' && url.pathname.startsWith('/internal/leagues/default/')) {
            deleteCalled = true;
            deleteUrl = url;
            return new Response(JSON.stringify({ success: true }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({ leagues: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    } as unknown as Env;

    const result = await tool!.handler({}, env, 'Bearer test-token');
    const payload = JSON.parse(result.content[0].text) as {
      warnings?: string[];
    };

    // DELETE should have been called with platform + leagueId + seasonYear query params
    expect(deleteCalled).toBe(true);
    expect(deleteUrl!.searchParams.get('platform')).toBe('espn');
    expect(deleteUrl!.searchParams.get('leagueId')).toBe('old-fb');
    expect(deleteUrl!.searchParams.get('seasonYear')).toBe('2024');

    // Warning should mention the stale league
    expect(payload.warnings).toBeDefined();
    expect(payload.warnings!.length).toBeGreaterThan(0);
    expect(payload.warnings![0]).toContain('old-fb');
  });

  it('get_user_session: stale default skips DELETE when platform fetch failed', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_user_session');
    expect(tool).toBeTruthy();

    const stalePrefs = {
      defaultSport: 'football',
      defaultFootball: { platform: 'yahoo', leagueId: 'nfl.l.123', seasonYear: 2025 },
    };

    let deleteCalled = false;

    const env = {
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
      AUTH_WORKER: {
        fetch: async (req: Request) => {
          const url = new URL(req.url);
          if (url.pathname === '/internal/leagues') {
            return new Response(JSON.stringify({ leagues: [] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (url.pathname === '/internal/leagues/yahoo') {
            // Simulate Yahoo fetch failure
            return new Response(JSON.stringify({ error: 'Yahoo API unavailable' }), {
              status: 502,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (url.pathname === '/internal/user/preferences') {
            return new Response(JSON.stringify(stalePrefs), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (req.method === 'DELETE' && url.pathname.startsWith('/internal/leagues/default/')) {
            deleteCalled = true;
            return new Response(JSON.stringify({ success: true }), { status: 200 });
          }
          return new Response(JSON.stringify({ leagues: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    } as unknown as Env;

    const result = await tool!.handler({}, env, 'Bearer test-token');
    const payload = JSON.parse(result.content[0].text) as { warnings?: string[] };

    // DELETE must NOT fire when the platform fetch failed
    expect(deleteCalled).toBe(false);
    // A warning should appear mentioning the unavailability (not clearing)
    expect(payload.warnings?.some((w) => w.includes('temporarily unavailable'))).toBe(true);
  });

  it('get_user_session: recurring Yahoo leagues dedup to current season only', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_user_session');
    expect(tool).toBeTruthy();

    // Same Yahoo league renewed across two seasons — game_key changes, stable league_id does not.
    const yahooLeagues = [
      { sport: 'football', leagueKey: '449.l.1000', leagueName: 'Touchdown League', teamId: 't1', seasonYear: 2024 },
      { sport: 'football', leagueKey: '461.l.1000', leagueName: 'Touchdown League', teamId: 't2', seasonYear: 2025 },
    ];

    const env = {
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
      AUTH_WORKER: {
        fetch: async (req: Request) => {
          const url = new URL(req.url);
          if (url.pathname === '/internal/leagues/yahoo') {
            return new Response(JSON.stringify({ leagues: yahooLeagues }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({ leagues: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    } as unknown as Env;

    const result = await tool!.handler({}, env, 'Bearer test-token');
    const payload = JSON.parse(result.content[0].text) as {
      allLeagues: Array<{ platform: string; sport: string; leagueId: string; seasonYear: number }>;
      totalLeaguesFound: number;
    };

    // Only the 2025 season should appear — 2024 is superseded
    const yahooFootball = payload.allLeagues.filter(
      (l) => l.platform === 'yahoo' && l.sport === 'football'
    );
    expect(yahooFootball).toHaveLength(1);
    expect(yahooFootball[0].seasonYear).toBe(2025);
    expect(yahooFootball[0].leagueId).toBe('461.l.1000');
  });

  it('get_user_session: distinct Yahoo leagues with the same name remain separate', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_user_session');
    expect(tool).toBeTruthy();

    const yahooLeagues = [
      { sport: 'football', leagueKey: '461.l.1000', leagueName: 'Touchdown League', teamId: 't1', seasonYear: 2025 },
      { sport: 'football', leagueKey: '461.l.2000', leagueName: 'Touchdown League', teamId: 't2', seasonYear: 2025 },
    ];

    const env = {
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
      AUTH_WORKER: {
        fetch: async (req: Request) => {
          const url = new URL(req.url);
          if (url.pathname === '/internal/leagues/yahoo') {
            return new Response(JSON.stringify({ leagues: yahooLeagues }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          return new Response(JSON.stringify({ leagues: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    } as unknown as Env;

    const result = await tool!.handler({}, env, 'Bearer test-token');
    const payload = JSON.parse(result.content[0].text) as {
      allLeagues: Array<{ platform: string; sport: string; leagueId: string; leagueName: string }>;
      totalLeaguesFound: number;
    };

    const yahooFootball = payload.allLeagues.filter(
      (l) => l.platform === 'yahoo' && l.sport === 'football'
    );
    expect(payload.totalLeaguesFound).toBe(2);
    expect(yahooFootball).toHaveLength(2);
    expect(yahooFootball.map((l) => l.leagueId).sort()).toEqual(['461.l.1000', '461.l.2000']);
  });

  it('get_players routes unchanged to client', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_players');
    expect(tool).toBeTruthy();

    const routeToClientMock = routeToClient as MockedFunction<typeof routeToClient>;
    routeToClientMock.mockResolvedValue({
      success: true,
      data: { count: 1, players: [{ id: '123', name: 'Aaron Judge', ownership_scope: 'platform_global' }] },
    });

    const env = {} as Env;
    const args = {
      platform: 'espn',
      sport: 'baseball',
      league_id: '123',
      season_year: 2025,
      query: 'judge',
      position: 'OF',
      count: 5,
    };

    const correlationId = 'corr-search-players';
    const result = await tool!.handler(args, env, 'Bearer token', correlationId);
    expect(routeToClient).toHaveBeenCalledWith(
      env,
      'get_players',
      {
        platform: 'espn',
        sport: 'baseball',
        league_id: '123',
        season_year: 2025,
        query: 'judge',
        position: 'OF',
        count: 5,
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

  it('get_matchups week schema rejects zero and negative values', () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_matchups');
    expect(tool).toBeTruthy();

    const weekSchema = asZod(tool!.inputSchema.week);
    // Valid: undefined (optional), positive integer
    expect(weekSchema.safeParse(undefined).success).toBe(true);
    expect(weekSchema.safeParse(1).success).toBe(true);
    expect(weekSchema.safeParse(17).success).toBe(true);
    // Invalid: zero, negative, float
    expect(weekSchema.safeParse(0).success).toBe(false);
    expect(weekSchema.safeParse(-1).success).toBe(false);
    expect(weekSchema.safeParse(1.5).success).toBe(false);
  });

  it('get_roster week schema rejects zero and negative values', () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_roster');
    expect(tool).toBeTruthy();

    const weekSchema = asZod(tool!.inputSchema.week);
    expect(weekSchema.safeParse(undefined).success).toBe(true);
    expect(weekSchema.safeParse(1).success).toBe(true);
    expect(weekSchema.safeParse(0).success).toBe(false);
    expect(weekSchema.safeParse(-1).success).toBe(false);
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
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
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
