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

    // archive cleanup: a true delete unarchives the matching (platform, sport, recurringId).
    it('removes the matching archive row keyed on (sleeper, sport, recurringId)', async () => {
      const mockArchiveDelete = vi.fn();
      // Single sleeper_leagues select returns all four columns
      // {league_id, season_year, recurring_league_id, sport}.
      mockFrom.mockImplementation((table: string) => {
        if (table === 'sleeper_leagues') {
          const maybeSingle = vi.fn().mockResolvedValue({
            data: { league_id: 'L2025', season_year: 2025, recurring_league_id: 'ROOT', sport: 'basketball' },
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
              data: { default_football: null, default_baseball: null, default_basketball: null, default_hockey: null },
              error: null,
            }),
          });
          return { select: vi.fn().mockReturnValue({ eq: prefEq }), upsert: vi.fn() };
        }
        if (table === 'archived_leagues') {
          // delete().eq(user).eq(platform).eq(sport).eq(recurring) — final eq resolves
          let calls = 0;
          const eq = vi.fn();
          eq.mockImplementation(() => {
            calls += 1;
            if (calls >= 4) return Promise.resolve({ error: null });
            return { eq };
          });
          return { delete: mockArchiveDelete.mockReturnValue({ eq }) };
        }
        return {};
      });

      await storage.deleteSleeperLeague('user_123', 'league-uuid');

      expect(mockArchiveDelete).toHaveBeenCalled();
      // Assert the archive delete was keyed on the actual (platform, sport, recurringId),
      // not just that it ran — a wrong sport/id would otherwise pass.
      const eqMock = mockArchiveDelete.mock.results[0].value.eq;
      const eqArgs = eqMock.mock.calls.map((c: unknown[]) => c as [string, string]);
      expect(eqArgs).toContainEqual(['clerk_user_id', 'user_123']);
      expect(eqArgs).toContainEqual(['platform', 'sleeper']);
      expect(eqArgs).toContainEqual(['sport', 'basketball']);
      expect(eqArgs).toContainEqual(['recurring_league_id', 'ROOT']);
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

  // ===========================================================================
  // includeArchived filter (Sleeper) — archive key is recurring_league_id ?? league_id
  // ===========================================================================

  describe('getSleeperLeagues includeArchived', () => {
    // sleeper_leagues read: .select('*').eq('clerk_user_id', ...).order(...)
    function mockLeaguesRead(rows: unknown[]) {
      const order = vi.fn().mockResolvedValue({ data: rows, error: null });
      const eq = vi.fn().mockReturnValue({ order });
      return { select: vi.fn().mockReturnValue({ eq }) };
    }
    // archived_leagues read: .select('sport, recurring_league_id').eq(user).eq(platform).
    // Rows default to football (matching the league fixtures); pass [sport, id] tuples
    // to archive a specific sport.
    function mockArchiveRead(ids: (string | [string, string])[]) {
      const eqPlatform = vi.fn().mockResolvedValue({
        data: ids.map((entry) =>
          Array.isArray(entry)
            ? { sport: entry[0], recurring_league_id: entry[1] }
            : { sport: 'football', recurring_league_id: entry }
        ),
        error: null,
      });
      const eqUser = vi.fn().mockReturnValue({ eq: eqPlatform });
      return { select: vi.fn().mockReturnValue({ eq: eqUser }) };
    }

    it('excludes a row whose recurring_league_id is archived', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'sleeper_leagues') {
          return mockLeaguesRead([
            { id: 'a', clerk_user_id: 'u', league_id: 'L2025', sport: 'football', season_year: 2025, league_name: 'Zombie', roster_id: 1, recurring_league_id: 'ROOT', sleeper_user_id: 's' },
            { id: 'b', clerk_user_id: 'u', league_id: 'K2025', sport: 'football', season_year: 2025, league_name: 'Keep', roster_id: 2, recurring_league_id: 'KROOT', sleeper_user_id: 's' },
          ]);
        }
        if (table === 'archived_leagues') return mockArchiveRead(['ROOT']);
        return {};
      });

      const result = await storage.getSleeperLeagues('u', 'exclude-archived');
      expect(result.map((l) => l.leagueId)).toEqual(['K2025']);
    });

    it('does NOT over-hide a same recurring id in a different sport (cross-sport no-collision)', async () => {
      // Archive football ROOT; a basketball league that shares the recurring id ROOT
      // is a distinct league and must remain visible.
      mockFrom.mockImplementation((table: string) => {
        if (table === 'sleeper_leagues') {
          return mockLeaguesRead([
            { id: 'a', clerk_user_id: 'u', league_id: 'L2025', sport: 'football', season_year: 2025, league_name: 'FB Zombie', roster_id: 1, recurring_league_id: 'ROOT', sleeper_user_id: 's' },
            { id: 'b', clerk_user_id: 'u', league_id: 'B2025', sport: 'basketball', season_year: 2025, league_name: 'BB Keep', roster_id: 2, recurring_league_id: 'ROOT', sleeper_user_id: 's' },
          ]);
        }
        if (table === 'archived_leagues') return mockArchiveRead([['football', 'ROOT']]);
        return {};
      });

      const result = await storage.getSleeperLeagues('u', 'exclude-archived');
      // Only the football ROOT is hidden; the basketball ROOT survives.
      expect(result.map((l) => ({ leagueId: l.leagueId, sport: l.sport }))).toEqual([
        { leagueId: 'B2025', sport: 'basketball' },
      ]);
    });

    it('falls back to league_id when recurring_league_id is null (null-recurring fallback)', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'sleeper_leagues') {
          return mockLeaguesRead([
            { id: 'a', clerk_user_id: 'u', league_id: 'L2025', sport: 'football', season_year: 2025, league_name: 'Zombie', roster_id: 1, recurring_league_id: null, sleeper_user_id: 's' },
            { id: 'b', clerk_user_id: 'u', league_id: 'K2025', sport: 'football', season_year: 2025, league_name: 'Keep', roster_id: 2, recurring_league_id: null, sleeper_user_id: 's' },
          ]);
        }
        // Archived on the season-scoped fallback id L2025
        if (table === 'archived_leagues') return mockArchiveRead(['L2025']);
        return {};
      });

      const result = await storage.getSleeperLeagues('u', 'exclude-archived');
      expect(result.map((l) => l.leagueId)).toEqual(['K2025']);
    });

    it('fails CLOSED: propagates a thrown archive-set error on the exclude path', async () => {
      // archived_leagues read errors → getArchivedSet throws → getSleeperLeagues
      // (includeArchived:false) propagates rather than returning unfiltered rows.
      function mockArchiveError() {
        const eqPlatform = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
        const eqUser = vi.fn().mockReturnValue({ eq: eqPlatform });
        return { select: vi.fn().mockReturnValue({ eq: eqUser }) };
      }
      mockFrom.mockImplementation((table: string) => {
        if (table === 'sleeper_leagues') {
          return mockLeaguesRead([
            { id: 'a', clerk_user_id: 'u', league_id: 'L2025', sport: 'football', season_year: 2025, league_name: 'Zombie', roster_id: 1, recurring_league_id: 'ROOT', sleeper_user_id: 's' },
          ]);
        }
        if (table === 'archived_leagues') return mockArchiveError();
        return {};
      });

      await expect(storage.getSleeperLeagues('u', 'exclude-archived')).rejects.toThrow('Failed to get archived map');
    });

    // archived_leagues read with explicit modes: pass [sport, id, mode] tuples.
    function mockArchiveReadModes(rows: [string, string, 'historical' | 'hidden'][]) {
      const eqPlatform = vi.fn().mockResolvedValue({
        data: rows.map(([sport, recurring_league_id, mode]) => ({ sport, recurring_league_id, mode })),
        error: null,
      });
      const eqUser = vi.fn().mockReturnValue({ eq: eqPlatform });
      return { select: vi.fn().mockReturnValue({ eq: eqUser }) };
    }

    it('exclude-hidden keeps a historical row, drops a hidden one, and keeps non-archived', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'sleeper_leagues') {
          return mockLeaguesRead([
            { id: 'a', clerk_user_id: 'u', league_id: 'ACT', sport: 'football', season_year: 2025, league_name: 'Active', roster_id: 1, recurring_league_id: 'ACTROOT', sleeper_user_id: 's' },
            { id: 'b', clerk_user_id: 'u', league_id: 'HIST', sport: 'football', season_year: 2025, league_name: 'Historical', roster_id: 2, recurring_league_id: 'HISTROOT', sleeper_user_id: 's' },
            { id: 'c', clerk_user_id: 'u', league_id: 'HID', sport: 'football', season_year: 2025, league_name: 'Hidden', roster_id: 3, recurring_league_id: 'HIDROOT', sleeper_user_id: 's' },
          ]);
        }
        if (table === 'archived_leagues') return mockArchiveReadModes([
          ['football', 'HISTROOT', 'historical'],
          ['football', 'HIDROOT', 'hidden'],
        ]);
        return {};
      });

      const result = await storage.getSleeperLeagues('u', 'exclude-hidden');
      expect(result.map((l) => l.leagueId)).toEqual(['ACT', 'HIST']);
    });

    it('exclude-archived drops BOTH historical and hidden rows', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'sleeper_leagues') {
          return mockLeaguesRead([
            { id: 'a', clerk_user_id: 'u', league_id: 'ACT', sport: 'football', season_year: 2025, league_name: 'Active', roster_id: 1, recurring_league_id: 'ACTROOT', sleeper_user_id: 's' },
            { id: 'b', clerk_user_id: 'u', league_id: 'HIST', sport: 'football', season_year: 2025, league_name: 'Historical', roster_id: 2, recurring_league_id: 'HISTROOT', sleeper_user_id: 's' },
            { id: 'c', clerk_user_id: 'u', league_id: 'HID', sport: 'football', season_year: 2025, league_name: 'Hidden', roster_id: 3, recurring_league_id: 'HIDROOT', sleeper_user_id: 's' },
          ]);
        }
        if (table === 'archived_leagues') return mockArchiveReadModes([
          ['football', 'HISTROOT', 'historical'],
          ['football', 'HIDROOT', 'hidden'],
        ]);
        return {};
      });

      const result = await storage.getSleeperLeagues('u', 'exclude-archived');
      expect(result.map((l) => l.leagueId)).toEqual(['ACT']);
    });

    it('include-all returns everything regardless of mode', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'sleeper_leagues') {
          return mockLeaguesRead([
            { id: 'a', clerk_user_id: 'u', league_id: 'ACT', sport: 'football', season_year: 2025, league_name: 'Active', roster_id: 1, recurring_league_id: 'ACTROOT', sleeper_user_id: 's' },
            { id: 'b', clerk_user_id: 'u', league_id: 'HIST', sport: 'football', season_year: 2025, league_name: 'Historical', roster_id: 2, recurring_league_id: 'HISTROOT', sleeper_user_id: 's' },
            { id: 'c', clerk_user_id: 'u', league_id: 'HID', sport: 'football', season_year: 2025, league_name: 'Hidden', roster_id: 3, recurring_league_id: 'HIDROOT', sleeper_user_id: 's' },
          ]);
        }
        if (table === 'archived_leagues') return mockArchiveReadModes([
          ['football', 'HISTROOT', 'historical'],
          ['football', 'HIDROOT', 'hidden'],
        ]);
        return {};
      });

      const result = await storage.getSleeperLeagues('u', 'include-all');
      expect(result.map((l) => l.leagueId)).toEqual(['ACT', 'HIST', 'HID']);
    });

    it('returns all rows and skips the archive read when includeArchived is true', async () => {
      const archiveSelect = vi.fn();
      mockFrom.mockImplementation((table: string) => {
        if (table === 'sleeper_leagues') {
          return mockLeaguesRead([
            { id: 'a', clerk_user_id: 'u', league_id: 'L2025', sport: 'football', season_year: 2025, league_name: 'Zombie', roster_id: 1, recurring_league_id: 'ROOT', sleeper_user_id: 's' },
          ]);
        }
        if (table === 'archived_leagues') return { select: archiveSelect };
        return {};
      });

      const result = await storage.getSleeperLeagues('u');
      expect(result.map((l) => l.leagueId)).toEqual(['L2025']);
      expect(archiveSelect).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // persistRecurringRoot + read-filter parity (stored recurring root matches the archive key)
  // ===========================================================================

  describe('persistRecurringRoot', () => {
    it('persists the resolved root so the read-filter excludes a NULL-recurring archived row', async () => {
      // sleeper_leagues UPDATE: .update({...}).eq('clerk_user_id', user).in('league_id', ids)
      const mockUpdateIn = vi.fn().mockResolvedValue({ error: null });
      const mockUpdateEq = vi.fn().mockReturnValue({ in: mockUpdateIn });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq });

      // Row starts with recurring_league_id = NULL; after persist it stores ROOT2024.
      let storedRecurring: string | null = null;

      // sleeper_leagues read: .select('*').eq('clerk_user_id', ...).order(...)
      function mockLeaguesRead() {
        const order = vi.fn().mockImplementation(async () => ({
          data: [
            { id: 'a', clerk_user_id: 'u', league_id: 'L2025', sport: 'football', season_year: 2025, league_name: 'Zombie', roster_id: 1, recurring_league_id: storedRecurring, sleeper_user_id: 's' },
          ],
          error: null,
        }));
        const eq = vi.fn().mockReturnValue({ order });
        return { select: vi.fn().mockReturnValue({ eq }), update: mockUpdate };
      }
      // archived_leagues read: archive key is the resolved root ROOT2024.
      function mockArchiveRead() {
        const eqPlatform = vi.fn().mockResolvedValue({
          data: [{ sport: 'football', recurring_league_id: 'ROOT2024' }],
          error: null,
        });
        const eqUser = vi.fn().mockReturnValue({ eq: eqPlatform });
        return { select: vi.fn().mockReturnValue({ eq: eqUser }) };
      }

      mockFrom.mockImplementation((table: string) => {
        if (table === 'sleeper_leagues') return mockLeaguesRead();
        if (table === 'archived_leagues') return mockArchiveRead();
        return {};
      });

      // (a) Persist the resolved root onto the season-scoped row.
      await storage.persistRecurringRoot('u', ['L2025'], 'ROOT2024');
      expect(mockUpdate).toHaveBeenCalledOnce();
      expect(mockUpdate.mock.calls[0][0]).toMatchObject({ recurring_league_id: 'ROOT2024' });
      expect(mockUpdateEq).toHaveBeenCalledWith('clerk_user_id', 'u');
      expect(mockUpdateIn).toHaveBeenCalledWith('league_id', ['L2025']);

      // Simulate the persisted column for the subsequent read.
      storedRecurring = 'ROOT2024';

      // (b) The exclude filter now keys on the stored root and drops the row.
      const result = await storage.getSleeperLeagues('u', 'exclude-archived');
      expect(result.map((l) => l.leagueId)).toEqual([]);
    });

    it('is a no-op when the recurring_league_id column is missing (pre-migration)', async () => {
      const mockUpdateIn = vi.fn().mockResolvedValue({
        error: { code: '42703', message: 'column sleeper_leagues.recurring_league_id does not exist' },
      });
      const mockUpdateEq = vi.fn().mockReturnValue({ in: mockUpdateIn });
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'sleeper_leagues') return { update: mockUpdate };
        return {};
      });

      // Tolerates the missing column instead of throwing (mirrors saveSleeperLeague).
      await expect(storage.persistRecurringRoot('u', ['L2025'], 'ROOT2024')).resolves.toBeUndefined();
    });
  });

  // ===========================================================================
  // deleteSleeperLeague also removes the archive row
  // ===========================================================================

  describe('deleteSleeperLeague archive cleanup', () => {
    it('unarchives the matching recurring id on a true delete', async () => {
      const mockArchiveDelete = vi.fn();

      // Single lookup: .select('league_id, season_year, recurring_league_id, sport')
      // .eq(user).eq(id).maybeSingle() returns all four columns for both the
      // default-clear and the archive cleanup.
      const sleeperMaybeSingle = vi.fn()
        .mockResolvedValue({ data: { league_id: 'L2025', season_year: 2025, recurring_league_id: 'ROOT', sport: 'football' }, error: null });
      const sleeperEq = vi.fn();
      sleeperEq.mockReturnValue({ eq: sleeperEq, maybeSingle: sleeperMaybeSingle, error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'sleeper_leagues') {
          return {
            select: vi.fn().mockReturnValue({ eq: sleeperEq }),
            delete: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ error: null }) }) }),
          };
        }
        if (table === 'user_preferences') {
          const prefEq = vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { default_football: null, default_baseball: null, default_basketball: null, default_hockey: null },
              error: null,
            }),
          });
          return { select: vi.fn().mockReturnValue({ eq: prefEq }), upsert: vi.fn().mockReturnValue({ error: null }) };
        }
        if (table === 'archived_leagues') {
          let calls = 0;
          const eq = vi.fn();
          eq.mockImplementation(() => {
            calls += 1;
            if (calls >= 4) return Promise.resolve({ error: null });
            return { eq };
          });
          return { delete: mockArchiveDelete.mockReturnValue({ eq }) };
        }
        return {};
      });

      await storage.deleteSleeperLeague('u', 'row-uuid');

      expect(mockArchiveDelete).toHaveBeenCalled();
    });
  });
});
