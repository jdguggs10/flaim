import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { espnFetch, handleEspnError, readEspnLeagueJson } from '../espn-api';

const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch;

describe('espn-api helpers', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('constructs correct ESPN API URL with gameId and path', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await espnFetch('/seasons/2025/segments/0/leagues/123', 'ffl');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2025/segments/0/leagues/123',
      expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': 'espn-client/1.0',
          Accept: 'application/json',
          'X-Fantasy-Source': 'kona',
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('includes credential cookies when provided', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{}', { status: 200 }));

    await espnFetch('/test', 'ffl', {
      credentials: { swid: '{ABC-123}', s2: 'secret-token' },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: 'SWID={ABC-123}; espn_s2=secret-token',
        }),
      }),
    );
  });

  it('maps ESPN HTTP statuses to explicit error codes', () => {
    expect(() => handleEspnError(new Response(null, { status: 401 }))).toThrow(
      'ESPN_AUTHENTICATION_FAILED:',
    );
    expect(() => handleEspnError(new Response(null, { status: 403 }))).toThrow(
      'ESPN_ACCESS_DENIED:',
    );
    expect(() => handleEspnError(new Response(null, { status: 404 }))).toThrow(
      'ESPN_NOT_FOUND:',
    );
    expect(() => handleEspnError(new Response(null, { status: 429 }))).toThrow(
      'ESPN_RATE_LIMIT:',
    );
    expect(() => handleEspnError(new Response(null, { status: 500 }))).toThrow(
      'ESPN_API_ERROR:',
    );
  });

  it('normalizes fetch abort errors to ESPN_TIMEOUT', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    mockFetch.mockRejectedValueOnce(abortError);

    await expect(espnFetch('/test', 'ffl', { timeout: 1 })).rejects.toThrow(
      'ESPN_TIMEOUT: Request timed out',
    );
  });

  it('uses leagueHistory directly for pre-2018 league reads', async () => {
    mockFetch.mockResolvedValueOnce(new Response('[{"id":123}]', { status: 200 }));

    const response = await espnFetch(
      '/seasons/2017/segments/0/leagues/123?view=mSettings',
      'flb',
      {
        league: {
          leagueId: '123',
          espnSeasonYear: 2017,
          historical: true,
        },
      },
    );

    expect(mockFetch.mock.calls[0]?.[0]).toBe(
      'https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/leagueHistory/123?seasonId=2017&view=mSettings',
    );
    const data = await readEspnLeagueJson(response, (value): value is { id: number } => (
      value !== null && typeof value === 'object' && (value as Record<string, unknown>).id === 123
    ));
    expect(data).toEqual({ id: 123 });
  });

  it('retries modern historical 401 responses through leagueHistory', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response('[{"id":123}]', { status: 200 }));

    const response = await espnFetch(
      '/seasons/2023/segments/0/leagues/123?view=mStandings&view=mTeam',
      'flb',
      {
        league: {
          leagueId: '123',
          espnSeasonYear: 2023,
          historical: true,
        },
      },
    );

    expect(response.status).toBe(200);
    expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([
      'https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2023/segments/0/leagues/123?view=mStandings&view=mTeam',
      'https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/leagueHistory/123?seasonId=2023&view=mStandings&view=mTeam',
    ]);
  });

  it('does not retry current-season authentication failures', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 401 }));

    const response = await espnFetch(
      '/seasons/2026/segments/0/leagues/123?view=mSettings',
      'flb',
      {
        league: {
          leagueId: '123',
          espnSeasonYear: 2026,
          historical: false,
        },
      },
    );

    expect(response.status).toBe(401);
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});
