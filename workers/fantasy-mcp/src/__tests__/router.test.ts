import { describe, expect, it } from 'vitest';
import { routeToClient, type RouteResult } from '../router';
import type { Env, ToolParams } from '../types';

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
        ESPN: {
          fetch: async (request: Request) => {
            expect(request.method).toBe('POST');
            expect(request.url).toBe('https://internal/execute');
            expect(request.headers.get('Content-Type')).toBe('application/json');
            expect(request.headers.get('Authorization')).toBe(authHeader);
            expect(request.headers.get('X-Correlation-ID')).toBe(correlationId);
            expect(request.headers.get('X-Flaim-Eval-Run')).toBe(evalRunId);
            expect(request.headers.get('X-Flaim-Eval-Trace')).toBe(evalTraceId);
            expect(await request.json()).toEqual({
              tool: 'get_standings',
              params,
              authHeader,
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
  });
});
