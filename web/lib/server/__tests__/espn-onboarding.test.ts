import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runEspnAutoPull, runEspnDiscoverSeasons } from '../espn-onboarding';

const ORIGINAL_ENV = {
  NEXT_PUBLIC_AUTH_WORKER_URL: process.env.NEXT_PUBLIC_AUTH_WORKER_URL,
  INTERNAL_SERVICE_TOKEN: process.env.INTERNAL_SERVICE_TOKEN,
};

function setTestEnv() {
  process.env.NEXT_PUBLIC_AUTH_WORKER_URL = 'https://auth.example';
  process.env.INTERNAL_SERVICE_TOKEN = 'test-internal-token';
}

function restoreTestEnv() {
  process.env.NEXT_PUBLIC_AUTH_WORKER_URL = ORIGINAL_ENV.NEXT_PUBLIC_AUTH_WORKER_URL;
  process.env.INTERNAL_SERVICE_TOKEN = ORIGINAL_ENV.INTERNAL_SERVICE_TOKEN;
}

function createFetchMock(options: {
  seasonId?: number;
  teamCount?: number;
  onEspnUrl?: (url: string) => void;
}) {
  const { seasonId, teamCount = 1, onEspnUrl } = options;

  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url === 'https://auth.example/internal/credentials/espn/raw') {
      return new Response(
        JSON.stringify({
          success: true,
          credentials: {
            swid: '{swid}',
            s2: 'cookie',
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    if (url.includes('lm-api-reads.fantasy.espn.com/apis/v3')) {
      onEspnUrl?.(url);
      return new Response(
        JSON.stringify({
          seasonId,
          settings: { name: 'ESPN Test League' },
          teams: Array.from({ length: teamCount }, (_, index) => ({
            id: index + 1,
            location: `Team ${index + 1}`,
            nickname: 'Testers',
          })),
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  });
}

beforeEach(() => {
  setTestEnv();
});

afterEach(() => {
  vi.useRealTimers();
  restoreTestEnv();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('runEspnAutoPull', () => {
  it.each(['basketball', 'hockey'] as const)(
    'returns canonical start-year season info for explicit ESPN %s seasons',
    async (sport) => {
      let espnUrl = '';
      vi.stubGlobal('fetch', createFetchMock({
        seasonId: 2025,
        onEspnUrl: (url) => {
          espnUrl = url;
        },
      }));

      const result = await runEspnAutoPull({
        sport,
        leagueId: '12345',
        seasonYear: 2024,
        authHeader: 'Bearer test-token',
      });

      expect(result.status).toBe(200);
      if (!('success' in result.body) || !result.body.success || !result.body.leagueInfo) {
        throw new Error('Expected a successful ESPN auto-pull response');
      }

      expect(result.body.leagueInfo.seasonYear).toBe(2024);
      expect(espnUrl).toContain('/seasons/2025/segments/0/leagues/12345');
    }
  );

  it.each(['football', 'baseball'] as const)(
    'uses the canonical current season in January for %s',
    async (sport) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-15T12:00:00-05:00'));

      let espnUrl = '';
      vi.stubGlobal('fetch', createFetchMock({
        onEspnUrl: (url) => {
          espnUrl = url;
        },
      }));

      const result = await runEspnAutoPull({
        sport,
        leagueId: '12345',
        authHeader: 'Bearer test-token',
      });

      expect(result.status).toBe(200);
      if (!('success' in result.body) || !result.body.success || !result.body.leagueInfo) {
        throw new Error('Expected a successful ESPN auto-pull response');
      }

      expect(result.body.leagueInfo.seasonYear).toBe(2025);
      expect(espnUrl).toContain('/seasons/2025/segments/0/leagues/12345');
    }
  );
});

describe('runEspnDiscoverSeasons', () => {
  it('keeps January football discovery anchored to the canonical current season', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00-05:00'));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === 'https://auth.example/internal/credentials/espn/raw') {
        return new Response(
          JSON.stringify({
            success: true,
            credentials: {
              swid: '{swid}',
              s2: 'cookie',
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (url === 'https://auth.example/leagues') {
        return new Response(
          JSON.stringify({
            success: true,
            leagues: [
              {
                leagueId: '12345',
                sport: 'football',
                teamId: '1',
                seasonYear: 2025,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (url.includes('lm-api-reads.fantasy.espn.com/apis/v3')) {
        return new Response('', { status: 404, statusText: 'Not Found' });
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const resultPromise = runEspnDiscoverSeasons({
      sport: 'football',
      leagueId: '12345',
      authHeader: 'Bearer test-token',
    });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.status).toBe(200);
    expect((result.body as { startYear?: number }).startYear).toBe(2025);
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('/games/ffl/seasons/2024/segments/0/leagues/12345');
  });
});
