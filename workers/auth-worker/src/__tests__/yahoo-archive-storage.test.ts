import { beforeEach, describe, expect, it, vi } from 'vitest';
import { YahooStorage } from '../yahoo-storage';

// Mock Supabase client — each test installs a per-table `from` implementation so
// the yahoo_leagues read, the archived_leagues read, and the user_preferences
// read/write can be controlled independently (mirrors sleeper-storage.test.ts).
const mockFrom = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: mockFrom }),
}));

describe('YahooStorage archive surface', () => {
  let storage: YahooStorage;

  beforeEach(() => {
    storage = new YahooStorage('https://example.supabase.co', 'test-key');
    vi.clearAllMocks();
  });

  // ===========================================================================
  // getYahooLeagues includeArchived filter — key is recurring_league_id ?? league_key
  // ===========================================================================

  describe('getYahooLeagues includeArchived', () => {
    // yahoo_leagues read: .select('*').eq('clerk_user_id', ...)
    function mockLeaguesRead(rows: unknown[]) {
      const eq = vi.fn().mockResolvedValue({ data: rows, error: null });
      return { select: vi.fn().mockReturnValue({ eq }) };
    }
    // archived_leagues read: .select('sport, recurring_league_id').eq(user).eq(platform)
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
        if (table === 'yahoo_leagues') {
          return mockLeaguesRead([
            { id: 'a', clerk_user_id: 'u', sport: 'football', season_year: 2025, league_key: '449.l.10', league_name: 'Zombie', team_id: null, team_key: null, team_name: null, recurring_league_id: '300.l.10' },
            { id: 'b', clerk_user_id: 'u', sport: 'football', season_year: 2025, league_key: '449.l.20', league_name: 'Keep', team_id: null, team_key: null, team_name: null, recurring_league_id: '300.l.20' },
          ]);
        }
        if (table === 'archived_leagues') return mockArchiveRead(['300.l.10']);
        return {};
      });

      const result = await storage.getYahooLeagues('u', 'exclude-archived');
      expect(result.map((l) => l.leagueKey)).toEqual(['449.l.20']);
    });

    it('falls back to league_key when recurring_league_id is null (null-recurring fallback)', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'yahoo_leagues') {
          return mockLeaguesRead([
            { id: 'a', clerk_user_id: 'u', sport: 'football', season_year: 2025, league_key: '449.l.10', league_name: 'Zombie', team_id: null, team_key: null, team_name: null, recurring_league_id: null },
            { id: 'b', clerk_user_id: 'u', sport: 'football', season_year: 2025, league_key: '449.l.20', league_name: 'Keep', team_id: null, team_key: null, team_name: null, recurring_league_id: null },
          ]);
        }
        // Archived on the season-scoped fallback key 449.l.10
        if (table === 'archived_leagues') return mockArchiveRead(['449.l.10']);
        return {};
      });

      const result = await storage.getYahooLeagues('u', 'exclude-archived');
      expect(result.map((l) => l.leagueKey)).toEqual(['449.l.20']);
    });

    it('does NOT over-hide the same recurring id in a different sport (cross-sport no-collision)', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'yahoo_leagues') {
          return mockLeaguesRead([
            { id: 'a', clerk_user_id: 'u', sport: 'football', season_year: 2025, league_key: '449.l.10', league_name: 'FB', team_id: null, team_key: null, team_name: null, recurring_league_id: 'ROOT' },
            { id: 'b', clerk_user_id: 'u', sport: 'basketball', season_year: 2025, league_key: '454.l.10', league_name: 'BB', team_id: null, team_key: null, team_name: null, recurring_league_id: 'ROOT' },
          ]);
        }
        if (table === 'archived_leagues') return mockArchiveRead([['football', 'ROOT']]);
        return {};
      });

      const result = await storage.getYahooLeagues('u', 'exclude-archived');
      expect(result.map((l) => ({ leagueKey: l.leagueKey, sport: l.sport }))).toEqual([
        { leagueKey: '454.l.10', sport: 'basketball' },
      ]);
    });

    it('fails CLOSED: propagates a thrown archive-set error on the exclude path', async () => {
      function mockArchiveError() {
        const eqPlatform = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
        const eqUser = vi.fn().mockReturnValue({ eq: eqPlatform });
        return { select: vi.fn().mockReturnValue({ eq: eqUser }) };
      }
      mockFrom.mockImplementation((table: string) => {
        if (table === 'yahoo_leagues') {
          return mockLeaguesRead([
            { id: 'a', clerk_user_id: 'u', sport: 'football', season_year: 2025, league_key: '449.l.10', league_name: 'Zombie', team_id: null, team_key: null, team_name: null, recurring_league_id: 'ROOT' },
          ]);
        }
        if (table === 'archived_leagues') return mockArchiveError();
        return {};
      });

      await expect(storage.getYahooLeagues('u', 'exclude-archived')).rejects.toThrow('Failed to get archived map');
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

    function threeRows() {
      return [
        { id: 'a', clerk_user_id: 'u', sport: 'football', season_year: 2025, league_key: '449.l.10', league_name: 'Active', team_id: null, team_key: null, team_name: null, recurring_league_id: 'ACTROOT' },
        { id: 'b', clerk_user_id: 'u', sport: 'football', season_year: 2025, league_key: '449.l.20', league_name: 'Historical', team_id: null, team_key: null, team_name: null, recurring_league_id: 'HISTROOT' },
        { id: 'c', clerk_user_id: 'u', sport: 'football', season_year: 2025, league_key: '449.l.30', league_name: 'Hidden', team_id: null, team_key: null, team_name: null, recurring_league_id: 'HIDROOT' },
      ];
    }

    it('exclude-hidden keeps a historical row, drops a hidden one, and keeps non-archived', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'yahoo_leagues') return mockLeaguesRead(threeRows());
        if (table === 'archived_leagues') return mockArchiveReadModes([
          ['football', 'HISTROOT', 'historical'],
          ['football', 'HIDROOT', 'hidden'],
        ]);
        return {};
      });

      const result = await storage.getYahooLeagues('u', 'exclude-hidden');
      expect(result.map((l) => l.leagueKey)).toEqual(['449.l.10', '449.l.20']);
    });

    it('exclude-archived drops BOTH historical and hidden rows', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'yahoo_leagues') return mockLeaguesRead(threeRows());
        if (table === 'archived_leagues') return mockArchiveReadModes([
          ['football', 'HISTROOT', 'historical'],
          ['football', 'HIDROOT', 'hidden'],
        ]);
        return {};
      });

      const result = await storage.getYahooLeagues('u', 'exclude-archived');
      expect(result.map((l) => l.leagueKey)).toEqual(['449.l.10']);
    });

    it('include-all returns everything regardless of mode', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'yahoo_leagues') return mockLeaguesRead(threeRows());
        if (table === 'archived_leagues') return mockArchiveReadModes([
          ['football', 'HISTROOT', 'historical'],
          ['football', 'HIDROOT', 'hidden'],
        ]);
        return {};
      });

      const result = await storage.getYahooLeagues('u', 'include-all');
      expect(result.map((l) => l.leagueKey)).toEqual(['449.l.10', '449.l.20', '449.l.30']);
    });

    it('returns all rows and skips the archive read when includeArchived is true', async () => {
      const archiveSelect = vi.fn();
      mockFrom.mockImplementation((table: string) => {
        if (table === 'yahoo_leagues') {
          return mockLeaguesRead([
            { id: 'a', clerk_user_id: 'u', sport: 'football', season_year: 2025, league_key: '449.l.10', league_name: 'Zombie', team_id: null, team_key: null, team_name: null, recurring_league_id: 'ROOT' },
          ]);
        }
        if (table === 'archived_leagues') return { select: archiveSelect };
        return {};
      });

      const result = await storage.getYahooLeagues('u');
      expect(result.map((l) => l.leagueKey)).toEqual(['449.l.10']);
      expect(archiveSelect).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // upsertYahooLeague — recurring_league_id write + missing-column tolerance
  // ===========================================================================

  describe('upsertYahooLeague recurring_league_id', () => {
    function mockUpsertChain(impl: () => { data: unknown; error: unknown }) {
      const single = vi.fn().mockImplementation(async () => impl());
      const select = vi.fn().mockReturnValue({ single });
      const upsert = vi.fn().mockReturnValue({ select });
      return { upsert, select, single };
    }

    it('persists recurring_league_id when the column is available', async () => {
      const chain = mockUpsertChain(() => ({ data: { id: 'row-1' }, error: null }));
      mockFrom.mockReturnValue(chain);

      const id = await storage.upsertYahooLeague({
        clerkUserId: 'u', sport: 'football', seasonYear: 2025,
        leagueKey: '449.l.10', leagueName: 'Zombie', recurringLeagueId: '300.l.10',
      });

      expect(id).toBe('row-1');
      expect(chain.upsert).toHaveBeenCalledOnce();
      expect(chain.upsert.mock.calls[0][0]).toMatchObject({
        league_key: '449.l.10',
        recurring_league_id: '300.l.10',
      });
    });

    it('retries without recurring_league_id when the column is unavailable', async () => {
      let call = 0;
      const single = vi.fn().mockImplementation(async () => {
        call += 1;
        if (call === 1) {
          return { data: null, error: { code: '42703', message: 'column yahoo_leagues.recurring_league_id does not exist' } };
        }
        return { data: { id: 'row-1' }, error: null };
      });
      const select = vi.fn().mockReturnValue({ single });
      const upsert = vi.fn().mockReturnValue({ select });
      mockFrom.mockReturnValue({ upsert });

      const id = await storage.upsertYahooLeague({
        clerkUserId: 'u', sport: 'football', seasonYear: 2025,
        leagueKey: '449.l.10', leagueName: 'Zombie', recurringLeagueId: '300.l.10',
      });

      expect(id).toBe('row-1');
      expect(upsert).toHaveBeenCalledTimes(2);
      expect(upsert.mock.calls[0][0]).toHaveProperty('recurring_league_id', '300.l.10');
      expect(upsert.mock.calls[1][0]).not.toHaveProperty('recurring_league_id');

      // Subsequent writes skip the recurring_league_id attempt entirely.
      upsert.mockClear();
      await storage.upsertYahooLeague({
        clerkUserId: 'u', sport: 'football', seasonYear: 2024,
        leagueKey: '423.l.10', leagueName: 'Zombie', recurringLeagueId: '300.l.10',
      });
      expect(upsert).toHaveBeenCalledOnce();
      expect(upsert.mock.calls[0][0]).not.toHaveProperty('recurring_league_id');
    });

    it('does not treat unrelated errors as a missing column', async () => {
      const single = vi.fn().mockResolvedValue({
        data: null, error: { code: '42501', message: 'permission denied' },
      });
      const select = vi.fn().mockReturnValue({ single });
      const upsert = vi.fn().mockReturnValue({ select });
      mockFrom.mockReturnValue({ upsert });

      await expect(
        storage.upsertYahooLeague({
          clerkUserId: 'u', sport: 'football', seasonYear: 2025,
          leagueKey: '449.l.10', leagueName: 'Zombie', recurringLeagueId: '300.l.10',
        })
      ).rejects.toThrow('Failed to upsert Yahoo league');
      expect(upsert).toHaveBeenCalledOnce();
    });
  });

  // ===========================================================================
  // persistYahooRecurringRoot — write root + missing-column tolerance
  // ===========================================================================

  describe('persistYahooRecurringRoot', () => {
    it('writes the resolved root onto the group rows keyed by league_key', async () => {
      const inFn = vi.fn().mockResolvedValue({ error: null });
      const eq = vi.fn().mockReturnValue({ in: inFn });
      const update = vi.fn().mockReturnValue({ eq });
      mockFrom.mockReturnValue({ update });

      await storage.persistYahooRecurringRoot('u', ['449.l.10', '423.l.10'], '300.l.10');

      expect(update).toHaveBeenCalledOnce();
      expect(update.mock.calls[0][0]).toMatchObject({ recurring_league_id: '300.l.10' });
      expect(eq).toHaveBeenCalledWith('clerk_user_id', 'u');
      expect(inFn).toHaveBeenCalledWith('league_key', ['449.l.10', '423.l.10']);
    });

    it('is a no-op when the recurring_league_id column is missing (pre-migration)', async () => {
      const inFn = vi.fn().mockResolvedValue({
        error: { code: '42703', message: 'column yahoo_leagues.recurring_league_id does not exist' },
      });
      const eq = vi.fn().mockReturnValue({ in: inFn });
      const update = vi.fn().mockReturnValue({ eq });
      mockFrom.mockReturnValue({ update });

      await expect(
        storage.persistYahooRecurringRoot('u', ['449.l.10'], '300.l.10')
      ).resolves.toBeUndefined();
    });
  });

  // ===========================================================================
  // deleteYahooLeague — D8 archive cleanup + default-clear (per-season league_key)
  // ===========================================================================

  describe('deleteYahooLeague archive cleanup', () => {
    it('unarchives the matching (yahoo, sport, recurringId) on a true delete', async () => {
      const mockArchiveDelete = vi.fn();
      // Single yahoo_leagues lookup returns league_key/season_year/recurring/sport.
      const yahooMaybeSingle = vi.fn().mockResolvedValue({
        data: { league_key: '449.l.10', season_year: 2025, recurring_league_id: '300.l.10', sport: 'baseball' },
        error: null,
      });
      const yahooEq = vi.fn();
      yahooEq.mockReturnValue({ eq: yahooEq, maybeSingle: yahooMaybeSingle, error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'yahoo_leagues') {
          return {
            select: vi.fn().mockReturnValue({ eq: yahooEq }),
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

      await storage.deleteYahooLeague('u', 'row-uuid');

      expect(mockArchiveDelete).toHaveBeenCalled();
      const eqMock = mockArchiveDelete.mock.results[0].value.eq;
      const eqArgs = eqMock.mock.calls.map((c: unknown[]) => c as [string, string]);
      expect(eqArgs).toContainEqual(['clerk_user_id', 'u']);
      expect(eqArgs).toContainEqual(['platform', 'yahoo']);
      expect(eqArgs).toContainEqual(['sport', 'baseball']);
      expect(eqArgs).toContainEqual(['recurring_league_id', '300.l.10']);
    });

    it('falls back to league_key for the archive key when recurring_league_id is null', async () => {
      const mockArchiveDelete = vi.fn();
      const yahooMaybeSingle = vi.fn().mockResolvedValue({
        data: { league_key: '449.l.10', season_year: 2025, recurring_league_id: null, sport: 'football' },
        error: null,
      });
      const yahooEq = vi.fn();
      yahooEq.mockReturnValue({ eq: yahooEq, maybeSingle: yahooMaybeSingle, error: null });

      mockFrom.mockImplementation((table: string) => {
        if (table === 'yahoo_leagues') {
          return {
            select: vi.fn().mockReturnValue({ eq: yahooEq }),
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

      await storage.deleteYahooLeague('u', 'row-uuid');

      const eqMock = mockArchiveDelete.mock.results[0].value.eq;
      const eqArgs = eqMock.mock.calls.map((c: unknown[]) => c as [string, string]);
      expect(eqArgs).toContainEqual(['recurring_league_id', '449.l.10']);
    });
  });
});
