import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EspnSupabaseStorage } from '../supabase-storage';

const mockFrom = vi.fn();
const mockDelete = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockMaybeSingle = vi.fn();
const mockUpsert = vi.fn();

function makeMaybeSingleChain(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn();
  const chain = { eq, maybeSingle };
  eq.mockReturnValue(chain);
  return chain;
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: mockFrom,
  }),
}));

describe('EspnSupabaseStorage', () => {
  let storage: EspnSupabaseStorage;

  beforeEach(() => {
    storage = new EspnSupabaseStorage({
      supabaseUrl: 'https://example.supabase.co',
      supabaseKey: 'test-key',
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removeLeague clears only the deleted sport default when league ids collide across sports', async () => {
    const mockPrefsUpsert = vi.fn().mockReturnValue({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'espn_leagues') {
        const eqFn = vi.fn();
        const selectFn = vi.fn().mockResolvedValue({
          data: [{ id: 'row-1', league_id: '123', sport: 'football', season_year: 2025 }],
          error: null,
        });
        eqFn.mockReturnValue({ eq: eqFn, select: selectFn });
        return { delete: mockDelete.mockReturnValue({ eq: eqFn }) };
      }

      if (table === 'user_preferences') {
        const prefEq = vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              default_football: { platform: 'espn', leagueId: '123', seasonYear: 2025 },
              default_baseball: { platform: 'espn', leagueId: '123', seasonYear: 2026 },
              default_basketball: null,
              default_hockey: null,
            },
            error: null,
          }),
        });
        return {
          select: mockSelect.mockReturnValue({ eq: prefEq }),
          upsert: mockPrefsUpsert,
        };
      }

      return {};
    });

    const result = await storage.removeLeague('user_123', '123', 'football');

    expect(result).toBe(true);
    expect(mockPrefsUpsert).toHaveBeenCalledOnce();
    const upsertArg = mockPrefsUpsert.mock.calls[0][0];
    expect(upsertArg.default_football).toBeNull();
    expect(upsertArg).not.toHaveProperty('default_baseball');
  });

  it('setDefaultLeague returns not found when Yahoo league validation misses', async () => {
    const mockPrefsUpsert = vi.fn();

    mockFrom.mockImplementation((table: string) => {
      if (table === 'yahoo_leagues') {
        return {
          select: vi.fn().mockReturnValue(makeMaybeSingleChain({ data: null, error: null })),
        };
      }

      if (table === 'user_preferences') {
        return {
          upsert: mockPrefsUpsert,
        };
      }

      return {};
    });

    const result = await storage.setDefaultLeague('user_123', 'yahoo', 'football', 'nfl.l.123', 2025);

    expect(result).toEqual({ success: false, error: 'League not found' });
    expect(mockPrefsUpsert).not.toHaveBeenCalled();
  });

  it('setDefaultLeague returns not found when Sleeper league validation misses', async () => {
    const mockPrefsUpsert = vi.fn();

    mockFrom.mockImplementation((table: string) => {
      if (table === 'sleeper_leagues') {
        return {
          select: vi.fn().mockReturnValue(makeMaybeSingleChain({ data: null, error: null })),
        };
      }

      if (table === 'user_preferences') {
        return {
          upsert: mockPrefsUpsert,
        };
      }

      return {};
    });

    const result = await storage.setDefaultLeague('user_123', 'sleeper', 'football', 'league-123', 2025);

    expect(result).toEqual({ success: false, error: 'League not found' });
    expect(mockPrefsUpsert).not.toHaveBeenCalled();
  });

  // ===========================================================================
  // includeArchived filter (ESPN)
  // ===========================================================================

  it('getLeagues excludes archived rows when includeArchived is false', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'espn_leagues') {
        // .select(...).eq('clerk_user_id', ...) resolves with all rows
        const eq = vi.fn().mockResolvedValue({
          data: [
            { league_id: '111', sport: 'football', team_id: 't1', team_name: 'A', league_name: 'Keep', season_year: 2025 },
            { league_id: '222', sport: 'football', team_id: 't2', team_name: 'B', league_name: 'Zombie', season_year: 2025 },
          ],
          error: null,
        });
        return { select: vi.fn().mockReturnValue({ eq }) };
      }
      if (table === 'archived_leagues') {
        // .select('sport, recurring_league_id').eq(user).eq(platform) resolves with archived rows
        const eqPlatform = vi.fn().mockResolvedValue({ data: [{ sport: 'football', recurring_league_id: '222' }], error: null });
        const eqUser = vi.fn().mockReturnValue({ eq: eqPlatform });
        return { select: vi.fn().mockReturnValue({ eq: eqUser }) };
      }
      return {};
    });

    const filtered = await storage.getLeagues('user_123', false);
    expect(filtered.map(l => l.leagueId)).toEqual(['111']);
  });

  it('getLeagues does NOT over-hide a same-id league in a different sport (cross-sport no-collision)', async () => {
    // Archive ESPN football `123`; ESPN basketball `123` is a distinct league that
    // shares the id space and must remain visible.
    mockFrom.mockImplementation((table: string) => {
      if (table === 'espn_leagues') {
        const eq = vi.fn().mockResolvedValue({
          data: [
            { league_id: '123', sport: 'football', team_id: 't1', team_name: 'A', league_name: 'FB Zombie', season_year: 2025 },
            { league_id: '123', sport: 'basketball', team_id: 't2', team_name: 'B', league_name: 'BB Keep', season_year: 2025 },
          ],
          error: null,
        });
        return { select: vi.fn().mockReturnValue({ eq }) };
      }
      if (table === 'archived_leagues') {
        const eqPlatform = vi.fn().mockResolvedValue({ data: [{ sport: 'football', recurring_league_id: '123' }], error: null });
        const eqUser = vi.fn().mockReturnValue({ eq: eqPlatform });
        return { select: vi.fn().mockReturnValue({ eq: eqUser }) };
      }
      return {};
    });

    const filtered = await storage.getLeagues('user_123', false);
    // Only the football `123` is hidden; the basketball `123` survives.
    expect(filtered.map(l => ({ leagueId: l.leagueId, sport: l.sport }))).toEqual([
      { leagueId: '123', sport: 'basketball' },
    ]);
  });

  it('getLeagues fails CLOSED: propagates a thrown archive-set error on the exclude path (audit #10)', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'espn_leagues') {
        const eq = vi.fn().mockResolvedValue({
          data: [
            { league_id: '111', sport: 'football', team_id: 't1', team_name: 'A', league_name: 'Keep', season_year: 2025 },
          ],
          error: null,
        });
        return { select: vi.fn().mockReturnValue({ eq }) };
      }
      if (table === 'archived_leagues') {
        // archive read errors → getArchivedSet throws → getLeagues(false) propagates
        const eqPlatform = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
        const eqUser = vi.fn().mockReturnValue({ eq: eqPlatform });
        return { select: vi.fn().mockReturnValue({ eq: eqUser }) };
      }
      return {};
    });

    await expect(storage.getLeagues('user_123', false)).rejects.toThrow('Failed to get archived set');
  });

  it('setDefaultLeague fails OPEN on an archive-set error — allows the default (audit #10)', async () => {
    const mockPrefsUpsert = vi.fn().mockReturnValue({ error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'espn_leagues') {
        const single = vi.fn().mockResolvedValue({ data: { league_id: '222', team_id: 't2' }, error: null });
        const eq = vi.fn();
        eq.mockReturnValue({ eq, single });
        return { select: vi.fn().mockReturnValue({ eq }) };
      }
      if (table === 'archived_leagues') {
        // Archive lookup errors — fail-open treats nothing as archived.
        const eqPlatform = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
        const eqUser = vi.fn().mockReturnValue({ eq: eqPlatform });
        return { select: vi.fn().mockReturnValue({ eq: eqUser }) };
      }
      if (table === 'user_preferences') {
        return { upsert: mockPrefsUpsert };
      }
      return {};
    });

    const result = await storage.setDefaultLeague('user_123', 'espn', 'football', '222', 2025);

    expect(result).toEqual({ success: true });
    expect(mockPrefsUpsert).toHaveBeenCalledOnce();
  });

  it('getLeagues returns all rows when includeArchived defaults to true', async () => {
    const archivedSelect = vi.fn();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'espn_leagues') {
        const eq = vi.fn().mockResolvedValue({
          data: [
            { league_id: '111', sport: 'football', team_id: 't1', team_name: 'A', league_name: 'Keep', season_year: 2025 },
            { league_id: '222', sport: 'football', team_id: 't2', team_name: 'B', league_name: 'Zombie', season_year: 2025 },
          ],
          error: null,
        });
        return { select: vi.fn().mockReturnValue({ eq }) };
      }
      if (table === 'archived_leagues') {
        return { select: archivedSelect };
      }
      return {};
    });

    const all = await storage.getLeagues('user_123');
    expect(all.map(l => l.leagueId)).toEqual(['111', '222']);
    // Archive set must NOT be consulted on the default (unfiltered) path.
    expect(archivedSelect).not.toHaveBeenCalled();
  });

  // ===========================================================================
  // setDefaultLeague rejects an archived league (§9)
  // ===========================================================================

  it('setDefaultLeague rejects an archived ESPN league', async () => {
    const mockPrefsUpsert = vi.fn();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'espn_leagues') {
        const single = vi.fn().mockResolvedValue({ data: { league_id: '222', team_id: 't2' }, error: null });
        const eq = vi.fn();
        eq.mockReturnValue({ eq, single });
        return { select: vi.fn().mockReturnValue({ eq }) };
      }
      if (table === 'archived_leagues') {
        const eqPlatform = vi.fn().mockResolvedValue({ data: [{ sport: 'football', recurring_league_id: '222' }], error: null });
        const eqUser = vi.fn().mockReturnValue({ eq: eqPlatform });
        return { select: vi.fn().mockReturnValue({ eq: eqUser }) };
      }
      if (table === 'user_preferences') {
        return { upsert: mockPrefsUpsert };
      }
      return {};
    });

    const result = await storage.setDefaultLeague('user_123', 'espn', 'football', '222', 2025);

    expect(result).toEqual({ success: false, error: 'Cannot set default: league is archived' });
    expect(mockPrefsUpsert).not.toHaveBeenCalled();
  });

  // ===========================================================================
  // removeLeague also deletes the matching archive row (D8)
  // ===========================================================================

  it('removeLeague deletes the matching archived_leagues row', async () => {
    const mockArchiveDelete = vi.fn();
    mockFrom.mockImplementation((table: string) => {
      if (table === 'espn_leagues') {
        const selectFn = vi.fn().mockResolvedValue({
          data: [{ id: 'row-1', league_id: '222', sport: 'football', season_year: 2025 }],
          error: null,
        });
        const eqFn = vi.fn();
        eqFn.mockReturnValue({ eq: eqFn, select: selectFn });
        return { delete: vi.fn().mockReturnValue({ eq: eqFn }) };
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
        // delete().eq(user).eq(platform).eq(sport).eq(recurring) — final eq resolves.
        // Record every (column, value) so we can assert the actual archive key.
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

    const result = await storage.removeLeague('user_123', '222', 'football');

    expect(result).toBe(true);
    expect(mockArchiveDelete).toHaveBeenCalled();
    // Assert the archive delete was keyed on the correct (platform, sport, leagueId),
    // not just that it ran — a wrong sport/id would otherwise pass.
    const eqMock = mockArchiveDelete.mock.results[0].value.eq;
    const eqArgs = eqMock.mock.calls.map((c: unknown[]) => c as [string, string]);
    expect(eqArgs).toContainEqual(['clerk_user_id', 'user_123']);
    expect(eqArgs).toContainEqual(['platform', 'espn']);
    expect(eqArgs).toContainEqual(['sport', 'football']);
    expect(eqArgs).toContainEqual(['recurring_league_id', '222']);
  });
});
