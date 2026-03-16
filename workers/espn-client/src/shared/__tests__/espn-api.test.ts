import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { espnFetch, handleEspnError } from '../espn-api';

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
      'ESPN_COOKIES_EXPIRED:',
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
});
