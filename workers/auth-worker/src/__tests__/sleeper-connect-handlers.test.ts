import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import {
  handleSleeperDiscover,
  handleSleeperLeagueDelete,
  handleSleeperLeagues,
  handleSleeperStatus,
  resolveSleeperArchiveTarget,
  backfillSleeperRecurringIds,
  type SleeperConnectEnv,
} from '../sleeper-connect-handlers';
import { SleeperStorage } from '../sleeper-storage';
import { getDefaultSeasonYear } from '../season-utils';

vi.mock('../sleeper-storage', () => ({
  SleeperStorage: {
    fromEnvironment: vi.fn(),
  },
}));

// ArchiveStorage is constructed inside the public/internal Sleeper league handlers
// (annotate / exclude). Mock it so no real Supabase client is created and the
// archived set is controllable per test (defaults to empty).
const mockGetArchivedSet = vi.fn(async () => new Set<string>());
// Keep the real archivedKey so the handler's composite-key membership check
// (sport:recurringId) uses the production key format.
const archivedKey = (sport: string, recurringLeagueId: string) => `${sport}:${recurringLeagueId}`;
vi.mock('../archive-storage', () => ({
  ArchiveStorage: {
    fromEnvironment: vi.fn(() => ({ getArchivedSet: mockGetArchivedSet })),
  },
  archivedKey: (sport: string, recurringLeagueId: string) => `${sport}:${recurringLeagueId}`,
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
    deleteSleeperLeague: ReturnType<typeof vi.fn>;
    getSleeperConnection: ReturnType<typeof vi.fn>;
    getSleeperLeagues: ReturnType<typeof vi.fn>;
    persistRecurringRoot: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockGetArchivedSet.mockImplementation(async () => new Set<string>());

    mockStorage = {
      saveSleeperConnection: vi.fn().mockResolvedValue(undefined),
      saveSleeperLeague: vi.fn().mockResolvedValue(undefined),
      deleteSleeperLeague: vi.fn().mockResolvedValue(undefined),
      getSleeperConnection: vi.fn().mockResolvedValue(null),
      getSleeperLeagues: vi.fn().mockResolvedValue([]),
      persistRecurringRoot: vi.fn().mockResolvedValue(undefined),
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
        recurringLeagueId: 'league_nfl_1',
      }),
    );
  });

  it('persists recurringLeagueId during discovery for every season in the history chain', async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/user/history_user')) {
        return jsonResponse({
          user_id: 'sleeper_history',
          username: 'history_user',
          display_name: 'History User',
        });
      }
      if (url.includes('/user/sleeper_history/leagues/nfl/2025')) {
        return jsonResponse([
          {
            league_id: 'chain-2025',
            name: 'Dynasty Squad',
            sport: 'nfl',
            season: '2025',
            previous_league_id: 'chain-2024',
          },
        ]);
      }
      if (url.includes('/user/sleeper_history/leagues/nba/2024')) {
        return jsonResponse([]);
      }
      if (url.endsWith('/league/chain-2024')) {
        return jsonResponse({
          league_id: 'chain-2024',
          name: 'Dynasty Squad',
          sport: 'nfl',
          season: '2024',
          previous_league_id: null,
        });
      }
      if (url.includes('/league/chain-2025/rosters') || url.includes('/league/chain-2024/rosters')) {
        return jsonResponse([
          { roster_id: 7, owner_id: 'sleeper_history' },
        ]);
      }
      return new Response(null, { status: 404 });
    });

    const request = new Request('https://api.flaim.app/connect/sleeper/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'history_user' }),
    });

    const response = await handleSleeperDiscover(request, env, 'user_1', corsHeaders);
    const body = (await response.json()) as {
      success: boolean;
      leagues_found: number;
      seasons_discovered: number;
    };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.leagues_found).toBe(2);
    expect(body.seasons_discovered).toBe(2);
    expect(mockStorage.saveSleeperLeague).toHaveBeenCalledTimes(2);
    expect(mockStorage.saveSleeperLeague).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        leagueId: 'chain-2025',
        seasonYear: 2025,
        recurringLeagueId: 'chain-2024',
      }),
    );
    expect(mockStorage.saveSleeperLeague).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        leagueId: 'chain-2024',
        seasonYear: 2024,
        recurringLeagueId: 'chain-2024',
      }),
    );
  });

  it('persists the verified recurring root for long Sleeper history chains', async () => {
    const currentYear = 2025;
    const rootYear = 1998;

    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/user/deep_history')) {
        return jsonResponse({
          user_id: 'sleeper_deep',
          username: 'deep_history',
          display_name: 'Deep History',
        });
      }
      if (url.includes('/user/sleeper_deep/leagues/nfl/2025')) {
        return jsonResponse([
          {
            league_id: `deep-${currentYear}`,
            name: 'Dynasty Squad',
            sport: 'nfl',
            season: String(currentYear),
            previous_league_id: `deep-${currentYear - 1}`,
          },
        ]);
      }
      if (url.includes('/user/sleeper_deep/leagues/nba/2024')) {
        return jsonResponse([]);
      }

      const rosterMatch = url.match(/\/league\/deep-(\d{4})\/rosters$/);
      if (rosterMatch) {
        return jsonResponse([
          { roster_id: 7, owner_id: 'sleeper_deep' },
        ]);
      }

      const leagueMatch = url.match(/\/league\/deep-(\d{4})$/);
      if (leagueMatch) {
        const year = Number(leagueMatch[1]);
        return jsonResponse({
          league_id: `deep-${year}`,
          name: 'Dynasty Squad',
          sport: 'nfl',
          season: String(year),
          previous_league_id: year > rootYear ? `deep-${year - 1}` : null,
        });
      }

      return new Response(null, { status: 404 });
    });

    const request = new Request('https://api.flaim.app/connect/sleeper/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'deep_history' }),
    });

    const response = await handleSleeperDiscover(request, env, 'user_1', corsHeaders);
    const body = (await response.json()) as {
      success: boolean;
      leagues_found: number;
      seasons_discovered: number;
    };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.leagues_found).toBe(5);
    expect(body.seasons_discovered).toBe(5);
    expect(mockStorage.saveSleeperLeague).toHaveBeenCalledTimes(5);
    expect(mockStorage.saveSleeperLeague).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        leagueId: 'deep-2025',
        seasonYear: 2025,
        recurringLeagueId: `deep-${rootYear}`,
      }),
    );
    expect(mockStorage.saveSleeperLeague).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        leagueId: 'deep-2021',
        seasonYear: 2021,
        recurringLeagueId: `deep-${rootYear}`,
      }),
    );
  });

  it('does not persist a synthetic recurringLeagueId when history lookup fails during discovery', async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/user/history_gap')) {
        return jsonResponse({
          user_id: 'sleeper_gap',
          username: 'history_gap',
          display_name: 'History Gap',
        });
      }
      if (url.includes('/user/sleeper_gap/leagues/nfl/2025')) {
        return jsonResponse([
          {
            league_id: 'gap-2025',
            name: 'Dynasty Squad',
            sport: 'nfl',
            season: '2025',
            previous_league_id: 'gap-2024',
          },
        ]);
      }
      if (url.includes('/user/sleeper_gap/leagues/nba/2024')) {
        return jsonResponse([]);
      }
      if (url.endsWith('/league/gap-2024')) {
        return new Response(null, { status: 503 });
      }
      if (url.includes('/league/gap-2025/rosters')) {
        return jsonResponse([
          { roster_id: 7, owner_id: 'sleeper_gap' },
        ]);
      }
      return new Response(null, { status: 404 });
    });

    const request = new Request('https://api.flaim.app/connect/sleeper/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'history_gap' }),
    });

    const response = await handleSleeperDiscover(request, env, 'user_1', corsHeaders);
    const body = (await response.json()) as {
      success: boolean;
      leagues_found: number;
      seasons_discovered: number;
    };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.leagues_found).toBe(1);
    expect(body.seasons_discovered).toBe(1);
    expect(mockStorage.saveSleeperLeague).toHaveBeenCalledOnce();
    expect(mockStorage.saveSleeperLeague).toHaveBeenCalledWith(
      expect.objectContaining({
        leagueId: 'gap-2025',
        seasonYear: 2025,
      }),
    );
    expect(mockStorage.saveSleeperLeague.mock.calls[0][0]).not.toHaveProperty('recurringLeagueId');
  });

  it('returns stored recurringLeagueId without extra Sleeper fetches', async () => {
    mockStorage.getSleeperLeagues.mockResolvedValue([
      {
        id: 'row-2025',
        clerkUserId: 'user_1',
        leagueId: 'sleeper-2025',
        sport: 'football',
        seasonYear: 2025,
        leagueName: 'Dynasty Squad',
        rosterId: 7,
        recurringLeagueId: 'sleeper-root',
        sleeperUserId: 'sleeper_123',
      },
      {
        id: 'row-2024',
        clerkUserId: 'user_1',
        leagueId: 'sleeper-2024',
        sport: 'football',
        seasonYear: 2024,
        leagueName: 'Dynasty Squad',
        rosterId: 7,
        recurringLeagueId: 'sleeper-root',
        sleeperUserId: 'sleeper_123',
      },
    ]);

    const response = await handleSleeperLeagues(env, 'user_1', corsHeaders);
    const body = (await response.json()) as {
      leagues: Array<{ leagueId: string; recurringLeagueId: string; seasonYear: number }>;
    };

    expect(response.status).toBe(200);
    expect(body.leagues).toEqual([
      expect.objectContaining({
        leagueId: 'sleeper-2025',
        recurringLeagueId: 'sleeper-root',
        seasonYear: 2025,
      }),
      expect.objectContaining({
        leagueId: 'sleeper-2024',
        recurringLeagueId: 'sleeper-root',
        seasonYear: 2024,
      }),
    ]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('uses stored recurringLeagueId values before legacy fallback fetches', async () => {
    mockStorage.getSleeperLeagues.mockResolvedValue([
      {
        id: 'row-2025',
        clerkUserId: 'user_1',
        leagueId: 'sleeper-2025',
        sport: 'football',
        seasonYear: 2025,
        leagueName: 'Dynasty Squad',
        rosterId: 7,
        sleeperUserId: 'sleeper_123',
      },
      {
        id: 'row-2024',
        clerkUserId: 'user_1',
        leagueId: 'sleeper-2024',
        sport: 'football',
        seasonYear: 2024,
        leagueName: 'Dynasty Squad',
        rosterId: 7,
        recurringLeagueId: 'sleeper-root',
        sleeperUserId: 'sleeper_123',
      },
    ]);

    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/league/sleeper-2025')) {
        return jsonResponse({
          league_id: 'sleeper-2025',
          name: 'Dynasty Squad',
          sport: 'nfl',
          season: '2025',
          previous_league_id: 'sleeper-2024',
        });
      }
      return new Response(null, { status: 404 });
    });

    const response = await handleSleeperLeagues(env, 'user_1', corsHeaders);
    const body = (await response.json()) as {
      leagues: Array<{ leagueId: string; recurringLeagueId: string; seasonYear: number }>;
    };

    expect(response.status).toBe(200);
    expect(body.leagues).toEqual([
      expect.objectContaining({
        leagueId: 'sleeper-2025',
        recurringLeagueId: 'sleeper-root',
        seasonYear: 2025,
      }),
      expect.objectContaining({
        leagueId: 'sleeper-2024',
        recurringLeagueId: 'sleeper-root',
        seasonYear: 2024,
      }),
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to the raw leagueId when recurring chain lookup fails for legacy rows', async () => {
    mockStorage.getSleeperLeagues.mockResolvedValue([
      {
        id: 'row-2025',
        clerkUserId: 'user_1',
        leagueId: 'sleeper-2025',
        sport: 'football',
        seasonYear: 2025,
        leagueName: 'Dynasty Squad',
        rosterId: 7,
        recurringLeagueId: undefined,
        sleeperUserId: 'sleeper_123',
      },
    ]);

    mockFetch.mockResolvedValue(new Response(null, { status: 503 }));

    const response = await handleSleeperLeagues(env, 'user_1', corsHeaders);
    const body = (await response.json()) as {
      leagues: Array<{ leagueId: string; recurringLeagueId: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.leagues).toEqual([
      expect.objectContaining({
        leagueId: 'sleeper-2025',
        recurringLeagueId: 'sleeper-2025',
      }),
    ]);
  });

  it('falls back to the raw leagueId when Sleeper returns a null league body for legacy rows', async () => {
    mockStorage.getSleeperLeagues.mockResolvedValue([
      {
        id: 'row-null',
        clerkUserId: 'user_1',
        leagueId: 'null-2025',
        sport: 'football',
        seasonYear: 2025,
        leagueName: 'Dynasty Squad',
        rosterId: 7,
        recurringLeagueId: undefined,
        sleeperUserId: 'sleeper_123',
      },
    ]);

    mockFetch.mockResolvedValue(jsonResponse(null, 200));

    const response = await handleSleeperLeagues(env, 'user_1', corsHeaders);
    const body = (await response.json()) as {
      leagues: Array<{ leagueId: string; recurringLeagueId: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.leagues).toEqual([
      expect.objectContaining({
        leagueId: 'null-2025',
        recurringLeagueId: 'null-2025',
      }),
    ]);
  });

  it('falls back to the raw leagueId when recurring history contains a cycle for legacy rows', async () => {
    mockStorage.getSleeperLeagues.mockResolvedValue([
      {
        id: 'row-cycle',
        clerkUserId: 'user_1',
        leagueId: 'cycle-2025',
        sport: 'football',
        seasonYear: 2025,
        leagueName: 'Dynasty Squad',
        rosterId: 7,
        recurringLeagueId: undefined,
        sleeperUserId: 'sleeper_123',
      },
    ]);

    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/league/cycle-2025')) {
        return jsonResponse({
          league_id: 'cycle-2025',
          name: 'Dynasty Squad',
          sport: 'nfl',
          season: '2025',
          previous_league_id: 'cycle-2024',
        });
      }
      if (url.endsWith('/league/cycle-2024')) {
        return jsonResponse({
          league_id: 'cycle-2024',
          name: 'Dynasty Squad',
          sport: 'nfl',
          season: '2024',
          previous_league_id: 'cycle-2025',
        });
      }
      return new Response(null, { status: 404 });
    });

    const response = await handleSleeperLeagues(env, 'user_1', corsHeaders);
    const body = (await response.json()) as {
      leagues: Array<{ leagueId: string; recurringLeagueId: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.leagues).toEqual([
      expect.objectContaining({
        leagueId: 'cycle-2025',
        recurringLeagueId: 'cycle-2025',
      }),
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns recurringLeagueId on the delete response without refetching legacy chain data', async () => {
    mockStorage.getSleeperLeagues.mockResolvedValue([
      {
        id: 'row-2024',
        clerkUserId: 'user_1',
        leagueId: 'sleeper-2024',
        sport: 'football',
        seasonYear: 2024,
        leagueName: 'Dynasty Squad',
        rosterId: 7,
        recurringLeagueId: 'sleeper-root',
        sleeperUserId: 'sleeper_123',
      },
    ]);

    const response = await handleSleeperLeagueDelete(env, 'user_1', 'row-2025', corsHeaders);
    const body = (await response.json()) as {
      success: boolean;
      leagues: Array<{ leagueId: string; recurringLeagueId: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockStorage.deleteSleeperLeague).toHaveBeenCalledWith('user_1', 'row-2025');
    expect(body.leagues).toEqual([
      expect.objectContaining({
        leagueId: 'sleeper-2024',
        recurringLeagueId: 'sleeper-root',
      }),
    ]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  describe('handleSleeperStatus', () => {
    it('returns connected=true with league count and lastUpdated when a connection exists', async () => {
      const updatedAt = '2026-01-25T12:00:00.000Z';
      mockStorage.getSleeperConnection.mockResolvedValue({
        sleeperUserId: 'sleeper_123',
        sleeperUsername: 'demo_user',
        updatedAt,
      });
      mockStorage.getSleeperLeagues.mockResolvedValue([
        {
          id: 'row-1',
          clerkUserId: 'user_1',
          leagueId: 'sleeper-2025',
          sport: 'football',
          seasonYear: 2025,
          leagueName: 'Dynasty Squad',
          rosterId: 7,
          sleeperUserId: 'sleeper_123',
        },
      ]);

      const response = await handleSleeperStatus(env, 'user_1', corsHeaders);
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body.connected).toBe(true);
      expect(body.sleeperUserId).toBe('sleeper_123');
      expect(body.sleeperUsername).toBe('demo_user');
      expect(body.leagueCount).toBe(1);
      expect(body.lastUpdated).toBe(updatedAt);
    });

    it('returns connected=false without lastUpdated when no connection exists', async () => {
      mockStorage.getSleeperConnection.mockResolvedValue(null);

      const response = await handleSleeperStatus(env, 'user_1', corsHeaders);
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(200);
      expect(body.connected).toBe(false);
      expect(body.lastUpdated).toBeUndefined();
      expect(mockStorage.getSleeperLeagues).not.toHaveBeenCalled();
    });

    it('excludes archived leagues from the status leagueCount', async () => {
      mockStorage.getSleeperConnection.mockResolvedValue({
        sleeperUserId: 'sleeper_123',
        sleeperUsername: 'demo_user',
        updatedAt: '2026-01-25T12:00:00.000Z',
      });
      // Status passes includeArchived:false; the storage mock here returns the
      // already-filtered set, so assert the count reflects what the handler got.
      mockStorage.getSleeperLeagues.mockResolvedValue([]);

      const response = await handleSleeperStatus(env, 'user_1', corsHeaders);
      const body = (await response.json()) as Record<string, unknown>;

      expect(body.leagueCount).toBe(0);
      expect(mockStorage.getSleeperLeagues).toHaveBeenCalledWith('user_1', false);
    });
  });

  // ===========================================================================
  // Public annotate vs internal exclude (UI annotates archived; AI surfaces exclude)
  // ===========================================================================

  describe('handleSleeperLeagues archive annotation', () => {
    const stored = [
      {
        id: 'row-2025',
        clerkUserId: 'user_1',
        leagueId: 'sleeper-2025',
        sport: 'football',
        seasonYear: 2025,
        leagueName: 'Zombie',
        rosterId: 7,
        recurringLeagueId: 'sleeper-root',
        sleeperUserId: 'sleeper_123',
      },
    ];

    it('public path annotates archived=true when the recurring id is archived', async () => {
      mockStorage.getSleeperLeagues.mockResolvedValue(stored);
      // Composite key: the archived set is keyed by sport:recurringId.
      mockGetArchivedSet.mockResolvedValue(new Set([archivedKey('football', 'sleeper-root')]));

      const response = await handleSleeperLeagues(env, 'user_1', corsHeaders);
      const body = (await response.json()) as { leagues: Array<{ archived?: boolean }> };

      expect(mockStorage.getSleeperLeagues).toHaveBeenCalledWith('user_1', true);
      expect(body.leagues[0].archived).toBe(true);
    });

    it('public path does NOT annotate archived for a same recurring id in a different sport', async () => {
      // Stored league is football; archiving basketball:sleeper-root must not flag it.
      mockStorage.getSleeperLeagues.mockResolvedValue(stored);
      mockGetArchivedSet.mockResolvedValue(new Set([archivedKey('basketball', 'sleeper-root')]));

      const response = await handleSleeperLeagues(env, 'user_1', corsHeaders);
      const body = (await response.json()) as { leagues: Array<{ archived?: boolean }> };

      expect(body.leagues[0].archived).toBe(false);
    });

    it('internal path excludes archived rows and omits the flag', async () => {
      mockStorage.getSleeperLeagues.mockResolvedValue(stored);

      const response = await handleSleeperLeagues(env, 'user_1', corsHeaders, { includeArchived: false });
      const body = (await response.json()) as { leagues: Array<{ archived?: boolean }> };

      // Storage was asked to exclude archived; archive set is not consulted for annotation.
      expect(mockStorage.getSleeperLeagues).toHaveBeenCalledWith('user_1', false);
      expect(mockGetArchivedSet).not.toHaveBeenCalled();
      expect(body.leagues[0].archived).toBeUndefined();
    });

    it('public path fails OPEN on an archive-set error — returns leagues unflagged', async () => {
      mockStorage.getSleeperLeagues.mockResolvedValue(stored);
      mockGetArchivedSet.mockRejectedValue(new Error('Failed to get archived set: boom'));

      const response = await handleSleeperLeagues(env, 'user_1', corsHeaders);
      const body = (await response.json()) as { leagues: Array<{ archived?: boolean }> };

      // The list still returns 200; the archived flag is simply absent/false.
      expect(response.status).toBe(200);
      expect(body.leagues).toHaveLength(1);
      expect(body.leagues[0].archived).toBe(false);
    });
  });

  // ===========================================================================
  // Sleeper id-flip: archive write resolves the canonical root fresh
  // ===========================================================================

  describe('resolveSleeperArchiveTarget', () => {
    it('re-resolves the canonical root fresh when a row was keyed on a fallback id', async () => {
      // Stored rows are keyed on a season-scoped fallback (recurringLeagueId == leagueId).
      mockStorage.getSleeperLeagues.mockResolvedValue([
        {
          id: 'row-2025',
          clerkUserId: 'user_1',
          leagueId: 'sleeper-2025',
          sport: 'football',
          seasonYear: 2025,
          leagueName: 'Zombie',
          rosterId: 7,
          recurringLeagueId: 'sleeper-2025', // fallback id
          sleeperUserId: 'sleeper_123',
        },
      ]);

      // Fresh chain walk: 2025 -> 2024 (root, no previous_league_id).
      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith('/league/sleeper-2025')) {
          return jsonResponse({
            league_id: 'sleeper-2025',
            name: 'Zombie',
            sport: 'nfl',
            season: '2025',
            previous_league_id: 'sleeper-2024',
          });
        }
        if (url.endsWith('/league/sleeper-2024')) {
          return jsonResponse({
            league_id: 'sleeper-2024',
            name: 'Zombie',
            sport: 'nfl',
            season: '2024',
            previous_league_id: null,
          });
        }
        return new Response(null, { status: 404 });
      });

      // The UI sent the displayed (fallback) id; archive must resolve the true root.
      const target = await resolveSleeperArchiveTarget(env, 'user_1', 'sleeper-2025');

      expect(target.recurringLeagueId).toBe('sleeper-2024');
      expect(target.seasonLeagueIds).toContain('sleeper-2025');
      expect(target.leagueName).toBe('Zombie');
      // Persists the resolved root onto the group's rows so the read-filter key
      // (recurring_league_id ?? league_id) equals the archive key.
      expect(mockStorage.persistRecurringRoot).toHaveBeenCalledWith(
        'user_1',
        ['sleeper-2025'],
        'sleeper-2024',
      );
    });
  });

  // ===========================================================================
  // Backfill mechanism (chain-resolving, not the = league_id shortcut)
  // ===========================================================================

  describe('backfillSleeperRecurringIds', () => {
    it('resolves the chain root and persists it when the stored value differs', async () => {
      mockStorage.getSleeperLeagues.mockResolvedValue([
        {
          id: 'row-2025',
          clerkUserId: 'user_1',
          leagueId: 'sleeper-2025',
          sport: 'football',
          seasonYear: 2025,
          leagueName: 'Zombie',
          rosterId: 7,
          recurringLeagueId: 'sleeper-2025', // stale fallback
          sleeperUserId: 'sleeper_123',
        },
      ]);

      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith('/league/sleeper-2025')) {
          return jsonResponse({
            league_id: 'sleeper-2025',
            name: 'Zombie',
            sport: 'nfl',
            season: '2025',
            previous_league_id: 'sleeper-2024',
          });
        }
        if (url.endsWith('/league/sleeper-2024')) {
          return jsonResponse({
            league_id: 'sleeper-2024',
            name: 'Zombie',
            sport: 'nfl',
            season: '2024',
            previous_league_id: null,
          });
        }
        return new Response(null, { status: 404 });
      });

      const result = await backfillSleeperRecurringIds(env, 'user_1');

      expect(result).toEqual({ processed: 1, resolved: 1 });
      expect(mockStorage.saveSleeperLeague).toHaveBeenCalledWith(
        expect.objectContaining({ leagueId: 'sleeper-2025', recurringLeagueId: 'sleeper-2024' }),
      );
    });
  });
});
