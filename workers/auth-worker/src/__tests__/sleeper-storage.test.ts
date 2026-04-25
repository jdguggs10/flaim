import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SleeperStorage } from '../sleeper-storage';

// Mock Supabase client
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockDelete = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();
const mockMaybeSingle = vi.fn();
const mockUpsert = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: mockFrom,
  }),
}));

describe('SleeperStorage', () => {
  let storage: SleeperStorage;

  beforeEach(() => {
    storage = new SleeperStorage('https://example.supabase.co', 'test-key');

    vi.clearAllMocks();

    // Setup chain mocking
    mockFrom.mockReturnValue({
      select: mockSelect,
      delete: mockDelete,
      upsert: mockUpsert,
    });
    mockSelect.mockReturnValue({
      eq: mockEq,
      single: mockSingle,
      maybeSingle: mockMaybeSingle,
    });
    mockSingle.mockResolvedValue({ data: null, error: null });
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockEq.mockReturnValue({
      eq: mockEq,
      single: mockSingle,
      maybeSingle: mockMaybeSingle,
      select: mockSelect,
      delete: mockDelete,
    });
    mockDelete.mockReturnValue({
      eq: mockEq,
      error: null,
    });
    mockUpsert.mockReturnValue({
      error: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('saveSleeperLeague', () => {
    it('persists recurringLeagueId when the column is available', async () => {
      await storage.saveSleeperLeague({
        clerkUserId: 'user_123',
        leagueId: 'league-2025',
        sport: 'football',
        seasonYear: 2025,
        leagueName: 'Dynasty Squad',
        rosterId: 7,
        recurringLeagueId: 'league-root',
        sleeperUserId: 'sleeper_123',
      });

      expect(mockFrom).toHaveBeenCalledWith('sleeper_leagues');
      expect(mockUpsert).toHaveBeenCalledOnce();
      const payload = mockUpsert.mock.calls[0][0];
      expect(payload).toMatchObject({
        league_id: 'league-2025',
        recurring_league_id: 'league-root',
      });
    });

    it('retries without recurringLeagueId when the column is unavailable', async () => {
      mockUpsert
        .mockReturnValueOnce({
          error: {
            code: '42703',
            message: 'column sleeper_leagues.recurring_league_id does not exist',
          },
        })
        .mockReturnValue({ error: null });

      await storage.saveSleeperLeague({
        clerkUserId: 'user_123',
        leagueId: 'league-2025',
        sport: 'football',
        seasonYear: 2025,
        leagueName: 'Dynasty Squad',
        rosterId: 7,
        recurringLeagueId: 'league-root',
        sleeperUserId: 'sleeper_123',
      });

      expect(mockUpsert).toHaveBeenCalledTimes(2);
      expect(mockUpsert.mock.calls[0][0]).toMatchObject({
        league_id: 'league-2025',
        recurring_league_id: 'league-root',
      });
      expect(mockUpsert.mock.calls[1][0]).toMatchObject({
        league_id: 'league-2025',
      });
      expect(mockUpsert.mock.calls[1][0]).not.toHaveProperty('recurring_league_id');

      mockUpsert.mockClear();

      await storage.saveSleeperLeague({
        clerkUserId: 'user_123',
        leagueId: 'league-2024',
        sport: 'football',
        seasonYear: 2024,
        leagueName: 'Dynasty Squad',
        rosterId: 7,
        recurringLeagueId: 'league-root',
        sleeperUserId: 'sleeper_123',
      });

      expect(mockUpsert).toHaveBeenCalledOnce();
      expect(mockUpsert.mock.calls[0][0]).not.toHaveProperty('recurring_league_id');
    });

    it('retries without recurringLeagueId when PostgREST schema cache is stale', async () => {
      mockUpsert
        .mockReturnValueOnce({
          error: {
            code: 'PGRST204',
            message: "Could not find the 'recurring_league_id' column in the schema cache",
          },
        })
        .mockReturnValue({ error: null });

      await storage.saveSleeperLeague({
        clerkUserId: 'user_123',
        leagueId: 'league-2026',
        sport: 'football',
        seasonYear: 2026,
        leagueName: 'Dynasty Squad',
        rosterId: 7,
        recurringLeagueId: 'league-root',
        sleeperUserId: 'sleeper_123',
      });

      expect(mockUpsert).toHaveBeenCalledTimes(2);
      expect(mockUpsert.mock.calls[0][0]).toMatchObject({
        league_id: 'league-2026',
        recurring_league_id: 'league-root',
      });
      expect(mockUpsert.mock.calls[1][0]).not.toHaveProperty('recurring_league_id');
    });

    it('does not treat unrelated errors as a missing recurringLeagueId column', async () => {
      mockUpsert.mockReturnValueOnce({
        error: {
          code: '42501',
          message: 'permission denied while writing recurring_league_id',
        },
      });

      await expect(
        storage.saveSleeperLeague({
          clerkUserId: 'user_123',
          leagueId: 'league-2027',
          sport: 'football',
          seasonYear: 2027,
          leagueName: 'Dynasty Squad',
          rosterId: 7,
          recurringLeagueId: 'league-root',
          sleeperUserId: 'sleeper_123',
        })
      ).rejects.toThrow('Failed to save Sleeper league: permission denied while writing recurring_league_id');

      expect(mockUpsert).toHaveBeenCalledOnce();
    });
  });

  describe('getSleeperConnection', () => {
    it('returns Sleeper connection metadata including updatedAt', async () => {
      mockSingle.mockResolvedValueOnce({
        data: {
          sleeper_user_id: 'sleeper_123',
          sleeper_username: 'demo_user',
          updated_at: '2026-01-25T12:00:00.000Z',
        },
        error: null,
      });

      const result = await storage.getSleeperConnection('user_123');

      expect(mockFrom).toHaveBeenCalledWith('sleeper_connections');
      expect(mockSelect).toHaveBeenCalledWith('sleeper_user_id, sleeper_username, updated_at');
      expect(mockEq).toHaveBeenCalledWith('clerk_user_id', 'user_123');
      expect(result).toEqual({
        sleeperUserId: 'sleeper_123',
        sleeperUsername: 'demo_user',
        updatedAt: '2026-01-25T12:00:00.000Z',
      });
    });
  });

  // ===========================================================================
  // deleteSleeperLeague Tests
  // ===========================================================================

  describe('deleteSleeperLeague', () => {
    // Test D: lookup returns null — delete proceeds, no default cleanup
    it('deletes a specific league when row lookup returns null (no cleanup needed)', async () => {
      const mockSleeperEq = vi.fn();
      const mockPrefsEq = vi.fn();

      mockSleeperEq.mockReturnValue({
        eq: mockSleeperEq,
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        error: null,
      });
      mockPrefsEq.mockReturnValue({
        eq: mockPrefsEq,
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      });

      const mockSleeperDelete = vi.fn().mockReturnValue({ eq: mockSleeperEq, error: null });
      const mockSleeperSelect = vi.fn().mockReturnValue({ eq: mockSleeperEq });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'sleeper_leagues') {
          return { select: mockSleeperSelect, delete: mockSleeperDelete };
        }
        return { select: vi.fn().mockReturnValue({ eq: mockPrefsEq }) };
      });

      await storage.deleteSleeperLeague('user_123', 'league-uuid');

      expect(mockFrom).toHaveBeenCalledWith('sleeper_leagues');
      expect(mockSleeperDelete).toHaveBeenCalled();
    });

    // Test E: clears matching sport default when lookup resolves the league_id
    it('clears matching sport default when lookup resolves the league_id', async () => {
      const mockPrefsUpsert = vi.fn().mockReturnValue({ error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'sleeper_leagues') {
          const maybeSingle = vi.fn().mockResolvedValue({
            data: { league_id: 'sleeper-league-abc', season_year: 2025 },
            error: null,
          });
          const eqFn = vi.fn();
          eqFn.mockReturnValue({ eq: eqFn, maybeSingle, error: null });
          return {
            select: vi.fn().mockReturnValue({ eq: eqFn }),
            delete: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ error: null }) }) }),
          };
        }
        if (table === 'user_preferences') {
          const prefEq = vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                default_football: { platform: 'sleeper', leagueId: 'sleeper-league-abc', seasonYear: 2025 },
                default_baseball: null,
                default_basketball: null,
                default_hockey: null,
              },
              error: null,
            }),
          });
          return {
            select: vi.fn().mockReturnValue({ eq: prefEq }),
            upsert: mockPrefsUpsert,
          };
        }
        return {};
      });

      await storage.deleteSleeperLeague('user_123', 'league-uuid');

      expect(mockPrefsUpsert).toHaveBeenCalledOnce();
      const upsertArg = mockPrefsUpsert.mock.calls[0][0];
      expect(upsertArg.default_football).toBeNull();
      expect(upsertArg).not.toHaveProperty('default_baseball');
    });

    // Test F: does not clear default when season year does not match
    it('does not clear default when season year does not match', async () => {
      const mockPrefsUpsert = vi.fn();

      mockFrom.mockImplementation((table: string) => {
        if (table === 'sleeper_leagues') {
          const maybeSingleFn = vi.fn().mockResolvedValue({
            data: { league_id: 'sleeper-league-abc', season_year: 2025 }, // row is 2025
            error: null,
          });
          const eqFn = vi.fn();
          eqFn.mockReturnValue({ eq: eqFn, maybeSingle: maybeSingleFn, error: null });
          return {
            select: vi.fn().mockReturnValue({ eq: eqFn }),
            delete: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ error: null }) }) }),
          };
        }
        if (table === 'user_preferences') {
          const prefEq = vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                default_football: { platform: 'sleeper', leagueId: 'sleeper-league-abc', seasonYear: 2024 }, // default is 2024
                default_baseball: null,
                default_basketball: null,
                default_hockey: null,
              },
              error: null,
            }),
          });
          return {
            select: vi.fn().mockReturnValue({ eq: prefEq }),
            upsert: mockPrefsUpsert,
          };
        }
        return {};
      });

      await storage.deleteSleeperLeague('user_123', 'league-uuid');

      // upsert should NOT be called — 2025 row deleted but 2024 default is untouched
      expect(mockPrefsUpsert).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // deleteAllSleeperLeagues Tests
  // ===========================================================================

  describe('deleteAllSleeperLeagues', () => {
    // Test G: clears all Sleeper defaults on full disconnect
    it('clears all Sleeper defaults on full disconnect', async () => {
      const mockPrefsUpsert = vi.fn().mockReturnValue({ error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'sleeper_leagues') {
          return { delete: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ error: null }) }) };
        }
        if (table === 'user_preferences') {
          const prefEq = vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                default_football: { platform: 'sleeper', leagueId: 'sleeper-fb', seasonYear: 2025 },
                default_baseball: { platform: 'sleeper', leagueId: 'sleeper-bb', seasonYear: 2025 },
                default_basketball: { platform: 'espn', leagueId: '999', seasonYear: 2024 }, // different platform — should NOT be cleared
                default_hockey: null,
              },
              error: null,
            }),
          });
          return {
            select: vi.fn().mockReturnValue({ eq: prefEq }),
            upsert: mockPrefsUpsert,
          };
        }
        return {};
      });

      await storage.deleteAllSleeperLeagues('user_123');

      expect(mockPrefsUpsert).toHaveBeenCalledOnce();
      const upsertArg = mockPrefsUpsert.mock.calls[0][0];
      expect(upsertArg.default_football).toBeNull();
      expect(upsertArg.default_baseball).toBeNull();
      // ESPN default should be untouched (not in the upsert payload)
      expect(upsertArg).not.toHaveProperty('default_basketball');
    });

    it('deletes all leagues for a user', async () => {
      mockMaybeSingle.mockResolvedValue({ data: null, error: null });
      mockEq.mockReturnValue({ eq: mockEq, error: null, maybeSingle: mockMaybeSingle });

      await storage.deleteAllSleeperLeagues('user_123');

      expect(mockFrom).toHaveBeenCalledWith('sleeper_leagues');
      expect(mockDelete).toHaveBeenCalled();
      expect(mockEq).toHaveBeenCalledWith('clerk_user_id', 'user_123');
    });
  });

  // ===========================================================================
  // Factory Method Tests
  // ===========================================================================

  describe('fromEnvironment', () => {
    it('creates instance from environment variables', () => {
      const instance = SleeperStorage.fromEnvironment({
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_SERVICE_KEY: 'service-key',
      });

      expect(instance).toBeInstanceOf(SleeperStorage);
    });
  });
});
