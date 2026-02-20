import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import {
  flaimSportToSleeper,
  handleSleeperError,
  sleeperFetch,
  sleeperSportToFlaim,
} from '../sleeper-api';

const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch;

describe('sleeper-api helpers', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('calls the canonical Sleeper host with expected headers', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const response = await sleeperFetch('/league/123');

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.sleeper.app/v1/league/123',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/json',
          'User-Agent': 'flaim-sleeper-client/1.0',
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('maps Sleeper HTTP statuses to explicit Sleeper error codes', () => {
    expect(() => handleSleeperError(new Response(null, { status: 404 }))).toThrow(
      'SLEEPER_NOT_FOUND: League or resource not found',
    );
    expect(() => handleSleeperError(new Response(null, { status: 429 }))).toThrow(
      'SLEEPER_RATE_LIMIT: Too many requests. Please wait.',
    );
    expect(() => handleSleeperError(new Response(null, { status: 400 }))).toThrow(
      'SLEEPER_BAD_REQUEST: Invalid request',
    );
    expect(() => handleSleeperError(new Response(null, { status: 503 }))).toThrow(
      'SLEEPER_API_ERROR: Sleeper returned 503',
    );
  });

  it('converts sport names between Sleeper and Flaim values', () => {
    expect(sleeperSportToFlaim('nfl')).toBe('football');
    expect(sleeperSportToFlaim('nba')).toBe('basketball');
    expect(sleeperSportToFlaim('mlb')).toBe('mlb');

    expect(flaimSportToSleeper('football')).toBe('nfl');
    expect(flaimSportToSleeper('basketball')).toBe('nba');
    expect(flaimSportToSleeper('hockey')).toBe('hockey');
  });

  it('normalizes fetch abort errors to SLEEPER_TIMEOUT', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    mockFetch.mockRejectedValueOnce(abortError);

    await expect(sleeperFetch('/league/timeout', { timeout: 1 })).rejects.toThrow(
      'SLEEPER_TIMEOUT: Request timed out',
    );
  });
});
