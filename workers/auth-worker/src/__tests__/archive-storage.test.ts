import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArchiveStorage, archivedKey } from '../archive-storage';

const mockFrom = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: mockFrom,
  }),
}));

/**
 * Flatten everything handed to a console spy into one searchable string.
 *
 * JSON.stringify (not String()) so a hybrid regression that logs the safe
 * substitute but also appends the raw error object as a second console.error
 * argument still surfaces that object's fields here, instead of collapsing to
 * the useless "[object Object]" (FLA-368 audit finding). Error instances get
 * the same treatment via their own branch: Error.message/.stack are
 * non-enumerable, so JSON.stringify(someError) is "{}" and would silently
 * re-open the exact same vacuous-assertion gap for the Error case (FLA-370
 * audit finding) — string-concatenate the message/stack instead.
 */
function loggedFrom(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls
    .flat()
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message} ${arg.stack ?? ''}`;
      return JSON.stringify(arg);
    })
    .join(' ');
}

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

    it('defaults the upsert mode to historical when not specified', async () => {
      const mockUpsert = vi.fn().mockResolvedValue({ error: null });
      mockFrom.mockReturnValue({ upsert: mockUpsert });

      await storage.archiveLeague('user_123', 'espn', 'football', 'league-9', 'Zombie League');

      expect(mockUpsert.mock.calls[0][0]).toMatchObject({ mode: 'historical' });
    });

    it('writes the given mode into the upsert payload', async () => {
      const mockUpsert = vi.fn().mockResolvedValue({ error: null });
      mockFrom.mockReturnValue({ upsert: mockUpsert });

      const ok = await storage.archiveLeague('user_123', 'espn', 'football', 'league-9', 'Zombie League', 'hidden');

      expect(ok).toBe(true);
      expect(mockUpsert.mock.calls[0][0]).toMatchObject({
        recurring_league_id: 'league-9',
        mode: 'hidden',
      });
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

    it('logs the error code only, never the raw driver error naming the league (FLA-370)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      // A 23505 on this table's unique constraint quotes the whole archive key,
      // and a 23514 check violation's DETAIL is "Failing row contains (...)" —
      // which includes league_name.
      const mockUpsert = vi.fn().mockResolvedValue({
        error: {
          code: '23505',
          message: 'duplicate key value violates unique constraint "archived_leagues_unique"',
          details:
            'Key (clerk_user_id, platform, sport, recurring_league_id)=(user_leak_sentinel, espn, football, recurring-sentinel-8c2d) already exists.',
          hint: 'Failing row contains (..., league-name-sentinel-Private Dynasty, ...)',
        },
      });
      mockFrom.mockReturnValue({ upsert: mockUpsert });

      const ok = await storage.archiveLeague(
        'user_leak_sentinel',
        'espn',
        'football',
        'recurring-sentinel-8c2d',
        'league-name-sentinel-Private Dynasty'
      );

      expect(ok).toBe(false);
      const logged = loggedFrom(errorSpy);
      expect(logged).toContain('code=23505');
      expect(logged).toContain('user_lea...');
      expect(logged).not.toContain('user_leak_sentinel');
      expect(logged).not.toContain('recurring-sentinel-8c2d');
      expect(logged).not.toContain('league-name-sentinel');
      expect(logged).not.toContain('duplicate key');
    });

    it('logs the thrown error name only when the client itself throws (FLA-370)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockFrom.mockImplementation(() => {
        throw new TypeError('client blew up on recurring-sentinel-8c2d');
      });

      const ok = await storage.archiveLeague(
        'user_leak_sentinel',
        'espn',
        'football',
        'recurring-sentinel-8c2d',
        'league-name-sentinel-Private Dynasty'
      );

      expect(ok).toBe(false);
      const logged = loggedFrom(errorSpy);
      expect(logged).toContain('TypeError');
      expect(logged).toContain('user_lea...');
      expect(logged).not.toContain('user_leak_sentinel');
      expect(logged).not.toContain('recurring-sentinel-8c2d');
      expect(logged).not.toContain('league-name-sentinel');
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

    it('logs the error code only, never the raw driver error echoing the filter (FLA-370)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      // postgrest-js appends `eq.${value}` verbatim, so a value carrying PostgREST
      // grammar characters produces a PGRST100 whose message echoes the filter.
      const eq = vi.fn();
      let calls = 0;
      eq.mockImplementation(() => {
        calls += 1;
        if (calls >= 4) {
          return Promise.resolve({
            error: {
              code: 'PGRST100',
              message: 'unexpected "(" expecting operator (eq, gt, ...)',
              details: 'failed to parse filter (eq.recurring-sentinel-8c2d)',
              hint: null,
            },
          });
        }
        return { eq };
      });
      mockFrom.mockReturnValue({ delete: vi.fn().mockReturnValue({ eq }) });

      const ok = await storage.unarchiveLeague(
        'user_leak_sentinel',
        'espn',
        'football',
        'recurring-sentinel-8c2d'
      );

      expect(ok).toBe(false);
      const logged = loggedFrom(errorSpy);
      expect(logged).toContain('code=PGRST100');
      expect(logged).toContain('user_lea...');
      expect(logged).not.toContain('user_leak_sentinel');
      expect(logged).not.toContain('recurring-sentinel-8c2d');
      expect(logged).not.toContain('failed to parse filter');
    });

    it('logs the thrown error name only when the client itself throws (FLA-370)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockFrom.mockImplementation(() => {
        throw new TypeError('client blew up on recurring-sentinel-8c2d');
      });

      const ok = await storage.unarchiveLeague(
        'user_leak_sentinel',
        'espn',
        'football',
        'recurring-sentinel-8c2d'
      );

      expect(ok).toBe(false);
      const logged = loggedFrom(errorSpy);
      expect(logged).toContain('TypeError');
      expect(logged).toContain('user_lea...');
      expect(logged).not.toContain('user_leak_sentinel');
      expect(logged).not.toContain('recurring-sentinel-8c2d');
    });
  });

  describe('getArchivedSet', () => {
    it('returns the set keyed by sport:recurringId for a platform', async () => {
      const eqPlatform = vi.fn().mockResolvedValue({
        data: [
          { sport: 'football', recurring_league_id: 'a', mode: 'historical' },
          { sport: 'basketball', recurring_league_id: 'b', mode: 'hidden' },
        ],
        error: null,
      });
      const eqUser = vi.fn().mockReturnValue({ eq: eqPlatform });
      const select = vi.fn().mockReturnValue({ eq: eqUser });
      mockFrom.mockReturnValue({ select });

      const set = await storage.getArchivedSet('user_123', 'espn');

      // getArchivedSet now delegates to getArchivedMap, which selects the mode column too.
      expect(select).toHaveBeenCalledWith('sport, recurring_league_id, mode');
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
      // the AI on a transient error; annotate-path callers catch it.
      const eqPlatform = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
      const eqUser = vi.fn().mockReturnValue({ eq: eqPlatform });
      const select = vi.fn().mockReturnValue({ eq: eqUser });
      mockFrom.mockReturnValue({ select });

      await expect(storage.getArchivedSet('user_123', 'sleeper')).rejects.toThrow('Failed to get archived map');
    });
  });

  describe('getArchivedMap', () => {
    it('returns a mode-tagged map keyed by sport:recurringId', async () => {
      const eqPlatform = vi.fn().mockResolvedValue({
        data: [
          { sport: 'football', recurring_league_id: 'a', mode: 'historical' },
          { sport: 'basketball', recurring_league_id: 'b', mode: 'hidden' },
        ],
        error: null,
      });
      const eqUser = vi.fn().mockReturnValue({ eq: eqPlatform });
      const select = vi.fn().mockReturnValue({ eq: eqUser });
      mockFrom.mockReturnValue({ select });

      const map = await storage.getArchivedMap('user_123', 'espn');

      expect(select).toHaveBeenCalledWith('sport, recurring_league_id, mode');
      expect(map.get(archivedKey('football', 'a'))).toBe('historical');
      expect(map.get(archivedKey('basketball', 'b'))).toBe('hidden');
      expect(map.size).toBe(2);
    });

    it('falls back to a mode-less select and treats all rows as hidden when the mode column is missing', async () => {
      // First select (with mode) errors with Postgres undefined_column (42703); the
      // code retries without the mode column and tags every legacy row as 'hidden'.
      const eqPlatformWithMode = vi.fn().mockResolvedValue({
        data: null,
        error: { code: '42703', message: 'column archived_leagues.mode does not exist' },
      });
      const eqPlatformLegacy = vi.fn().mockResolvedValue({
        data: [
          { sport: 'football', recurring_league_id: 'a' },
          { sport: 'basketball', recurring_league_id: 'b' },
        ],
        error: null,
      });
      let call = 0;
      const select = vi.fn().mockImplementation((columns: string) => {
        call += 1;
        const eqPlatform = columns.includes('mode') ? eqPlatformWithMode : eqPlatformLegacy;
        const eqUser = vi.fn().mockReturnValue({ eq: eqPlatform });
        return { eq: eqUser };
      });
      mockFrom.mockReturnValue({ select });

      const map = await storage.getArchivedMap('user_123', 'espn');

      expect(call).toBe(2);
      expect(select).toHaveBeenNthCalledWith(1, 'sport, recurring_league_id, mode');
      expect(select).toHaveBeenNthCalledWith(2, 'sport, recurring_league_id');
      expect(map.get(archivedKey('football', 'a'))).toBe('hidden');
      expect(map.get(archivedKey('basketball', 'b'))).toBe('hidden');
      expect(map.size).toBe(2);
    });

    it('logs the code only and throws a static message, never the raw Postgres message (FLA-370)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      // A malformed 200 body makes postgrest-js resolve a JSON.parse SyntaxError
      // whose message quotes a prefix of that body — this table's own rows.
      const eqPlatform = vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: '',
          message:
            'SyntaxError: Unexpected token < in JSON at position 0 — [{"league_name":"league-name-sentinel-Private Dynasty"',
          details: 'at eq.user_leak_sentinel',
          hint: null,
        },
      });
      const eqUser = vi.fn().mockReturnValue({ eq: eqPlatform });
      const select = vi.fn().mockReturnValue({ eq: eqUser });
      mockFrom.mockReturnValue({ select });

      // The thrown message is now static: no raw `.message` suffix at all.
      await expect(storage.getArchivedMap('user_leak_sentinel', 'espn')).rejects.toThrow(
        /^Failed to get archived map$/
      );

      const logged = loggedFrom(errorSpy);
      expect(logged).toContain('code=unknown');
      expect(logged).toContain('user_lea...');
      expect(logged).not.toContain('user_leak_sentinel');
      expect(logged).not.toContain('league-name-sentinel');
      expect(logged).not.toContain('SyntaxError');
    });

    it('redacts the legacy mode-less fallback failure the same way (FLA-370)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const eqPlatformWithMode = vi.fn().mockResolvedValue({
        data: null,
        error: { code: '42703', message: 'column archived_leagues.mode does not exist' },
      });
      const eqPlatformLegacy = vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: 'PGRST100',
          message: 'failed to parse filter (eq.user_leak_sentinel)',
          details: 'row league-name-sentinel-Private Dynasty is invalid',
          hint: null,
        },
      });
      const select = vi.fn().mockImplementation((columns: string) => {
        const eqPlatform = columns.includes('mode') ? eqPlatformWithMode : eqPlatformLegacy;
        return { eq: vi.fn().mockReturnValue({ eq: eqPlatform }) };
      });
      mockFrom.mockReturnValue({ select });

      await expect(storage.getArchivedMap('user_leak_sentinel', 'espn')).rejects.toThrow(
        /^Failed to get archived map$/
      );

      const logged = loggedFrom(errorSpy);
      expect(logged).toContain('code=PGRST100');
      expect(logged).toContain('user_lea...');
      expect(logged).not.toContain('user_leak_sentinel');
      expect(logged).not.toContain('league-name-sentinel');
      expect(logged).not.toContain('failed to parse filter');
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
          // Row has no `mode` (pre-migration); normalizeArchiveMode maps missing → 'hidden'.
          mode: 'hidden',
        },
      ]);
    });

    it('maps an explicit historical mode through to the ArchivedLeague', async () => {
      const eqUser = vi.fn().mockResolvedValue({
        data: [
          {
            platform: 'espn',
            sport: 'football',
            recurring_league_id: '123',
            league_name: 'Keepers',
            archived_at: '2026-06-20T00:00:00.000Z',
            mode: 'historical',
          },
        ],
        error: null,
      });
      const select = vi.fn().mockReturnValue({ eq: eqUser });
      mockFrom.mockReturnValue({ select });

      const result = await storage.listArchived('user_123');

      expect(result[0].mode).toBe('historical');
    });

    it('logs the error code only, never the raw driver error (FLA-370)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const eqUser = vi.fn().mockResolvedValue({
        data: null,
        error: {
          code: 'PGRST100',
          message: 'failed to parse filter (eq.user_leak_sentinel)',
          details:
            'partial body: [{"recurring_league_id":"recurring-sentinel-8c2d","league_name":"league-name-sentinel-Private Dynasty"',
          hint: null,
        },
      });
      const select = vi.fn().mockReturnValue({ eq: eqUser });
      mockFrom.mockReturnValue({ select });

      const result = await storage.listArchived('user_leak_sentinel');

      expect(result).toEqual([]);
      const logged = loggedFrom(errorSpy);
      expect(logged).toContain('code=PGRST100');
      expect(logged).toContain('user_lea...');
      expect(logged).not.toContain('user_leak_sentinel');
      expect(logged).not.toContain('recurring-sentinel-8c2d');
      expect(logged).not.toContain('league-name-sentinel');
      expect(logged).not.toContain('failed to parse filter');
    });

    it('logs the thrown error name only when the row mapping throws (FLA-370)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      // The realistic reach for this catch-all: a truthy non-array `data` makes the
      // `.map()` inside the try throw a TypeError.
      const eqUser = vi.fn().mockResolvedValue({ data: { not: 'an array' }, error: null });
      const select = vi.fn().mockReturnValue({ eq: eqUser });
      mockFrom.mockReturnValue({ select });

      const result = await storage.listArchived('user_leak_sentinel');

      expect(result).toEqual([]);
      const logged = loggedFrom(errorSpy);
      expect(logged).toContain('TypeError');
      expect(logged).toContain('user_lea...');
      expect(logged).not.toContain('user_leak_sentinel');
    });
  });
});
