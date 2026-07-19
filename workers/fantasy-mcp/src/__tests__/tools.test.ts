import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import type { z } from 'zod';
import { getUnifiedTools, hasRequiredScope, mcpAuthError } from '../mcp/tools';
import { buildMcpAuthErrorResponse } from '../auth-response';
import type { Env } from '../types';
import { routeToClient } from '../router';
import {
  classifyRefreshResult,
  USER_SESSION_WIDGET_HTML,
  USER_SESSION_WIDGET_URI,
} from '../widgets/user-session-widget';
import { INTERNAL_SERVICE_TOKEN_HEADER } from '@flaim/worker-shared';

/** Helper to cast an AnySchema value to z3 ZodTypeAny for .parse() in tests. */
const asZod = (schema: unknown) => schema as z.ZodTypeAny;

vi.mock('../router', () => ({
  routeToClient: vi.fn(),
}));

describe('fantasy-mcp tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-05T12:00:00-05:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

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
      'refresh_leagues',
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

    const payload = JSON.parse(text as string) as {
      success?: boolean;
      totalLeaguesFound?: number;
      instructions?: string;
    };
    expect(payload.success).toBe(true);
    expect(payload.totalLeaguesFound).toBe(0);
    expect(payload.instructions).toContain('https://flaim.app/leagues');
    expect(payload.instructions).not.toContain('flaim.app/settings');

    // structuredContent mirrors the text payload
    expect(result.structuredContent).toBeDefined();
    expect((result.structuredContent as Record<string, unknown>).totalLeaguesFound).toBe(0);
    expect(result._meta?.ui).toEqual({ resourceUri: USER_SESSION_WIDGET_URI });
    expect(result._meta?.['openai/outputTemplate']).toBe(USER_SESSION_WIDGET_URI);
    expect(result._meta?.['openai/widgetAccessible']).toBe(true);
    expect(result._meta?.['openai/resultCanProduceWidget']).toBe(true);
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
    expect(tool?.widgetUri).toBe(USER_SESSION_WIDGET_URI);
  });

  it('user session widget declares the MCP Apps lifecycle messages', () => {
    // The widget is shipped as serialized HTML, so these assertions guard the
    // protocol strings that MCP Apps hosts need to see at runtime.
    expect(USER_SESSION_WIDGET_HTML).toContain("method: 'ui/initialize'");
    expect(USER_SESSION_WIDGET_HTML).toContain("protocolVersion: '2026-01-26'");
    expect(USER_SESSION_WIDGET_HTML).toContain("method: 'ui/notifications/initialized'");
    expect(USER_SESSION_WIDGET_HTML).toContain("msg.method === 'ui/notifications/tool-result'");
    expect(USER_SESSION_WIDGET_HTML).toContain("msg.method === 'ui/resource-teardown'");
    expect(USER_SESSION_WIDGET_HTML).toContain('isTrustedMessageEvent(event)');
  });

  it('user session widget refreshes through callTool and reloads session output', () => {
    expect(USER_SESSION_WIDGET_HTML).toContain("window.openai.callTool('refresh_leagues', {})");
    expect(USER_SESSION_WIDGET_HTML).toContain("window.openai.callTool('get_user_session', {})");
    expect(USER_SESSION_WIDGET_HTML).toContain('extractRefreshResult');
    expect(USER_SESSION_WIDGET_HTML).toContain('refreshResult && refreshResult.isError');
    expect(USER_SESSION_WIDGET_HTML).toContain('classifyRefreshResult(refreshPayload)');
    expect(USER_SESSION_WIDGET_HTML).toContain('Leagues refreshed.');
    expect(USER_SESSION_WIDGET_HTML).toContain('Refresh failed.');
    expect(USER_SESSION_WIDGET_HTML).toContain('Open leagues');
    expect(USER_SESSION_WIDGET_HTML).toContain('classification.showLeaguesLink');
    expect(USER_SESSION_WIDGET_HTML).toContain('var hasRendered = false');
    expect(USER_SESSION_WIDGET_HTML).not.toContain('if (rendered) return');
  });

  it.each([
    {
      name: 'complete success',
      payload: { success: true, results: { espn: { platform: 'espn', status: 'success', details: { added: 2 } } } },
      expected: { kind: 'success', message: 'Leagues refreshed.', reloadSession: true },
    },
    {
      name: 'no changes',
      payload: { success: true, results: { espn: { platform: 'espn', status: 'success', details: { currentSeason: { added: 0, refreshed: 0 } } } } },
      expected: { kind: 'unchanged', message: 'Leagues already up to date.', reloadSession: true },
    },
    {
      name: 'partial success',
      payload: { success: true, results: { espn: { status: 'success' }, yahoo: { status: 'error', httpStatus: 500 } } },
      expected: { kind: 'partial', message: 'Refresh partially complete.', reloadSession: true },
    },
    {
      name: 'rate limit',
      payload: { success: false, results: { yahoo: { status: 'error', httpStatus: 429, retryAfter: '30' } } },
      expected: { kind: 'retry', message: 'Refresh limited. Try again later.', reloadSession: false },
    },
    {
      name: 'reconnect required',
      payload: { success: false, results: { espn: { status: 'error', httpStatus: 401, error: 'espn_auth_failed' } } },
      expected: { kind: 'reconnect', message: 'Reconnect a league provider.', reloadSession: false },
    },
    {
      name: 'skipped only',
      payload: { success: false, results: { sleeper: { status: 'skipped', error: 'not_connected' } } },
      expected: { kind: 'unchanged', message: 'No connected leagues to refresh.', reloadSession: false },
    },
    {
      name: 'generic failure',
      payload: { success: false, results: { espn: { status: 'error', httpStatus: 500, error: 'discovery_failed' } } },
      expected: { kind: 'failure', message: 'Refresh failed.', reloadSession: false },
    },
  ])('classifies refresh result: $name', ({ payload, expected }) => {
    expect(classifyRefreshResult(payload)).toEqual(expected);
  });

  it.each([
    {
      name: 'Yahoo count',
      payload: {
        success: true,
        results: {
          yahoo: {
            platform: 'yahoo',
            status: 'success',
            httpStatus: 200,
            details: { success: true, count: 2, leagues: [{ league_key: '449.l.1' }] },
          },
        },
      },
      expected: { kind: 'success', message: 'Refresh complete.', reloadSession: true },
    },
    {
      name: 'Yahoo zero count',
      payload: {
        success: true,
        results: {
          yahoo: {
            platform: 'yahoo',
            status: 'success',
            httpStatus: 200,
            details: { success: true, count: 0, leagues: [] },
          },
        },
      },
      expected: { kind: 'success', message: 'Refresh complete.', reloadSession: true },
    },
    {
      name: 'Sleeper leagues_found',
      payload: {
        success: true,
        results: {
          sleeper: {
            platform: 'sleeper',
            status: 'success',
            httpStatus: 200,
            details: { success: true, username: 'demo', leagues_found: 3, seasons_discovered: 2 },
          },
        },
      },
      expected: { kind: 'success', message: 'Refresh complete.', reloadSession: true },
    },
    {
      name: 'Sleeper zero leagues_found',
      payload: {
        success: true,
        results: {
          sleeper: {
            platform: 'sleeper',
            status: 'success',
            httpStatus: 200,
            details: { success: true, username: 'demo', leagues_found: 0, seasons_discovered: 0 },
          },
        },
      },
      expected: { kind: 'success', message: 'Refresh complete.', reloadSession: true },
    },
    {
      name: 'ESPN zero mutation counts',
      payload: {
        success: true,
        results: {
          espn: {
            platform: 'espn',
            status: 'success',
            httpStatus: 200,
            details: {
              discovered: [{ sport: 'football', leagueId: '12345' }],
              currentSeason: { found: 1, added: 0, alreadySaved: 1, refreshed: 0 },
              pastSeasons: { found: 0, added: 0, alreadySaved: 0, refreshed: 0 },
              currentSeasonCount: 1,
              pastSeasonsCount: 0,
            },
          },
        },
      },
      expected: { kind: 'unchanged', message: 'Leagues already up to date.', reloadSession: true },
    },
  ])('classifies real provider change shape: $name', ({ payload, expected }) => {
    expect(classifyRefreshResult(payload)).toEqual(expected);
  });

  it('classifies a top-level 429 wrapper without provider results as retryable', () => {
    expect(classifyRefreshResult({ success: false, status: 429, error: 'rate_limited' })).toEqual({
      kind: 'retry',
      message: 'Refresh limited. Try again later.',
      reloadSession: false,
    });
  });

  it('classifies mixed success and provider auth failure as partial with a leagues link', () => {
    expect(classifyRefreshResult({
      success: true,
      results: {
        sleeper: { platform: 'sleeper', status: 'success', details: { leagues_found: 1 } },
        yahoo: { platform: 'yahoo', status: 'error', httpStatus: 401, error: 'token_expired' },
      },
    })).toEqual({
      kind: 'partial',
      message: 'Refresh partially complete. Reconnect a provider.',
      reloadSession: true,
      showLeaguesLink: true,
    });
  });

  it('does not claim Yahoo refreshed when Yahoo succeeds without mutation evidence and another provider fails', () => {
    expect(classifyRefreshResult({
      success: true,
      results: {
        yahoo: {
          platform: 'yahoo',
          status: 'success',
          details: { success: true, count: 2, leagues: [{ league_key: '449.l.1' }] },
        },
        sleeper: { platform: 'sleeper', status: 'error', httpStatus: 500, error: 'discovery_failed' },
      },
    })).toEqual({
      kind: 'partial',
      message: 'Refresh partially complete.',
      reloadSession: true,
    });
  });

  it.each([
    {
      platform: 'yahoo',
      details: { nested: { updated: 4, saved: 2 } },
    },
    {
      platform: 'sleeper',
      details: { nested: { updated: 0, saved: 0 } },
    },
  ])('keeps neutral wording for $platform success with misleading mutation fields', ({ platform, details }) => {
    expect(classifyRefreshResult({
      success: true,
      results: {
        [platform]: { platform, status: 'success', details },
      },
    })).toEqual({
      kind: 'success',
      message: 'Refresh complete.',
      reloadSession: true,
    });
  });

  it('checks a tool-level error before classifying a success-looking payload', () => {
    const errorGuard = USER_SESSION_WIDGET_HTML.indexOf('refreshResult && refreshResult.isError');
    const classification = USER_SESSION_WIDGET_HTML.indexOf(
      'var classification = classifyRefreshResult(refreshPayload)',
    );

    expect(errorGuard).toBeGreaterThan(-1);
    expect(classification).toBeGreaterThan(errorGuard);
  });

  it('does not let ESPN zero-change evidence classify an unknown Yahoo success as unchanged', () => {
    expect(classifyRefreshResult({
      success: true,
      results: {
        espn: {
          platform: 'espn',
          status: 'success',
          details: { currentSeason: { found: 1, added: 0, alreadySaved: 1, refreshed: 0 } },
        },
        yahoo: {
          platform: 'yahoo',
          status: 'success',
          details: { success: true, count: 1, leagues: [{ league_key: '449.l.1' }] },
        },
      },
    })).toEqual({
      kind: 'success',
      message: 'Refresh complete.',
      reloadSession: true,
    });
  });

  it.each([
    {
      name: 'Yahoo success with expected unconnected providers',
      payload: {
        success: true,
        results: {
          yahoo: { platform: 'yahoo', status: 'success', details: { count: 2 } },
          espn: { platform: 'espn', status: 'skipped', error: 'credentials_not_found' },
          sleeper: { platform: 'sleeper', status: 'skipped', error: 'not_connected' },
        },
      },
      expected: { kind: 'success', message: 'Refresh complete.', reloadSession: true },
    },
    {
      name: 'unchanged ESPN success with expected unconnected providers',
      payload: {
        success: true,
        results: {
          espn: {
            platform: 'espn',
            status: 'success',
            details: { currentSeason: { found: 1, added: 0, alreadySaved: 1, refreshed: 0 } },
          },
          yahoo: { platform: 'yahoo', status: 'skipped', error: 'not_connected' },
          sleeper: { platform: 'sleeper', status: 'skipped', error: 'not_connected' },
        },
      },
      expected: { kind: 'unchanged', message: 'Leagues already up to date.', reloadSession: true },
    },
  ])('ignores skipped providers beside a successful refresh: $name', ({ payload, expected }) => {
    expect(classifyRefreshResult(payload)).toEqual(expected);
  });

  it('classifies a rate-limit error plus an unconnected skip as retryable', () => {
    expect(classifyRefreshResult({
      success: false,
      results: {
        yahoo: { platform: 'yahoo', status: 'error', httpStatus: 429, error: 'rate_limited' },
        sleeper: { platform: 'sleeper', status: 'skipped', error: 'not_connected' },
      },
    })).toEqual({
      kind: 'retry',
      message: 'Refresh limited. Try again later.',
      reloadSession: false,
    });
  });

  it('does not report provider success without the explicit batch success guard', () => {
    expect(classifyRefreshResult({
      success: false,
      results: { espn: { status: 'success', details: { added: 1 } } },
    })).toEqual({ kind: 'failure', message: 'Refresh failed.', reloadSession: false });
  });

  it('describes refresh as repeatable metadata mutation without claiming idempotence', () => {
    const tool = getUnifiedTools().find((candidate) => candidate.name === 'refresh_leagues');

    expect(tool?.openaiMeta?.invoked).toBe('Refresh complete');
    expect(tool?.description).toContain('repeated refreshes can update Flaim registry timestamps and provider metadata');
    expect(tool?.description).toContain('If this call errors, do not repeat it unchanged.');
    expect(tool?.description).not.toContain('idempotent');
  });

  it('user session widget opens the empty-state league setup link externally', () => {
    expect(USER_SESSION_WIDGET_HTML).toContain('Flaim is connected, but no fantasy leagues are set up yet.');
    expect(USER_SESSION_WIDGET_HTML).toContain('id="connect-league-link"');
    expect(USER_SESSION_WIDGET_HTML).toContain("connectLeagueLink.addEventListener('click', openLeagues)");
    expect(USER_SESSION_WIDGET_HTML).toContain('window.openai.openExternal({ href: LEAGUES_URL })');
  });

  it('refresh_leagues forwards the user auth and internal token to auth-worker', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'refresh_leagues');
    expect(tool).toBeTruthy();

    let capturedRequest: Request | null = null;
    const env = {
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
      AUTH_WORKER: {
        fetch: async (req: Request) => {
          capturedRequest = req;
          return new Response(JSON.stringify({
            success: true,
            requestedPlatforms: ['espn'],
            results: {
              espn: { platform: 'espn', status: 'success', httpStatus: 200 },
            },
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    } as unknown as Env;

    const result = await tool!.handler(
      { platforms: ['espn'] },
      env,
      'Bearer user-token',
      'corr-refresh',
      'eval-run',
      'eval-trace'
    );

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ success: true });
    expect(capturedRequest).toBeTruthy();
    expect(new URL(capturedRequest!.url).pathname).toBe('/internal/leagues/refresh');
    expect(capturedRequest!.method).toBe('POST');
    expect(capturedRequest!.headers.get('Authorization')).toBe('Bearer user-token');
    expect(capturedRequest!.headers.get(INTERNAL_SERVICE_TOKEN_HEADER)).toBe('internal-secret');
    expect(capturedRequest!.headers.get('X-Correlation-ID')).toBe('corr-refresh');
    expect(await capturedRequest!.json()).toEqual({ platforms: ['espn'] });
  });

  it('refresh_leagues rejects invalid platforms instead of widening to all platforms', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'refresh_leagues');
    expect(tool).toBeTruthy();

    let calledAuthWorker = false;
    const env = {
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
      AUTH_WORKER: {
        fetch: async () => {
          calledAuthWorker = true;
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    } as unknown as Env;

    const result = await tool!.handler(
      { platforms: ['not-real'] },
      env,
      'Bearer user-token',
      'corr-refresh-invalid'
    );

    expect(calledAuthWorker).toBe(false);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Invalid platform(s): not-real');
  });

  it('refresh_leagues rejects empty platform arrays instead of widening to all platforms', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'refresh_leagues');
    expect(tool).toBeTruthy();

    let calledAuthWorker = false;
    const env = {
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
      AUTH_WORKER: {
        fetch: async () => {
          calledAuthWorker = true;
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    } as unknown as Env;

    const result = await tool!.handler({ platforms: [] }, env, 'Bearer user-token');

    expect(calledAuthWorker).toBe(false);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('platforms must include at least one platform');
  });

  it('refresh_leagues includes the write scope challenge when auth-worker denies refresh', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'refresh_leagues');
    expect(tool).toBeTruthy();

    const env = {
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
      AUTH_WORKER: {
        fetch: async () => {
          return new Response(JSON.stringify({
            error: 'insufficient_scope',
            error_description: 'mcp:write scope is required to refresh leagues',
          }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    } as unknown as Env;

    const result = await tool!.handler({ platforms: ['espn'] }, env, 'Bearer user-token');
    const challenge = (result._meta?.['mcp/www_authenticate'] as string[] | undefined)?.[0];

    expect(result.isError).toBe(true);
    expect(challenge).toContain('scope="mcp:write"');
  });

  it('refresh_leagues marks all-provider batch failures as MCP tool errors', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'refresh_leagues');
    expect(tool).toBeTruthy();

    const env = {
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
      AUTH_WORKER: {
        fetch: async () => {
          return new Response(JSON.stringify({
            success: false,
            requestedPlatforms: ['espn', 'yahoo'],
            results: {
              espn: { platform: 'espn', status: 'error', httpStatus: 500, error: 'discovery_failed' },
              yahoo: { platform: 'yahoo', status: 'error', httpStatus: 429, error: 'rate_limited' },
            },
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    } as unknown as Env;

    const result = await tool!.handler({ platforms: ['espn', 'yahoo'] }, env, 'Bearer user-token');

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ success: false });
  });

  it('refresh_leagues marks skipped-only unsuccessful batch results as MCP tool errors', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'refresh_leagues');
    expect(tool).toBeTruthy();

    const env = {
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
      AUTH_WORKER: {
        fetch: async () => {
          return new Response(JSON.stringify({
            success: false,
            requestedPlatforms: ['sleeper'],
            results: {
              sleeper: { platform: 'sleeper', status: 'skipped', httpStatus: 404, error: 'not_connected' },
            },
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    } as unknown as Env;

    const result = await tool!.handler({ platforms: ['sleeper'] }, env, 'Bearer user-token');

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ success: false });
  });

  it('user session widget reports the card size instead of the host frame size', () => {
    expect(USER_SESSION_WIDGET_HTML).toContain('var WIDGET_WIDTH = 353');
    expect(USER_SESSION_WIDGET_HTML).toContain("document.querySelector('.widget')");
    expect(USER_SESSION_WIDGET_HTML).toContain('Math.ceil(rect.width)');
    expect(USER_SESSION_WIDGET_HTML).not.toContain('document.documentElement.scrollWidth');
  });

  it('get_user_session keeps current ESPN leagues with identical numeric IDs across sports', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_user_session');
    expect(tool).toBeTruthy();

    // Today is 2026-03-05: football current season = 2025, baseball current season = 2026
    const espnLeagues = [
      { platform: 'espn', sport: 'football', leagueId: '12345', leagueName: 'Gridiron', teamId: 't1', seasonYear: 2025 },
      { platform: 'espn', sport: 'football', leagueId: '12345', leagueName: 'Gridiron', teamId: 't1', seasonYear: 2024 },
      { platform: 'espn', sport: 'baseball', leagueId: '12345', leagueName: 'Diamond', teamId: 't2', seasonYear: 2026 },
      { platform: 'espn', sport: 'baseball', leagueId: '12345', leagueName: 'Diamond', teamId: 't2', seasonYear: 2025 },
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

  it('get_ancient_history requests ?archived=exclude-hidden; get_user_session sends no archived param', async () => {
    // Guards the leak-critical MCP->endpoint contract: get_user_session must drop
    // ALL archived leagues (no param => endpoint default 'exclude-archived'), while
    // get_ancient_history opts into 'exclude-hidden' so 'historical' leagues remain
    // browsable but 'hidden' ones stay suppressed.
    const sessionTool = getUnifiedTools().find((t) => t.name === 'get_user_session');
    const historyTool = getUnifiedTools().find((t) => t.name === 'get_ancient_history');

    const seenUrls: string[] = [];
    const env = {
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
      AUTH_WORKER: {
        fetch: async (req: Request) => {
          seenUrls.push(req.url);
          return new Response(JSON.stringify({ leagues: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    } as unknown as Env;

    await sessionTool!.handler({}, env, 'Bearer test-token');
    const sessionLeagueUrls = seenUrls.filter((u) => new URL(u).pathname.startsWith('/internal/leagues'));
    expect(sessionLeagueUrls.length).toBeGreaterThanOrEqual(3); // espn + yahoo + sleeper
    for (const u of sessionLeagueUrls) {
      expect(new URL(u).searchParams.has('archived')).toBe(false);
    }

    seenUrls.length = 0;
    await historyTool!.handler({}, env, 'Bearer test-token');
    const historyLeagueUrls = seenUrls.filter((u) => new URL(u).pathname.startsWith('/internal/leagues'));
    expect(historyLeagueUrls.length).toBeGreaterThanOrEqual(3);
    for (const u of historyLeagueUrls) {
      expect(new URL(u).searchParams.get('archived')).toBe('exclude-hidden');
    }
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

  describe('get_roster snapshot selector validation', () => {
    const rosterTool = () => getUnifiedTools().find((t) => t.name === 'get_roster')!;
    const baseArgs = { league_id: '123', season_year: 2024, team_id: '1' };

    const rejectionMatrix = [
      { platform: 'espn', sport: 'baseball', extra: { week: 15 }, corrective: 'as_of_date' },
      { platform: 'espn', sport: 'basketball', extra: { week: 3 }, corrective: 'as_of_date' },
      { platform: 'espn', sport: 'hockey', extra: { week: 3 }, corrective: 'as_of_date' },
      { platform: 'yahoo', sport: 'baseball', extra: { week: 15 }, corrective: 'as_of_date' },
      { platform: 'espn', sport: 'football', extra: { as_of_date: '2024-10-06' }, corrective: 'week' },
      { platform: 'yahoo', sport: 'football', extra: { as_of_date: '2024-10-06' }, corrective: 'week' },
      { platform: 'sleeper', sport: 'football', extra: { as_of_date: '2024-10-06' }, corrective: 'week' },
      { platform: 'sleeper', sport: 'basketball', extra: { as_of_date: '2024-12-01' }, corrective: 'week' },
      { platform: 'espn', sport: 'football', extra: { week: 5, as_of_date: '2024-10-06' }, corrective: 'at most one' },
      { platform: 'espn', sport: 'baseball', extra: { as_of_date: '2024-02-30' }, corrective: 'calendar-valid' },
      { platform: 'espn', sport: 'baseball', extra: { as_of_date: 'last tuesday' }, corrective: 'calendar-valid' },
    ] as const;

    it.each(rejectionMatrix)('$platform $sport rejects $extra without routing', async ({ platform, sport, extra, corrective }) => {
      const routeToClientMock = routeToClient as MockedFunction<typeof routeToClient>;
      routeToClientMock.mockClear();

      const result = await rosterTool().handler(
        { ...baseArgs, platform, sport, ...extra },
        {} as Env,
        'Bearer token',
        'corr-1'
      );

      expect(result.isError).toBe(true);
      const payload = result.structuredContent as { code?: string; error?: string };
      expect(payload.code).toBe('INVALID_ROSTER_SNAPSHOT_SELECTOR');
      expect(payload.error?.toLowerCase()).toContain(corrective.toLowerCase());
      expect(routeToClientMock).not.toHaveBeenCalled();
    });

    const acceptanceMatrix = [
      { platform: 'espn', sport: 'football', extra: { week: 5 }, snapshot: { type: 'week', week: 5 }, week: 5 },
      { platform: 'yahoo', sport: 'football', extra: { week: 5 }, snapshot: { type: 'week', week: 5 }, week: 5 },
      { platform: 'sleeper', sport: 'football', extra: { week: 9 }, snapshot: { type: 'week', week: 9 }, week: 9 },
      { platform: 'sleeper', sport: 'basketball', extra: { week: 15 }, snapshot: { type: 'week', week: 15 }, week: 15 },
      { platform: 'espn', sport: 'baseball', extra: { as_of_date: '2024-07-10' }, snapshot: { type: 'date', date: '2024-07-10' }, week: undefined },
      { platform: 'yahoo', sport: 'hockey', extra: { as_of_date: '2024-01-05' }, snapshot: { type: 'date', date: '2024-01-05' }, week: undefined },
      { platform: 'espn', sport: 'baseball', extra: {}, snapshot: { type: 'current' }, week: undefined },
    ] as const;

    it.each(acceptanceMatrix)('$platform $sport forwards normalized snapshot for $extra', async ({ platform, sport, extra, snapshot, week }) => {
      const routeToClientMock = routeToClient as MockedFunction<typeof routeToClient>;
      routeToClientMock.mockClear();
      routeToClientMock.mockResolvedValue({ success: true, data: { roster: [] } });

      const result = await rosterTool().handler(
        { ...baseArgs, platform, sport, ...extra },
        {} as Env,
        'Bearer token',
        'corr-1'
      );

      expect(result.isError).toBeUndefined();
      expect(routeToClientMock).toHaveBeenCalledTimes(1);
      const forwarded = routeToClientMock.mock.calls[0][2] as unknown as Record<string, unknown>;
      expect(forwarded.snapshot).toEqual(snapshot);
      expect(forwarded.week).toBe(week);
      expect(forwarded.as_of_date).toBeUndefined();
    });
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

  it('tool errors preserve retry metadata in structuredContent and _meta', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_standings');
    expect(tool).toBeTruthy();

    const routeToClientMock = routeToClient as MockedFunction<typeof routeToClient>;
    routeToClientMock.mockResolvedValue({
      success: false,
      error: 'YAHOO_AUTH_UNAVAILABLE: Yahoo token refresh is already in progress',
      code: 'YAHOO_AUTH_UNAVAILABLE',
      status: 503,
      upstream_status: 429,
      retryable: true,
      retry_after: 5,
    });

    const result = await tool!.handler({
      platform: 'yahoo',
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
    }, {} as Env, 'Bearer token', 'corr-retry');

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe(
      'YAHOO_AUTH_UNAVAILABLE: Yahoo token refresh is already in progress'
    );
    expect(result.structuredContent).toMatchObject({
      success: false,
      code: 'YAHOO_AUTH_UNAVAILABLE',
      status: 503,
      upstream_status: 429,
      retryable: true,
      retry_after: 5,
    });
    expect(result._meta).toMatchObject({
      status: 503,
      upstream_status: 429,
      retryable: true,
      retry_after: 5,
    });
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

  // Test C: stale default → no mutation, warning appended
  it('get_user_session: stale default does not DELETE and appends warning', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_user_session');
    expect(tool).toBeTruthy();

    const activeLeague = { platform: 'espn', sport: 'baseball', leagueId: 'bb1', leagueName: 'Diamond', teamId: 't2', seasonYear: 2026 };
    // Football default points to a league that is no longer active
    const stalePrefs = {
      defaultSport: 'football',
      defaultFootball: { platform: 'espn', leagueId: 'old-fb', seasonYear: 2024 },
    };

    let deleteCalled = false;

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
      defaultLeagues: Record<string, unknown>;
      warnings?: string[];
    };

    // get_user_session is advertised as read-only and must not clear stale defaults.
    expect(deleteCalled).toBe(false);
    // Stale entries are filtered from the response even though storage is not mutated.
    expect(payload.defaultLeagues.football).toBeUndefined();

    // Warning should mention the stale league without locking punctuation.
    expect(payload.warnings).toBeDefined();
    expect(payload.warnings!.length).toBeGreaterThan(0);
    expect(payload.warnings![0]).toContain('Stale football default detected');
    expect(payload.warnings![0]).toContain('old-fb');
  });

  it('get_user_session: emits unavailability warning when platform fetch fails', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_user_session');
    expect(tool).toBeTruthy();

    const stalePrefs = {
      defaultSport: 'football',
      defaultFootball: { platform: 'yahoo', leagueId: 'nfl.l.123', seasonYear: 2025 },
    };

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
          return new Response(JSON.stringify({ leagues: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        },
      },
    } as unknown as Env;

    const result = await tool!.handler({}, env, 'Bearer test-token');
    const payload = JSON.parse(result.content[0].text) as { warnings?: string[] };

    expect(payload.warnings?.some((w) => w.includes('temporarily unavailable'))).toBe(true);
  });

  it('get_user_session: non-current default present in raw leagues is preserved but not shown active', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_user_session');
    expect(tool).toBeTruthy();

    const previousSeasonLeague = {
      platform: 'espn',
      sport: 'baseball',
      leagueId: 'bb-2025',
      leagueName: 'Diamond',
      teamId: 't2',
      seasonYear: 2025,
    };
    const prefs = {
      defaultSport: 'baseball',
      defaultBaseball: { platform: 'espn', leagueId: 'bb-2025', seasonYear: 2025 },
    };

    let deleteCalled = false;

    const env = {
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
      AUTH_WORKER: {
        fetch: async (req: Request) => {
          const url = new URL(req.url);
          if (url.pathname === '/internal/leagues') {
            return new Response(JSON.stringify({ leagues: [previousSeasonLeague] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (url.pathname === '/internal/user/preferences') {
            return new Response(JSON.stringify(prefs), {
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
    const payload = JSON.parse(result.content[0].text) as {
      allLeagues: Array<{ sport: string; seasonYear: number }>;
      defaultLeagues: Record<string, unknown>;
      defaultLeague: unknown;
      totalLeaguesFound: number;
      warnings?: string[];
    };

    expect(deleteCalled).toBe(false);
    expect(payload.totalLeaguesFound).toBe(0);
    expect(payload.allLeagues).toHaveLength(0);
    expect(payload.defaultLeagues.baseball).toBeUndefined();
    expect(payload.defaultLeague).toBeNull();
    expect(payload.warnings?.some((w) => w.includes('Preserved non-current baseball default'))).toBe(true);
  });

  it('get_user_session: provider-lag seasons are omitted with a current-season message', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_user_session');
    expect(tool).toBeTruthy();

    const previousSeasonLeague = {
      platform: 'espn',
      sport: 'baseball',
      leagueId: 'bb-2025',
      leagueName: 'Diamond',
      teamId: 't2',
      seasonYear: 2025,
    };

    const env = {
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
      AUTH_WORKER: {
        fetch: async (req: Request) => {
          const url = new URL(req.url);
          if (url.pathname === '/internal/leagues') {
            return new Response(JSON.stringify({ leagues: [previousSeasonLeague] }), {
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
      allLeagues: Array<{ sport: string; seasonYear: number }>;
      instructions: string;
      totalLeaguesFound: number;
    };

    expect(payload.totalLeaguesFound).toBe(0);
    expect(payload.allLeagues).toHaveLength(0);
    expect(payload.instructions).toContain('No current-season leagues found');
    expect(payload.instructions).toContain('https://flaim.app/leagues');
    expect(payload.instructions).toContain('Sync all');
    expect(payload.instructions).not.toContain('No leagues configured');
  });

  it('get_user_session: recurring Yahoo leagues dedup to current season only', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_user_session');
    expect(tool).toBeTruthy();

    // fetchYahooLeagues maps Yahoo's leagueKey field into the normalized leagueId.
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

  it('get_user_session: Yahoo seasons with changed stable IDs still hide historical seasons', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_user_session');
    expect(tool).toBeTruthy();

    // Yahoo can return renewed leagues whose visible lineage is the same even
    // when the stable league_id portion changes. The active session view should
    // still expose only the current baseball season.
    // fetchYahooLeagues maps Yahoo's leagueKey field into the normalized leagueId.
    const yahooLeagues = [
      { sport: 'baseball', leagueKey: '422.l.1000', leagueName: 'Car Ramrod', teamId: 't1', teamName: "Gerry Gugger's Nice Team", seasonYear: 2024 },
      { sport: 'baseball', leagueKey: '431.l.2000', leagueName: 'Car Ramrod', teamId: 't2', teamName: "Gerry Gugger's Nice Team", seasonYear: 2025 },
      { sport: 'baseball', leagueKey: '442.l.3000', leagueName: 'Car Ramrod', teamId: 't3', teamName: "Gerry Gugger's Nice Team", seasonYear: 2026 },
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

    const yahooBaseball = payload.allLeagues.filter(
      (l) => l.platform === 'yahoo' && l.sport === 'baseball'
    );
    expect(yahooBaseball).toHaveLength(1);
    expect(yahooBaseball[0]).toMatchObject({
      leagueId: '442.l.3000',
      seasonYear: 2026,
    });
    expect(payload.totalLeaguesFound).toBe(1);
  });

  it('get_user_session: historical Sleeper football season does not leak into active session view', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_user_session');
    expect(tool).toBeTruthy();

    const sleeperLeagues = [
      { sport: 'football', leagueId: 'sleeper-2025', leagueName: 'Dynasty Squad', rosterId: 7, seasonYear: 2025 },
      { sport: 'football', leagueId: 'sleeper-2024', leagueName: 'Dynasty Squad', rosterId: 7, seasonYear: 2024 },
    ];

    const env = {
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
      AUTH_WORKER: {
        fetch: async (req: Request) => {
          const url = new URL(req.url);
          if (url.pathname === '/internal/leagues/sleeper') {
            return new Response(JSON.stringify({ leagues: sleeperLeagues }), {
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

    const sleeperFootball = payload.allLeagues.filter(
      (l) => l.platform === 'sleeper' && l.sport === 'football'
    );
    expect(payload.totalLeaguesFound).toBe(1);
    expect(sleeperFootball).toHaveLength(1);
    expect(sleeperFootball[0]).toMatchObject({
      leagueId: 'sleeper-2025',
      seasonYear: 2025,
    });
  });

  it('get_user_session: grouped Sleeper seasons keep only the current season in active leagues', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_user_session');
    expect(tool).toBeTruthy();

    const sleeperLeagues = [
      { sport: 'football', leagueId: 'sleeper-2025', recurringLeagueId: 'sleeper-root', leagueName: 'Dynasty Squad', rosterId: 7, seasonYear: 2025 },
      { sport: 'football', leagueId: 'sleeper-2024', recurringLeagueId: 'sleeper-root', leagueName: 'Dynasty Squad', rosterId: 7, seasonYear: 2024 },
    ];

    const env = {
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
      AUTH_WORKER: {
        fetch: async (req: Request) => {
          const url = new URL(req.url);
          if (url.pathname === '/internal/leagues/sleeper') {
            return new Response(JSON.stringify({ leagues: sleeperLeagues }), {
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

    const sleeperFootball = payload.allLeagues.filter(
      (l) => l.platform === 'sleeper' && l.sport === 'football'
    );
    expect(payload.totalLeaguesFound).toBe(1);
    expect(sleeperFootball).toHaveLength(1);
    expect(sleeperFootball[0]).toMatchObject({
      leagueId: 'sleeper-2025',
      seasonYear: 2025,
    });
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

  it('get_ancient_history: recurring Sleeper seasons stay grouped under the active league', async () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_ancient_history');
    expect(tool).toBeTruthy();

    const sleeperLeagues = [
      { sport: 'football', leagueId: 'sleeper-2025', recurringLeagueId: 'sleeper-root', leagueName: 'Dynasty Squad', rosterId: 7, seasonYear: 2025 },
      { sport: 'football', leagueId: 'sleeper-2024', recurringLeagueId: 'sleeper-root', leagueName: 'Dynasty Squad', rosterId: 7, seasonYear: 2024 },
    ];

    const env = {
      INTERNAL_SERVICE_TOKEN: 'internal-secret',
      AUTH_WORKER: {
        fetch: async (req: Request) => {
          const url = new URL(req.url);
          if (url.pathname === '/internal/leagues/sleeper') {
            return new Response(JSON.stringify({ leagues: sleeperLeagues }), {
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
      totalOldSeasons: number;
    };

    expect(payload.oldLeagues).toHaveLength(0);
    expect(Object.keys(payload.oldSeasonsFromActiveLeagues)).toEqual(['sleeper:football:sleeper-root']);
    const allOldSeasons = Object.values(payload.oldSeasonsFromActiveLeagues).flat();
    expect(payload.totalOldSeasons).toBe(1);
    expect(allOldSeasons).toHaveLength(1);
    expect(allOldSeasons[0]).toMatchObject({
      platform: 'sleeper',
      leagueId: 'sleeper-2024',
      seasonYear: 2024,
    });
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

  it('get_roster schema exposes an optional as_of_date string', () => {
    const tool = getUnifiedTools().find((t) => t.name === 'get_roster');
    expect(tool).toBeTruthy();

    const dateSchema = asZod(tool!.inputSchema.as_of_date);
    expect(dateSchema.safeParse(undefined).success).toBe(true);
    expect(dateSchema.safeParse('2026-07-10').success).toBe(true);
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

  it('scope-denied mcpAuthError includes correct resource_metadata URL and required scope', () => {
    const result = mcpAuthError('https://api.flaim.app/mcp', 'mcp:write');
    expect(result.isError).toBe(true);
    expect(result._meta).toBeDefined();
    expect(Array.isArray(result._meta?.['mcp/www_authenticate'])).toBe(true);
    const challenge = (result._meta?.['mcp/www_authenticate'] as string[])[0];
    expect(challenge).toContain('Bearer');
    // Must point to the actual served route, not /mcp/.well-known
    expect(challenge).toContain('resource_metadata="https://api.flaim.app/.well-known/oauth-protected-resource"');
    expect(challenge).toContain('scope="mcp:write"');
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
