import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { handleSleeperDiscover, type SleeperConnectEnv } from '../sleeper-connect-handlers';
import { SleeperStorage } from '../sleeper-storage';
import { getDefaultSeasonYear } from '../season-utils';

vi.mock('../sleeper-storage', () => ({
  SleeperStorage: {
    fromEnvironment: vi.fn(),
  },
}));

vi.mock('../season-utils', () => ({
  getDefaultSeasonYear: vi.fn((sport: string) => (sport === 'football' ? 2025 : 2024)),
}));

const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
vi.stubGlobal('fetch', mockFetch);

const env: SleeperConnectEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('sleeper-connect-handlers', () => {
  let mockStorage: {
    saveSleeperConnection: ReturnType<typeof vi.fn>;
    saveSleeperLeague: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();

    mockStorage = {
      saveSleeperConnection: vi.fn().mockResolvedValue(undefined),
      saveSleeperLeague: vi.fn().mockResolvedValue(undefined),
    };

    vi.mocked(SleeperStorage.fromEnvironment).mockReturnValue(mockStorage as unknown as SleeperStorage);
  });

  it('returns 400 when username is missing', async () => {
    const request = new Request('https://api.flaim.app/connect/sleeper/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    const response = await handleSleeperDiscover(request, env, 'user_1', corsHeaders);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'username is required' });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockStorage.saveSleeperConnection).not.toHaveBeenCalled();
  });

  it('returns 404 when Sleeper username lookup returns null', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(null, 200));

    const request = new Request('https://api.flaim.app/connect/sleeper/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'missing_user' }),
    });

    const response = await handleSleeperDiscover(request, env, 'user_1', corsHeaders);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Sleeper user not found. Check the username and try again.',
    });
    expect(mockStorage.saveSleeperConnection).not.toHaveBeenCalled();
  });

  it('returns 500 (not 404) when username lookup hits Sleeper rate limit', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 429 }));

    const request = new Request('https://api.flaim.app/connect/sleeper/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'rate_limited' }),
    });

    const response = await handleSleeperDiscover(request, env, 'user_1', corsHeaders);
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(500);
    expect(body.error).toContain('Sleeper API 429: /user/rate_limited');
  });

  it('returns success=false with warning when both sport league fetches fail and nothing is saved', async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/user/demo_user')) {
        return jsonResponse({
          user_id: 'sleeper_123',
          username: 'demo_user',
          display_name: 'Demo User',
        });
      }
      if (url.includes('/user/sleeper_123/leagues/nfl/2025')) {
        return new Response(null, { status: 503 });
      }
      if (url.includes('/user/sleeper_123/leagues/nba/2024')) {
        return new Response(null, { status: 503 });
      }
      return new Response(null, { status: 404 });
    });

    const request = new Request('https://api.flaim.app/connect/sleeper/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'demo_user' }),
    });

    const response = await handleSleeperDiscover(request, env, 'user_1', corsHeaders);
    const body = (await response.json()) as {
      success: boolean;
      leagues_found: number;
      seasons_discovered: number;
      warning?: string;
    };

    expect(response.status).toBe(200);
    expect(body.success).toBe(false);
    expect(body.leagues_found).toBe(0);
    expect(body.seasons_discovered).toBe(0);
    expect(body.warning).toBe('Some league data could not be fetched. Try reconnecting later.');
    expect(mockStorage.saveSleeperConnection).toHaveBeenCalledTimes(1);
    expect(mockStorage.saveSleeperLeague).not.toHaveBeenCalled();
    expect(vi.mocked(getDefaultSeasonYear)).toHaveBeenCalledWith('football');
    expect(vi.mocked(getDefaultSeasonYear)).toHaveBeenCalledWith('basketball');
  });

  it('returns success=true when one sport fetch fails but at least one league is saved', async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/user/mixed_result')) {
        return jsonResponse({
          user_id: 'sleeper_456',
          username: 'mixed_result',
          display_name: 'Mixed Result',
        });
      }
      if (url.includes('/user/sleeper_456/leagues/nfl/2025')) {
        return jsonResponse([
          {
            league_id: 'league_nfl_1',
            name: 'NFL League',
            sport: 'nfl',
            season: '2025',
            previous_league_id: null,
          },
        ]);
      }
      if (url.includes('/user/sleeper_456/leagues/nba/2024')) {
        return new Response(null, { status: 503 });
      }
      if (url.includes('/league/league_nfl_1/rosters')) {
        return jsonResponse([
          { roster_id: 7, owner_id: 'sleeper_456' },
        ]);
      }
      return new Response(null, { status: 404 });
    });

    const request = new Request('https://api.flaim.app/connect/sleeper/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'mixed_result' }),
    });

    const response = await handleSleeperDiscover(request, env, 'user_1', corsHeaders);
    const body = (await response.json()) as {
      success: boolean;
      leagues_found: number;
      seasons_discovered: number;
      warning?: string;
    };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.leagues_found).toBe(1);
    expect(body.seasons_discovered).toBe(1);
    expect(body.warning).toBeUndefined();
    expect(mockStorage.saveSleeperLeague).toHaveBeenCalledTimes(1);
    expect(mockStorage.saveSleeperLeague).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: 'league_nfl_1',
        sport: 'football',
        seasonYear: 2025,
        rosterId: 7,
      }),
    );
  });
});
