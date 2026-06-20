import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchiveStorage, archivedKey } from '../archive-storage';

const mockFrom = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: mockFrom,
  }),
}));

describe('ArchiveStorage', () => {
  let storage: ArchiveStorage;

  beforeEach(() => {
    storage = new ArchiveStorage('https://example.supabase.co', 'test-key');
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('archiveLeague', () => {
    it('upserts the archive row keyed on (user, platform, sport, recurring id)', async () => {
      const mockUpsert = vi.fn().mockResolvedValue({ error: null });
      mockFrom.mockReturnValue({ upsert: mockUpsert });

      const ok = await storage.archiveLeague('user_123', 'espn', 'football', 'league-9', 'Zombie League');

      expect(ok).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith('archived_leagues');
      const [payload, options] = mockUpsert.mock.calls[0];
      expect(payload).toMatchObject({
        clerk_user_id: 'user_123',
        platform: 'espn',
        sport: 'football',
        recurring_league_id: 'league-9',
        league_name: 'Zombie League',
      });
      expect(options).toEqual({ onConflict: 'clerk_user_id,platform,sport,recurring_league_id' });
    });

    it('returns false when the recurring id is missing', async () => {
      const mockUpsert = vi.fn();
      mockFrom.mockReturnValue({ upsert: mockUpsert });

      const ok = await storage.archiveLeague('user_123', 'espn', 'football', '');

      expect(ok).toBe(false);
      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('returns false on a database error', async () => {
      const mockUpsert = vi.fn().mockResolvedValue({ error: { message: 'boom' } });
      mockFrom.mockReturnValue({ upsert: mockUpsert });

      const ok = await storage.archiveLeague('user_123', 'sleeper', 'football', 'root-1');

      expect(ok).toBe(false);
    });
  });

  describe('unarchiveLeague', () => {
    it('deletes the matching archive row', async () => {
      // delete().eq(user).eq(platform).eq(sport).eq(recurring) — the final eq resolves.
      const eq = vi.fn();
      let calls = 0;
      eq.mockImplementation(() => {
        calls += 1;
        if (calls >= 4) return Promise.resolve({ error: null });
        return { eq };
      });
      const mockDelete = vi.fn().mockReturnValue({ eq });
      mockFrom.mockReturnValue({ delete: mockDelete });

      const ok = await storage.unarchiveLeague('user_123', 'espn', 'football', 'league-9');

      expect(ok).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith('archived_leagues');
      expect(mockDelete).toHaveBeenCalled();
      expect(calls).toBe(4);
    });
  });

  describe('getArchivedSet', () => {
    it('returns the set keyed by sport:recurringId for a platform', async () => {
      const eqPlatform = vi.fn().mockResolvedValue({
        data: [
          { sport: 'football', recurring_league_id: 'a' },
          { sport: 'basketball', recurring_league_id: 'b' },
        ],
        error: null,
      });
      const eqUser = vi.fn().mockReturnValue({ eq: eqPlatform });
      const select = vi.fn().mockReturnValue({ eq: eqUser });
      mockFrom.mockReturnValue({ select });

      const set = await storage.getArchivedSet('user_123', 'espn');

      expect(select).toHaveBeenCalledWith('sport, recurring_league_id');
      expect(set.has(archivedKey('football', 'a'))).toBe(true);
      expect(set.has(archivedKey('basketball', 'b'))).toBe(true);
      expect(set.size).toBe(2);
    });

    it('keys are sport-scoped so a shared recurring id across sports does not collide', async () => {
      // ESPN football `123` and ESPN basketball `123` are distinct leagues that
      // share an id space; archiving one must not over-hide the other.
      const eqPlatform = vi.fn().mockResolvedValue({
        data: [{ sport: 'football', recurring_league_id: '123' }],
        error: null,
      });
      const eqUser = vi.fn().mockReturnValue({ eq: eqPlatform });
      const select = vi.fn().mockReturnValue({ eq: eqUser });
      mockFrom.mockReturnValue({ select });

      const set = await storage.getArchivedSet('user_123', 'espn');

      expect(set.has(archivedKey('football', '123'))).toBe(true);
      expect(set.has(archivedKey('basketball', '123'))).toBe(false);
    });

    it('throws (fail-closed) on a database error', async () => {
      // Exclude-path callers let this propagate so archived leagues never leak to
      // the AI on a transient error; annotate-path callers catch it (audit #10).
      const eqPlatform = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
      const eqUser = vi.fn().mockReturnValue({ eq: eqPlatform });
      const select = vi.fn().mockReturnValue({ eq: eqUser });
      mockFrom.mockReturnValue({ select });

      await expect(storage.getArchivedSet('user_123', 'sleeper')).rejects.toThrow('Failed to get archived set');
    });
  });

  describe('listArchived', () => {
    it('maps rows into ArchivedLeague objects', async () => {
      const eqUser = vi.fn().mockResolvedValue({
        data: [
          {
            platform: 'sleeper',
            sport: 'football',
            recurring_league_id: 'root-1',
            league_name: 'Dynasty',
            archived_at: '2026-06-20T00:00:00.000Z',
          },
        ],
        error: null,
      });
      const select = vi.fn().mockReturnValue({ eq: eqUser });
      mockFrom.mockReturnValue({ select });

      const result = await storage.listArchived('user_123');

      expect(result).toEqual([
        {
          platform: 'sleeper',
          sport: 'football',
          recurringLeagueId: 'root-1',
          leagueName: 'Dynasty',
          archivedAt: '2026-06-20T00:00:00.000Z',
        },
      ]);
    });
  });
});
