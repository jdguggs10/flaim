import { describe, expect, it, vi } from 'vitest';
import { routeToClient, type RouteResult } from '../router';
import type { Env, ToolParams } from '../types';
import { INTERNAL_SERVICE_TOKEN_HEADER } from '@flaim/worker-shared';

describe('fantasy-mcp router', () => {
  describe('RouteResult interface', () => {
    it('accepts success result', () => {
      const result: RouteResult = {
        success: true,
        data: { standings: [] },
      };
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('accepts error result', () => {
      const result: RouteResult = {
        success: false,
        error: 'Platform not supported',
        code: 'PLATFORM_NOT_SUPPORTED',
      };
      expect(result.success).toBe(false);
      expect(result.error).toBe('Platform not supported');
      expect(result.code).toBe('PLATFORM_NOT_SUPPORTED');
    });
  });

  describe('routeToClient', () => {
    it('forwards requests to the ESPN binding', async () => {
      const authHeader = 'Bearer token123';
      const correlationId = 'corr-123';
      const evalRunId = 'run-001';
      const evalTraceId = 'trace-question-001';
      const params: ToolParams = {
        platform: 'espn',
        sport: 'football',
        league_id: '12345',
        season_year: 2024,
      };
      const responseBody: RouteResult = {
        success: true,
        data: { standings: [] },
      };
      const env = {
        INTERNAL_SERVICE_TOKEN: 'internal-secret',
        ESPN: {
          fetch: async (request: Request) => {
            expect(request.method).toBe('POST');
            expect(request.url).toBe('https://internal/execute');
            expect(request.headers.get('Content-Type')).toBe('application/json');
            expect(request.headers.get('Authorization')).toBe(authHeader);
            expect(request.headers.get(INTERNAL_SERVICE_TOKEN_HEADER)).toBe('internal-secret');
            expect(request.headers.get('X-Correlation-ID')).toBe(correlationId);
            expect(request.headers.get('X-Flaim-Eval-Run')).toBe(evalRunId);
            expect(request.headers.get('X-Flaim-Eval-Trace')).toBe(evalTraceId);
            expect(await request.json()).toEqual({
              tool: 'get_standings',
              params,
            });
            return new Response(JSON.stringify(responseBody), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          },
        },
      } as unknown as Env;

      const result = await routeToClient(
        env,
        'get_standings',
        params,
        authHeader,
        correlationId,
        evalRunId,
        evalTraceId
      );

      expect(result).toEqual(responseBody);
    });

    it('returns a platform error for yahoo', async () => {
      const params: ToolParams = {
        platform: 'yahoo',
        sport: 'football',
        league_id: '12345',
        season_year: 2024,
      };

      const result = await routeToClient({} as Env, 'get_standings', params);

      expect(result).toEqual({
        success: false,
        error: 'Platform "yahoo" is not yet supported',
        code: 'PLATFORM_NOT_SUPPORTED',
      });
    });

    it('routes sleeper get_free_agents through SLEEPER binding', async () => {
      const params: ToolParams = {
        platform: 'sleeper',
        sport: 'football',
        league_id: 'league-77',
        season_year: 2025,
        count: 10,
      };
      const responseBody: RouteResult = {
        success: true,
        data: {
          platform: 'sleeper',
          league_id: 'league-77',
          count: 1,
          players: [{ id: 'p2' }],
        },
      };

      const env = {
        INTERNAL_SERVICE_TOKEN: 'internal-secret',
        AUTH_WORKER: {
          fetch: async (request: Request) => {
            expect(request.url).toBe('https://internal/internal/leagues/sleeper/authorize?league_id=league-77&sport=football&season_year=2025');
            return new Response(JSON.stringify({ allowed: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          },
        },
        SLEEPER: {
          fetch: async (request: Request) => {
            expect(request.url).toBe('https://internal/execute');
            expect(request.headers.get(INTERNAL_SERVICE_TOKEN_HEADER)).toBe('internal-secret');
            expect(await request.json()).toEqual({
              tool: 'get_free_agents',
              params,
            });
            return new Response(JSON.stringify(responseBody), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          },
        },
      } as unknown as Env;

      const result = await routeToClient(env, 'get_free_agents', params);

      expect(result).toEqual(responseBody);
    });

    it.each([
      'get_league_info',
      'get_draft',
      'get_standings',
      'get_matchups',
      'get_roster',
      'get_free_agents',
      'get_players',
      'get_transactions',
    ])('authorizes every Sleeper league-scoped route before forwarding %s', async (tool) => {
      const params: ToolParams = {
        platform: 'sleeper',
        sport: 'football',
        league_id: 'connected-2025',
        season_year: 2025,
        ...(tool === 'get_roster' ? { team_id: 'opponent-owner-id' } : {}),
      };
      const authFetch = vi.fn(async () => new Response(JSON.stringify({ allowed: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      const sleeperFetch = vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
      const env = {
        INTERNAL_SERVICE_TOKEN: 'internal-secret',
        AUTH_WORKER: { fetch: authFetch },
        SLEEPER: { fetch: sleeperFetch },
      } as unknown as Env;

      await expect(routeToClient(env, tool, params, 'Bearer token')).resolves.toMatchObject({ success: true });
      expect(authFetch).toHaveBeenCalledTimes(1);
      expect(sleeperFetch).toHaveBeenCalledTimes(1);
    });

    it('blocks an unconnected Sleeper league before contacting the provider', async () => {
      const params: ToolParams = {
        platform: 'sleeper',
        sport: 'football',
        league_id: 'public-league',
        season_year: 2025,
      };
      const sleeperFetch = vi.fn();
      const env = {
        INTERNAL_SERVICE_TOKEN: 'internal-secret',
        AUTH_WORKER: {
          fetch: async () => new Response(JSON.stringify({ allowed: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
        },
        SLEEPER: { fetch: sleeperFetch },
      } as unknown as Env;

      await expect(routeToClient(env, 'get_roster', params, 'Bearer token')).resolves.toMatchObject({
        success: false,
        code: 'SLEEPER_LEAGUE_NOT_CONNECTED',
        status: 403,
      });
      expect(sleeperFetch).not.toHaveBeenCalled();
    });

    it('permits an authorized historical Sleeper season but not a mismatched season', async () => {
      const sleeperFetch = vi.fn(async () => new Response(JSON.stringify({ success: true, data: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
      const env = {
        INTERNAL_SERVICE_TOKEN: 'internal-secret',
        AUTH_WORKER: {
          fetch: async (request: Request) => {
            const allowed = new URL(request.url).searchParams.get('season_year') === '2024';
            return new Response(JSON.stringify({ allowed }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          },
        },
        SLEEPER: { fetch: sleeperFetch },
      } as unknown as Env;
      const historical: ToolParams = {
        platform: 'sleeper', sport: 'football', league_id: 'connected-2024', season_year: 2024,
      };
      const mismatchedSeason: ToolParams = { ...historical, season_year: 2025 };

      await expect(routeToClient(env, 'get_roster', historical, 'Bearer token')).resolves.toMatchObject({ success: true });
      await expect(routeToClient(env, 'get_roster', mismatchedSeason, 'Bearer token')).resolves.toMatchObject({
        code: 'SLEEPER_LEAGUE_NOT_CONNECTED',
      });
      expect(sleeperFetch).toHaveBeenCalledTimes(1);
    });

    it('fails closed when Sleeper league authorization is unavailable', async () => {
      const params: ToolParams = {
        platform: 'sleeper', sport: 'football', league_id: 'connected-2025', season_year: 2025,
      };
      const sleeperFetch = vi.fn();
      const env = {
        INTERNAL_SERVICE_TOKEN: 'internal-secret',
        AUTH_WORKER: { fetch: async () => new Response('unavailable', { status: 503 }) },
        SLEEPER: { fetch: sleeperFetch },
      } as unknown as Env;

      await expect(routeToClient(env, 'get_standings', params, 'Bearer token')).resolves.toMatchObject({
        success: false,
        code: 'SLEEPER_LEAGUE_AUTHORIZATION_UNAVAILABLE',
        status: 503,
        upstream_status: 503,
        retryable: true,
      });
      expect(sleeperFetch).not.toHaveBeenCalled();
    });

    it.each([
      ['malformed JSON', new Response('{', { status: 200, headers: { 'Content-Type': 'application/json' } })],
      ['malformed response shape', new Response(JSON.stringify({ allowed: 'yes' }), { status: 200, headers: { 'Content-Type': 'application/json' } })],
    ])('fails closed on %s from Sleeper authorization', async (_caseName, authorizationResponse) => {
      const params: ToolParams = {
        platform: 'sleeper', sport: 'football', league_id: 'connected-2025', season_year: 2025,
      };
      const sleeperFetch = vi.fn();
      const env = {
        INTERNAL_SERVICE_TOKEN: 'internal-secret',
        AUTH_WORKER: { fetch: async () => authorizationResponse },
        SLEEPER: { fetch: sleeperFetch },
      } as unknown as Env;

      await expect(routeToClient(env, 'get_standings', params, 'Bearer token')).resolves.toMatchObject({
        code: 'SLEEPER_LEAGUE_AUTHORIZATION_UNAVAILABLE',
        status: 503,
      });
      expect(sleeperFetch).not.toHaveBeenCalled();
    });

    it('forwards authenticated internal, correlation, and evaluation headers to Sleeper authorization', async () => {
      const params: ToolParams = {
        platform: 'sleeper', sport: 'football', league_id: 'connected-2025', season_year: 2025,
      };
      const authFetch = vi.fn(async () => new Response(JSON.stringify({ allowed: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
      const env = {
        INTERNAL_SERVICE_TOKEN: 'internal-secret',
        AUTH_WORKER: { fetch: authFetch },
        SLEEPER: { fetch: async () => new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }) },
      } as unknown as Env;

      await routeToClient(env, 'get_standings', params, 'Bearer gateway-token', 'corr-123', 'run-456', 'trace-789');
      const request = (authFetch.mock.calls as unknown as [Request][])[0][0];
      expect(request.headers.get('Authorization')).toBe('Bearer gateway-token');
      expect(request.headers.get(INTERNAL_SERVICE_TOKEN_HEADER)).toBe('internal-secret');
      expect(request.headers.get('X-Correlation-ID')).toBe('corr-123');
      expect(request.headers.get('X-Flaim-Eval-Run')).toBe('run-456');
      expect(request.headers.get('X-Flaim-Eval-Trace')).toBe('trace-789');
    });

    it('keeps the authorization timeout active while parsing its response body', async () => {
      vi.useFakeTimers();
      const params: ToolParams = {
        platform: 'sleeper', sport: 'football', league_id: 'connected-2025', season_year: 2025,
      };
      const authorizationResponse = {
        ok: true,
        status: 200,
        json: () => new Promise(() => undefined),
      } as unknown as Response;
      const sleeperFetch = vi.fn();
      const env = {
        INTERNAL_SERVICE_TOKEN: 'internal-secret',
        AUTH_WORKER: {
          fetch: async () => authorizationResponse,
        },
        SLEEPER: { fetch: sleeperFetch },
      } as unknown as Env;

      const result = routeToClient(env, 'get_standings', params, 'Bearer token');
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(result).resolves.toMatchObject({
        code: 'SLEEPER_LEAGUE_AUTHORIZATION_UNAVAILABLE',
        status: 503,
      });
      expect(sleeperFetch).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('preserves retry metadata from platform worker errors', async () => {
      const params: ToolParams = {
        platform: 'yahoo',
        sport: 'football',
        league_id: '449.l.12345',
        season_year: 2025,
      };
      const env = {
        INTERNAL_SERVICE_TOKEN: 'internal-secret',
        YAHOO: {
          fetch: async () => new Response(JSON.stringify({
            success: false,
            error: 'YAHOO_AUTH_UNAVAILABLE: Yahoo token refresh is already in progress',
            code: 'YAHOO_AUTH_UNAVAILABLE',
            upstream_status: 429,
            retryable: true,
            retry_after: 5,
          }), {
            status: 503,
            headers: { 'Content-Type': 'application/json', 'Retry-After': '5' },
          }),
        },
      } as unknown as Env;

      const result = await routeToClient(env, 'get_standings', params);

      expect(result).toEqual({
        success: false,
        error: 'YAHOO_AUTH_UNAVAILABLE: Yahoo token refresh is already in progress',
        code: 'YAHOO_AUTH_UNAVAILABLE',
        status: 503,
        upstream_status: 429,
        retryable: true,
        retry_after: 5,
      });
    });

    it('returns a timeout error when the platform worker takes too long', async () => {
      vi.useFakeTimers();

      const params: ToolParams = {
        platform: 'espn',
        sport: 'football',
        league_id: '12345',
        season_year: 2024,
      };

      const env = {
        INTERNAL_SERVICE_TOKEN: 'internal-secret',
        ESPN: {
          fetch: async (request: Request) => {
            // Simulate a fetch that hangs until aborted
            return new Promise<Response>((_resolve, reject) => {
              request.signal.addEventListener('abort', () => {
                reject(new DOMException('The operation was aborted.', 'AbortError'));
              });
            });
          },
        },
      } as unknown as Env;

      const resultPromise = routeToClient(env, 'get_standings', params);

      // Advance timers past the 25s timeout
      await vi.advanceTimersByTimeAsync(26000);

      const result = await resultPromise;

      expect(result).toEqual({
        success: false,
        error: 'Platform worker "espn" timed out after 25s',
        code: 'ROUTING_ERROR',
      });

      vi.useRealTimers();
    });
  });
});
