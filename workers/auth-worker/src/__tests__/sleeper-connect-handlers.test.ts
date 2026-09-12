import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import {
  fetchSleeperLeaguesReadOnly,
  handleSleeperDiscover,
  handleSleeperLeagueDelete,
  handleSleeperLeagues,
  handleSleeperStatus,
  refreshSleeperLeaguesFromStoredConnection,
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
// The public annotate path now reads getArchivedMap (mode-tagged) rather than the
// flat getArchivedSet, so stub the map. Default: nothing archived (empty map).
const mockGetArchivedMap = vi.fn(async () => new Map<string, 'historical' | 'hidden'>());
// Keep the real archivedKey so the handler's composite-key membership check
// (sport:recurringId) uses the production key format.
const archivedKey = (sport: string, recurringLeagueId: string) => `${sport}:${recurringLeagueId}`;
vi.mock('../archive-storage', () => ({
  ArchiveStorage: {
    fromEnvironment: vi.fn(() => ({ getArchivedMap: mockGetArchivedMap })),
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
    backfillRecurringLeagueId: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    mockGetArchivedMap.mockImplementation(async () => new Map<string, 'historical' | 'hidden'>());

    mockStorage = {
      saveSleeperConnection: vi.fn().mockResolvedValue(undefined),
      saveSleeperLeague: vi.fn().mockResolvedValue(undefined),
      deleteSleeperLeague: vi.fn().mockResolvedValue(undefined),
      getSleeperConnection: vi.fn().mockResolvedValue(null),
      getSleeperLeagues: vi.fn().mockResolvedValue([]),
      persistRecurringRoot: vi.fn().mockResolvedValue(undefined),
      // Default: the conditional write always succeeds (round-3 audit finding
      // — the backfill-only narrow UPDATE that replaced saveSleeperLeague's
      // full-row upsert). Tests below override this to simulate a concurrent
      // delete/fill (returns false).
      backfillRecurringLeagueId: vi.fn().mockResolvedValue(true),
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

  it('refreshes Sleeper leagues from the stored connection username', async () => {
    mockStorage.getSleeperConnection.mockResolvedValueOnce({
      sleeperUserId: 'old_sleeper_id',
      sleeperUsername: 'stored_user',
      updatedAt: '2026-07-04T12:00:00.000Z',
    });

    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/user/stored_user')) {
        return jsonResponse({
          user_id: 'sleeper_stored',
          username: 'stored_user',
          display_name: 'Stored User',
        });
      }
      if (url.includes('/user/sleeper_stored/leagues/nfl/2025')) {
        return jsonResponse([
          {
            league_id: 'stored-nfl-1',
            name: 'Stored NFL',
            sport: 'nfl',
            season: '2025',
            previous_league_id: null,
          },
        ]);
      }
      if (url.includes('/user/sleeper_stored/leagues/nba/2024')) {
        return jsonResponse([]);
      }
      if (url.includes('/league/stored-nfl-1/rosters')) {
        return jsonResponse([
          { roster_id: 3, owner_id: 'sleeper_stored' },
        ]);
      }
      return new Response(null, { status: 404 });
    });

    const result = await refreshSleeperLeaguesFromStoredConnection(env, 'user_1');

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      throw new Error('Expected success result');
    }
    expect(result.details).toEqual({
      success: true,
      username: 'stored_user',
      leagues_found: 1,
      seasons_discovered: 1,
    });
    expect(mockStorage.saveSleeperConnection).toHaveBeenCalledWith('user_1', 'sleeper_stored', 'stored_user');
    expect(mockStorage.saveSleeperLeague).toHaveBeenCalledWith(
      expect.objectContaining({
        clerkUserId: 'user_1',
        leagueId: 'stored-nfl-1',
        sport: 'football',
        seasonYear: 2025,
        rosterId: 3,
        recurringLeagueId: 'stored-nfl-1',
        sleeperUserId: 'sleeper_stored',
      }),
    );
  });

  it('skips stored-connection refresh when the Sleeper username is missing', async () => {
    mockStorage.getSleeperConnection.mockResolvedValueOnce({
      sleeperUserId: 'sleeper_without_username',
      sleeperUsername: null,
      updatedAt: '2026-07-04T12:00:00.000Z',
    });

    const result = await refreshSleeperLeaguesFromStoredConnection(env, 'user_1');

    expect(result).toEqual({
      status: 'skipped',
      error: 'username_missing',
      error_description: 'Stored Sleeper connection does not include a username',
      details: { sleeperUserId: 'sleeper_without_username' },
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockStorage.saveSleeperLeague).not.toHaveBeenCalled();
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
    // processLeague's own persistence depth cap (MAX_HISTORY_YEARS) still
    // limits how many seasons get saved — but the resolver's own walk that
    // identifies the recurring root is unbounded for discovery (audit
    // FLA-168 Fix 2), so it reaches the true 1998 root even though only 5
    // seasons of history get persisted.
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
      // Status excludes archived (both modes); the storage mock here returns the
      // already-filtered set, so assert the count reflects what the handler got.
      mockStorage.getSleeperLeagues.mockResolvedValue([]);

      const response = await handleSleeperStatus(env, 'user_1', corsHeaders);
      const body = (await response.json()) as Record<string, unknown>;

      expect(body.leagueCount).toBe(0);
      expect(mockStorage.getSleeperLeagues).toHaveBeenCalledWith('user_1', 'exclude-archived');
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
      // Composite key: the archived map is keyed by sport:recurringId.
      mockGetArchivedMap.mockResolvedValue(new Map([[archivedKey('football', 'sleeper-root'), 'historical']]));

      const response = await handleSleeperLeagues(env, 'user_1', corsHeaders);
      const body = (await response.json()) as { leagues: Array<{ archived?: boolean; archiveMode?: string }> };

      expect(mockStorage.getSleeperLeagues).toHaveBeenCalledWith('user_1', 'include-all');
      expect(body.leagues[0].archived).toBe(true);
      // Public annotate now also surfaces the mode so the UI can bucket historical vs hidden.
      expect(body.leagues[0].archiveMode).toBe('historical');
    });

    it('public path annotates archiveMode=hidden for a hidden league', async () => {
      mockStorage.getSleeperLeagues.mockResolvedValue(stored);
      mockGetArchivedMap.mockResolvedValue(new Map([[archivedKey('football', 'sleeper-root'), 'hidden']]));

      const response = await handleSleeperLeagues(env, 'user_1', corsHeaders);
      const body = (await response.json()) as { leagues: Array<{ archived?: boolean; archiveMode?: string }> };

      expect(body.leagues[0].archived).toBe(true);
      expect(body.leagues[0].archiveMode).toBe('hidden');
    });

    it('public path does NOT annotate archived for a same recurring id in a different sport', async () => {
      // Stored league is football; archiving basketball:sleeper-root must not flag it.
      mockStorage.getSleeperLeagues.mockResolvedValue(stored);
      mockGetArchivedMap.mockResolvedValue(new Map([[archivedKey('basketball', 'sleeper-root'), 'historical']]));

      const response = await handleSleeperLeagues(env, 'user_1', corsHeaders);
      const body = (await response.json()) as { leagues: Array<{ archived?: boolean; archiveMode?: string }> };

      expect(body.leagues[0].archived).toBe(false);
      expect(body.leagues[0].archiveMode).toBeUndefined();
    });

    it('internal path excludes archived rows and omits the flag', async () => {
      mockStorage.getSleeperLeagues.mockResolvedValue(stored);

      const response = await handleSleeperLeagues(env, 'user_1', corsHeaders, { archived: 'exclude-archived' });
      const body = (await response.json()) as { leagues: Array<{ archived?: boolean }> };

      // Storage was asked to exclude archived; archive map is not consulted for annotation.
      expect(mockStorage.getSleeperLeagues).toHaveBeenCalledWith('user_1', 'exclude-archived');
      expect(mockGetArchivedMap).not.toHaveBeenCalled();
      expect(body.leagues[0].archived).toBeUndefined();
    });

    it('public path fails OPEN on an archive-map error — returns leagues unflagged', async () => {
      mockStorage.getSleeperLeagues.mockResolvedValue(stored);
      mockGetArchivedMap.mockRejectedValue(new Error('Failed to get archived map: boom'));

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
    it('resolves the chain root and persists it for a null row', async () => {
      mockStorage.getSleeperLeagues.mockResolvedValue([
        {
          id: 'row-2025',
          clerkUserId: 'user_1',
          leagueId: 'sleeper-2025',
          sport: 'football',
          seasonYear: 2025,
          leagueName: 'Zombie',
          rosterId: 7,
          recurringLeagueId: null,
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

      expect(result).toEqual({ processed: 1, resolved: 1, changed: 1, unresolved: 0, skippedConcurrent: 0 });
      // Round-3 audit finding: persistence goes through the narrow conditional
      // write, not saveSleeperLeague's full-row upsert.
      expect(mockStorage.backfillRecurringLeagueId).toHaveBeenCalledWith('user_1', 'sleeper-2025', 2025, 'sleeper-2024');
      expect(mockStorage.saveSleeperLeague).not.toHaveBeenCalled();
    });

    it('only writes rows where recurring_league_id is null, leaving already-set rows (even if stale) for sync to correct', async () => {
      mockStorage.getSleeperLeagues.mockResolvedValue([
        { id: 'row-x', clerkUserId: 'user_1', leagueId: 'x', sport: 'football', seasonYear: 2025, leagueName: 'X', rosterId: 1, recurringLeagueId: null, sleeperUserId: 'sleeper_123' },
        { id: 'row-y', clerkUserId: 'user_1', leagueId: 'y', sport: 'football', seasonYear: 2025, leagueName: 'Y', rosterId: 2, recurringLeagueId: 'stale-y', sleeperUserId: 'sleeper_123' },
        { id: 'row-z', clerkUserId: 'user_1', leagueId: 'z', sport: 'football', seasonYear: 2025, leagueName: 'Z', rosterId: 3, recurringLeagueId: 'z', sleeperUserId: 'sleeper_123' },
      ]);
      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        const match = /\/league\/([a-z])$/.exec(url);
        if (match) {
          return jsonResponse({ league_id: match[1], name: match[1], sport: 'nfl', season: '2025', previous_league_id: null });
        }
        return new Response(null, { status: 404 });
      });

      const result = await backfillSleeperRecurringIds(env, 'user_1');

      // Null-only (Fix 3): only row x is a candidate. Row y's non-null-but-stale
      // value and row z's already-correct value are both left untouched —
      // resolution is never even attempted for them.
      expect(result).toEqual({ processed: 3, resolved: 1, changed: 1, unresolved: 0, skippedConcurrent: 0 });
      expect(mockStorage.backfillRecurringLeagueId).toHaveBeenCalledTimes(1);
      expect(mockStorage.backfillRecurringLeagueId).toHaveBeenCalledWith('user_1', 'x', 2025, 'x');
    });

    it('is idempotent: a second run against the persisted result performs zero writes', async () => {
      const row = { id: 'row-x', clerkUserId: 'user_1', leagueId: 'x', sport: 'football', seasonYear: 2025, leagueName: 'X', rosterId: 1, recurringLeagueId: null as string | null, sleeperUserId: 'sleeper_123' };
      mockStorage.getSleeperLeagues.mockResolvedValue([row]);
      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith('/league/x')) {
          return jsonResponse({ league_id: 'x', name: 'X', sport: 'nfl', season: '2025', previous_league_id: null });
        }
        return new Response(null, { status: 404 });
      });

      const first = await backfillSleeperRecurringIds(env, 'user_1');
      expect(first.changed).toBe(1);
      expect(mockStorage.backfillRecurringLeagueId).toHaveBeenCalledTimes(1);

      // Simulate the write the first run performed, then re-run.
      mockStorage.backfillRecurringLeagueId.mockClear();
      mockStorage.getSleeperLeagues.mockResolvedValue([{ ...row, recurringLeagueId: 'x' }]);

      const second = await backfillSleeperRecurringIds(env, 'user_1');
      // Null-only: the now-non-null row is skipped outright, so resolution is
      // never attempted the second time either.
      expect(second).toEqual({ processed: 1, resolved: 0, changed: 0, unresolved: 0, skippedConcurrent: 0 });
      expect(mockStorage.backfillRecurringLeagueId).not.toHaveBeenCalled();
    });

    it('counts a concurrent delete/fill between snapshot and write as a clean skip, not a write', async () => {
      // Row is NULL in the snapshot read, but by the time the conditional
      // write runs, another process (a delete, or normal sync filling the
      // same field) has already changed it — the guarded UPDATE matches zero
      // rows (round-3 audit finding: this must never fall back to an
      // unconditional upsert that could resurrect a deleted row or clobber a
      // fresher value).
      mockStorage.getSleeperLeagues.mockResolvedValue([
        { id: 'row-x', clerkUserId: 'user_1', leagueId: 'x', sport: 'football', seasonYear: 2025, leagueName: 'X', rosterId: 1, recurringLeagueId: null, sleeperUserId: 'sleeper_123' },
      ]);
      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith('/league/x')) {
          return jsonResponse({ league_id: 'x', name: 'X', sport: 'nfl', season: '2025', previous_league_id: null });
        }
        return new Response(null, { status: 404 });
      });
      mockStorage.backfillRecurringLeagueId.mockResolvedValue(false);

      const result = await backfillSleeperRecurringIds(env, 'user_1');

      // Resolution still succeeded (resolved: 1) — only the write was a no-op.
      expect(result).toEqual({ processed: 1, resolved: 1, changed: 0, unresolved: 0, skippedConcurrent: 1 });
      expect(mockStorage.backfillRecurringLeagueId).toHaveBeenCalledWith('user_1', 'x', 2025, 'x');
      expect(mockStorage.saveSleeperLeague).not.toHaveBeenCalled();
    });

    it('dry run reports would-change detail without calling backfillRecurringLeagueId', async () => {
      mockStorage.getSleeperLeagues.mockResolvedValue([
        { id: 'row-x', clerkUserId: 'user_1', leagueId: 'x', sport: 'football', seasonYear: 2025, leagueName: 'X', rosterId: 1, recurringLeagueId: null, sleeperUserId: 'sleeper_123' },
      ]);
      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith('/league/x')) {
          return jsonResponse({ league_id: 'x', name: 'X', sport: 'nfl', season: '2025', previous_league_id: null });
        }
        return new Response(null, { status: 404 });
      });

      const result = await backfillSleeperRecurringIds(env, 'user_1', { dryRun: true });

      expect(result).toEqual({
        processed: 1,
        resolved: 1,
        changed: 1,
        unresolved: 0,
        skippedConcurrent: 0,
        rows: [{ userId: 'user_1', leagueId: 'x', currentRecurringId: null, wouldSetRecurringId: 'x' }],
      });
      expect(mockStorage.backfillRecurringLeagueId).not.toHaveBeenCalled();
      expect(mockStorage.saveSleeperLeague).not.toHaveBeenCalled();
    });

    it('does not persist a fallback for a cyclic previous_league_id chain — leaves the row unresolved', async () => {
      mockStorage.getSleeperLeagues.mockResolvedValue([
        { id: 'row-a', clerkUserId: 'user_1', leagueId: 'cycle-a', sport: 'football', seasonYear: 2025, leagueName: 'Cycle', rosterId: 1, recurringLeagueId: null, sleeperUserId: 'sleeper_123' },
      ]);
      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith('/league/cycle-a')) {
          return jsonResponse({ league_id: 'cycle-a', name: 'Cycle', sport: 'nfl', season: '2025', previous_league_id: 'cycle-b' });
        }
        if (url.endsWith('/league/cycle-b')) {
          return jsonResponse({ league_id: 'cycle-b', name: 'Cycle', sport: 'nfl', season: '2024', previous_league_id: 'cycle-a' });
        }
        return new Response(null, { status: 404 });
      });

      const result = await backfillSleeperRecurringIds(env, 'user_1');

      // Audit Fix 1: a cycle is unresolved, not a discovered root — the row
      // stays NULL rather than being poisoned with a self-referential fallback.
      expect(result).toEqual({ processed: 1, resolved: 0, changed: 0, unresolved: 1, skippedConcurrent: 0 });
      expect(mockStorage.backfillRecurringLeagueId).not.toHaveBeenCalled();
    });

    it('leaves a row unresolved on a mid-chain fetch failure, then repairs it on a healthy re-run (outage -> rerun -> repair)', async () => {
      const row = { id: 'row-a', clerkUserId: 'user_1', leagueId: 'flaky-2025', sport: 'football', seasonYear: 2025, leagueName: 'Flaky', rosterId: 1, recurringLeagueId: null as string | null, sleeperUserId: 'sleeper_123' };
      mockStorage.getSleeperLeagues.mockResolvedValue([row]);

      // First run: the chain's second hop 5xxs mid-walk (transient outage).
      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith('/league/flaky-2025')) {
          return jsonResponse({ league_id: 'flaky-2025', name: 'Flaky', sport: 'nfl', season: '2025', previous_league_id: 'flaky-2024' });
        }
        if (url.endsWith('/league/flaky-2024')) {
          return new Response(null, { status: 503 });
        }
        return new Response(null, { status: 404 });
      });

      const first = await backfillSleeperRecurringIds(env, 'user_1');

      expect(first).toEqual({ processed: 1, resolved: 0, changed: 0, unresolved: 1, skippedConcurrent: 0 });
      expect(mockStorage.backfillRecurringLeagueId).not.toHaveBeenCalled();

      // Second run: same still-NULL row, but the upstream API is healthy now.
      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith('/league/flaky-2025')) {
          return jsonResponse({ league_id: 'flaky-2025', name: 'Flaky', sport: 'nfl', season: '2025', previous_league_id: 'flaky-2024' });
        }
        if (url.endsWith('/league/flaky-2024')) {
          return jsonResponse({ league_id: 'flaky-2024', name: 'Flaky', sport: 'nfl', season: '2024', previous_league_id: null });
        }
        return new Response(null, { status: 404 });
      });

      const second = await backfillSleeperRecurringIds(env, 'user_1');

      expect(second).toEqual({ processed: 1, resolved: 1, changed: 1, unresolved: 0, skippedConcurrent: 0 });
      expect(mockStorage.backfillRecurringLeagueId).toHaveBeenCalledWith('user_1', 'flaky-2025', 2025, 'flaky-2024');
    });

    it('stops an eleven-link chain at the MAX_HISTORY_YEARS depth cap and treats it as unresolved', async () => {
      // deep-0 -> deep-1 -> ... -> deep-10 (root). Ten hops exhausts the
      // 10-season cap (FLA-303 raised it from 5), so deep-10 is never even
      // fetched.
      mockStorage.getSleeperLeagues.mockResolvedValue([
        { id: 'row-deep', clerkUserId: 'user_1', leagueId: 'deep-0', sport: 'football', seasonYear: 2025, leagueName: 'Deep', rosterId: 1, recurringLeagueId: null, sleeperUserId: 'sleeper_123' },
      ]);
      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        const match = /\/league\/deep-(\d+)$/.exec(url);
        if (match) {
          const n = Number(match[1]);
          return jsonResponse({
            league_id: `deep-${n}`,
            name: 'Deep',
            sport: 'nfl',
            season: String(2025 - n),
            previous_league_id: n < 10 ? `deep-${n + 1}` : null,
          });
        }
        return new Response(null, { status: 404 });
      });

      const result = await backfillSleeperRecurringIds(env, 'user_1');

      expect(result).toEqual({ processed: 1, resolved: 0, changed: 0, unresolved: 1, skippedConcurrent: 0 });
      expect(mockStorage.backfillRecurringLeagueId).not.toHaveBeenCalled();
      // deep-10 (the 11th league, and the true root) must never be fetched.
      const fetchedUrls = mockFetch.mock.calls.map((call) => String(call[0]));
      expect(fetchedUrls.some((url) => url.endsWith('/league/deep-10'))).toBe(false);
    });

    it('does not let a cap-exceeded deep chain poison resolution for a shorter row sharing an intermediate league (round-3 audit finding)', async () => {
      // Row A's chain is 11 links deep (deep-0..deep-10, deep-10 being the
      // true root) — one more hop than the 10-season MAX_HISTORY_YEARS cap
      // allows, so row A's walk gives up partway through, having only visited
      // deep-0..deep-9 (10 nodes) before hitting the cap on the 11th
      // (deep-10, never fetched).
      //
      // Row B is a SEPARATE stored row whose own league_id happens to be
      // "deep-3" — one of the intermediate leagues row A's walk visited
      // (plausible: an older season's row the user still has, whose current
      // chain merges into the same history). Row B's OWN walk from deep-3 is
      // only 7 hops from the real root (deep-3 -> ... -> deep-10), well
      // within its own fresh 10-hop budget.
      //
      // Both rows resolve within ONE backfillSleeperRecurringIds call, so
      // they share a single recurringIdCache. The bug: row A's cap-exceeded
      // walk used to write a null entry into that shared cache for every
      // node on its path — including deep-3 — so row B's `cache.has('deep-3')`
      // would hit that poisoned null and fail immediately without ever
      // attempting its own (perfectly resolvable) walk.
      mockStorage.getSleeperLeagues.mockResolvedValue([
        { id: 'row-deep', clerkUserId: 'user_1', leagueId: 'deep-0', sport: 'football', seasonYear: 2025, leagueName: 'Deep', rosterId: 1, recurringLeagueId: null, sleeperUserId: 'sleeper_123' },
        { id: 'row-mid', clerkUserId: 'user_1', leagueId: 'deep-3', sport: 'football', seasonYear: 2022, leagueName: 'Deep (older row)', rosterId: 1, recurringLeagueId: null, sleeperUserId: 'sleeper_123' },
      ]);
      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        const match = /\/league\/deep-(\d+)$/.exec(url);
        if (match) {
          const n = Number(match[1]);
          return jsonResponse({
            league_id: `deep-${n}`,
            name: 'Deep',
            sport: 'nfl',
            season: String(2025 - n),
            previous_league_id: n < 10 ? `deep-${n + 1}` : null,
          });
        }
        return new Response(null, { status: 404 });
      });

      const result = await backfillSleeperRecurringIds(env, 'user_1');

      // Row A (deep-0) hits the cap and stays unresolved; row B (deep-3)
      // still resolves to the true root despite deep-0's walk having visited
      // deep-3 first and given up there.
      expect(result.processed).toBe(2);
      expect(result.resolved).toBe(1);
      expect(result.unresolved).toBe(1);
      expect(mockStorage.backfillRecurringLeagueId).toHaveBeenCalledTimes(1);
      expect(mockStorage.backfillRecurringLeagueId).toHaveBeenCalledWith('user_1', 'deep-3', 2022, 'deep-10');
      expect(mockStorage.backfillRecurringLeagueId).not.toHaveBeenCalledWith('user_1', 'deep-0', 2025, expect.anything());
    });

    // Round-4 audit finding (Fix 1a): per-user work is unbounded relative to
    // the backfill orchestrator's lease TTL — a user can own many rows, and
    // each row's own chain walk can make several Sleeper requests. The
    // orchestrator (sleeper-recurring-backfill.ts) renews the lease via this
    // hook before EVERY row, not once per user. Row x is checked TWICE
    // (round-5 audit finding, Fix 1a: once pre-row, once again immediately
    // before its persist call) before row y's pre-row check denies it.
    it('checks options.onRowCheckpoint before EACH row (and again before each persist), not once per user, and stops immediately with no further writes once it reports the lease lost', async () => {
      mockStorage.getSleeperLeagues.mockResolvedValue([
        { id: 'row-x', clerkUserId: 'user_1', leagueId: 'x', sport: 'football', seasonYear: 2025, leagueName: 'X', rosterId: 1, recurringLeagueId: null, sleeperUserId: 'sleeper_123' },
        { id: 'row-y', clerkUserId: 'user_1', leagueId: 'y', sport: 'football', seasonYear: 2025, leagueName: 'Y', rosterId: 2, recurringLeagueId: null, sleeperUserId: 'sleeper_123' },
      ]);
      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        const match = /\/league\/([a-z])$/.exec(url);
        if (match) {
          return jsonResponse({ league_id: match[1], name: match[1], sport: 'nfl', season: '2025', previous_league_id: null });
        }
        return new Response(null, { status: 404 });
      });
      const onRowCheckpoint = vi.fn()
        .mockResolvedValueOnce(true) // pre-row x
        .mockResolvedValueOnce(true) // pre-persist x
        .mockResolvedValueOnce(false); // pre-row y

      const result = await backfillSleeperRecurringIds(env, 'user_1', { onRowCheckpoint });

      // Checked before row x, again right before its persist, and before row
      // y (denied) — never skipped just because it's the "same user".
      expect(onRowCheckpoint).toHaveBeenCalledTimes(3);
      // Row x was fully processed (both its checkpoints passed). Row y's
      // checkpoint failed BEFORE any work started on it, so it's never even
      // counted in `processed`.
      expect(result.processed).toBe(1);
      expect(result.resolved).toBe(1);
      expect(result.changed).toBe(1);
      expect(result.leaseLost).toBe(true);
      expect(mockStorage.backfillRecurringLeagueId).toHaveBeenCalledTimes(1);
      expect(mockStorage.backfillRecurringLeagueId).toHaveBeenCalledWith('user_1', 'x', 2025, 'x');
      expect(mockStorage.backfillRecurringLeagueId).not.toHaveBeenCalledWith('user_1', 'y', expect.anything(), expect.anything());
    });

    // Round-5 audit finding (Fix 1a): the pre-row checkpoint alone only
    // proves the lease looked held BEFORE a row's (possibly slow) chain
    // walk. A loss detected DURING that walk — by a concurrent batch lane
    // sharing the same renewer, in the real orchestrator — must still fence
    // this row's write, not just the next row's pre-row check.
    it('fences the write when onRowCheckpoint is denied immediately before persist, even though the row already resolved successfully', async () => {
      mockStorage.getSleeperLeagues.mockResolvedValue([
        { id: 'row-x', clerkUserId: 'user_1', leagueId: 'x', sport: 'football', seasonYear: 2025, leagueName: 'X', rosterId: 1, recurringLeagueId: null, sleeperUserId: 'sleeper_123' },
      ]);
      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith('/league/x')) {
          return jsonResponse({ league_id: 'x', name: 'X', sport: 'nfl', season: '2025', previous_league_id: null });
        }
        return new Response(null, { status: 404 });
      });
      const onRowCheckpoint = vi.fn()
        .mockResolvedValueOnce(true) // pre-row: lease still looked held
        .mockResolvedValueOnce(false); // pre-persist: lost while the chain walk ran

      const result = await backfillSleeperRecurringIds(env, 'user_1', { onRowCheckpoint });

      expect(onRowCheckpoint).toHaveBeenCalledTimes(2);
      // The row's resolution succeeded (resolved: 1) but the write itself
      // never happened — this is the write-granularity fence, not a
      // resolution-time one.
      expect(result.resolved).toBe(1);
      expect(result.changed).toBe(0);
      expect(result.leaseLost).toBe(true);
      expect(mockStorage.backfillRecurringLeagueId).not.toHaveBeenCalled();
    });

    it('omits leaseLost from the result entirely when no onRowCheckpoint is provided (default/dry-run shape unchanged)', async () => {
      mockStorage.getSleeperLeagues.mockResolvedValue([
        { id: 'row-x', clerkUserId: 'user_1', leagueId: 'x', sport: 'football', seasonYear: 2025, leagueName: 'X', rosterId: 1, recurringLeagueId: null, sleeperUserId: 'sleeper_123' },
      ]);
      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith('/league/x')) {
          return jsonResponse({ league_id: 'x', name: 'X', sport: 'nfl', season: '2025', previous_league_id: null });
        }
        return new Response(null, { status: 404 });
      });

      const result = await backfillSleeperRecurringIds(env, 'user_1');

      expect(result).toEqual({ processed: 1, resolved: 1, changed: 1, unresolved: 0, skippedConcurrent: 0 });
      expect('leaseLost' in result).toBe(false);
    });

    // Round-4 audit finding (Fix 2): the per-run leagueCache stores fetch
    // PROMISES; without eviction on rejection, a transient failure fetching a
    // shared intermediate league stays cached as a rejected promise for the
    // rest of this call, so a later row whose own chain passes through the
    // same league fails instantly too — even after Sleeper recovers.
    it('does not let a transient failure fetching a shared intermediate league poison a LATER row that walks through the same league in the same run', async () => {
      mockStorage.getSleeperLeagues.mockResolvedValue([
        { id: 'row-a', clerkUserId: 'user_1', leagueId: 'row-a-league', sport: 'football', seasonYear: 2025, leagueName: 'A', rosterId: 1, recurringLeagueId: null, sleeperUserId: 'sleeper_123' },
        { id: 'row-b', clerkUserId: 'user_1', leagueId: 'row-b-league', sport: 'football', seasonYear: 2024, leagueName: 'B', rosterId: 2, recurringLeagueId: null, sleeperUserId: 'sleeper_123' },
      ]);

      let sharedFetchCount = 0;
      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        if (url.endsWith('/league/row-a-league')) {
          return jsonResponse({ league_id: 'row-a-league', name: 'A', sport: 'nfl', season: '2025', previous_league_id: 'shared-x' });
        }
        if (url.endsWith('/league/row-b-league')) {
          return jsonResponse({ league_id: 'row-b-league', name: 'B', sport: 'nfl', season: '2024', previous_league_id: 'shared-x' });
        }
        if (url.endsWith('/league/shared-x')) {
          sharedFetchCount++;
          if (sharedFetchCount === 1) {
            // Row A's walk hits a transient 503 fetching the shared league.
            return new Response(null, { status: 503 });
          }
          // Sleeper has recovered by the time row B's walk reaches it.
          return jsonResponse({ league_id: 'shared-x', name: 'Shared', sport: 'nfl', season: '2023', previous_league_id: null });
        }
        return new Response(null, { status: 404 });
      });

      const result = await backfillSleeperRecurringIds(env, 'user_1');

      // Row A's walk failed at the shared league and stays unresolved. Row
      // B's walk reaches the SAME shared league fresh — not poisoned by row
      // A's cached rejection — and resolves successfully.
      expect(result.processed).toBe(2);
      expect(result.resolved).toBe(1);
      expect(result.unresolved).toBe(1);
      // Proves getSleeperLeague re-fetched for row B instead of reusing the
      // rejected promise cached by row A's walk.
      expect(sharedFetchCount).toBe(2);
      expect(mockStorage.backfillRecurringLeagueId).toHaveBeenCalledTimes(1);
      expect(mockStorage.backfillRecurringLeagueId).toHaveBeenCalledWith('user_1', 'row-b-league', 2024, 'shared-x');
    });
  });

  // ===========================================================================
  // fetchSleeperLeaguesReadOnly (FLA-188: discovery timeouts + error classification)
  // ===========================================================================

  describe('fetchSleeperLeaguesReadOnly', () => {
    beforeEach(() => {
      mockStorage.getSleeperConnection.mockResolvedValue({
        sleeperUserId: 'sleeper_123',
        sleeperUsername: 'a_user',
        updatedAt: '2026-07-04T12:00:00.000Z',
      });
    });

    it('surfaces the HTTP status when every sport request is rate-limited', async () => {
      mockFetch.mockResolvedValue(new Response(null, { status: 429 }));

      const result = await fetchSleeperLeaguesReadOnly(env, 'user_1', [
        { sleeperSport: 'nfl', seasonYear: 2025 },
      ]);

      expect(result).toEqual({
        status: 'error',
        errorCode: 'sleeper_unavailable',
        httpStatus: 429,
      });
    });

    it('classifies a timed-out fetch as sleeper_timeout without an HTTP status', async () => {
      const timeoutError = new DOMException('The operation timed out.', 'TimeoutError');
      mockFetch.mockRejectedValue(timeoutError);

      const result = await fetchSleeperLeaguesReadOnly(env, 'user_1', [
        { sleeperSport: 'nfl', seasonYear: 2025 },
      ]);

      expect(result).toEqual({ status: 'error', errorCode: 'sleeper_timeout' });
      // The timeout classification only matters if the request actually carries
      // an abort signal — assert sleeperGet still wires one up (FLA-188).
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('classifies as sleeper_timeout when any rejection (not just the first) is a timeout', async () => {
      const timeoutError = new DOMException('The operation timed out.', 'TimeoutError');
      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/leagues/nfl/')) {
          return new Response(null, { status: 404 });
        }
        if (url.includes('/leagues/nba/')) {
          throw timeoutError;
        }
        return new Response(null, { status: 404 });
      });

      const result = await fetchSleeperLeaguesReadOnly(env, 'user_1', [
        { sleeperSport: 'nfl', seasonYear: 2025 },
        { sleeperSport: 'nba', seasonYear: 2025 },
      ]);

      expect(result).toEqual({ status: 'error', errorCode: 'sleeper_timeout' });
    });
  });
});
