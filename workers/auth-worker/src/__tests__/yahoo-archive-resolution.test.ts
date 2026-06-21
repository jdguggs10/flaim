import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import {
  handleYahooDiscover,
  resolveYahooArchiveTarget,
  type YahooConnectEnv,
} from '../yahoo-connect-handlers';
import { YahooStorage } from '../yahoo-storage';

// Mock YahooStorage so no real Supabase client is created and the league/credential
// reads + writes are controllable per test.
vi.mock('../yahoo-storage', () => ({
  REFRESH_COOLDOWN_OWNER_PREFIX: 'cooldown:',
  YahooStorage: {
    fromEnvironment: vi.fn(),
  },
}));

const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
vi.stubGlobal('fetch', mockFetch);

const env: YahooConnectEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  YAHOO_CLIENT_ID: 'cid',
  YAHOO_CLIENT_SECRET: 'secret',
  NODE_ENV: 'test',
  ENVIRONMENT: 'test',
};

const corsHeaders = { 'Access-Control-Allow-Origin': '*' };

const YAHOO_API = 'https://fantasysports.yahooapis.com/fantasy/v2';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Build a single-league meta response carrying a `renew` pointer.
function leagueMeta(leagueKey: string, renew: string): unknown {
  return { fantasy_content: { league: [{ league_key: leagueKey, renew, renewed: '' }] } };
}

// Build the bulk discovery response (one NFL league with a renew pointer + team).
function discoveryResponse(leagueKey: string, season: string, renew: string): unknown {
  return {
    fantasy_content: {
      users: {
        count: 1,
        0: {
          user: [
            { guid: 'guid-1' },
            {
              games: {
                count: 1,
                0: {
                  game: [
                    { code: 'nfl', season },
                    {
                      leagues: {
                        count: 1,
                        0: {
                          league: [
                            {
                              league_key: leagueKey,
                              name: 'Zombie League',
                              renew,
                              renewed: '',
                            },
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    },
  };
}

// Build a bulk discovery response with two NFL leagues in the same game, each
// carrying its own renew pointer. Used to exercise cross-league chain dedup.
function twoLeagueDiscoveryResponse(
  season: string,
  leagueA: { leagueKey: string; renew: string },
  leagueB: { leagueKey: string; renew: string }
): unknown {
  return {
    fantasy_content: {
      users: {
        count: 1,
        0: {
          user: [
            { guid: 'guid-1' },
            {
              games: {
                count: 1,
                0: {
                  game: [
                    { code: 'nfl', season },
                    {
                      leagues: {
                        count: 2,
                        0: {
                          league: [
                            { league_key: leagueA.leagueKey, name: 'League A', renew: leagueA.renew, renewed: '' },
                          ],
                        },
                        1: {
                          league: [
                            { league_key: leagueB.leagueKey, name: 'League B', renew: leagueB.renew, renewed: '' },
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    },
  };
}

interface MockStorage {
  getYahooCredentials: ReturnType<typeof vi.fn>;
  getYahooLeagues: ReturnType<typeof vi.fn>;
  upsertYahooLeague: ReturnType<typeof vi.fn>;
  persistYahooRecurringRoot: ReturnType<typeof vi.fn>;
}

function freshCredentials() {
  return {
    clerkUserId: 'u',
    accessToken: 'token-abc',
    refreshToken: 'refresh-abc',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h out → no refresh
    needsRefresh: false,
  };
}

describe('Yahoo recurring-id resolution', () => {
  let mockStorage: MockStorage;

  beforeEach(() => {
    mockFetch.mockReset();
    mockStorage = {
      getYahooCredentials: vi.fn().mockResolvedValue(freshCredentials()),
      getYahooLeagues: vi.fn().mockResolvedValue([]),
      upsertYahooLeague: vi.fn().mockResolvedValue('row-id'),
      persistYahooRecurringRoot: vi.fn().mockResolvedValue(undefined),
    };
    (YahooStorage.fromEnvironment as unknown as MockedFunction<typeof YahooStorage.fromEnvironment>)
      .mockReturnValue(mockStorage as unknown as YahooStorage);
  });

  // ===========================================================================
  // handleYahooDiscover — renew-chain walk persists the resolved root
  // ===========================================================================

  describe('handleYahooDiscover renew chain', () => {
    it('resolves the chain root and persists it as recurring_league_id', async () => {
      // Bulk discovery: 2025 league "449.l.10" with renew "423_10" (prior season).
      // Chain: 449.l.10 -> (renew 423_10) 423.l.10 -> (renew "" ) root.
      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/users;use_login=1/games/leagues')) {
          return jsonResponse(discoveryResponse('449.l.10', '2025', '423_10'));
        }
        if (url === `${YAHOO_API}/league/423.l.10?format=json`) {
          // Oldest reachable league: empty renew terminates the chain.
          return jsonResponse(leagueMeta('423.l.10', ''));
        }
        return new Response(null, { status: 404 });
      });

      const res = await handleYahooDiscover(env, 'u', corsHeaders);
      expect(res.status).toBe(200);

      // The seed renew from the bulk response skips the first meta fetch; only the
      // prior season (423.l.10) is fetched.
      expect(mockStorage.upsertYahooLeague).toHaveBeenCalledOnce();
      const saved = mockStorage.upsertYahooLeague.mock.calls[0][0];
      expect(saved).toMatchObject({
        leagueKey: '449.l.10',
        recurringLeagueId: '423.l.10',
      });
    });

    it('falls back to the season-scoped league_key when the chain cannot resolve', async () => {
      // Bulk discovery has no renew → first meta fetch fails (404) → fallback.
      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/users;use_login=1/games/leagues')) {
          return jsonResponse(discoveryResponse('449.l.99', '2025', ''));
        }
        return new Response(null, { status: 404 });
      });

      const res = await handleYahooDiscover(env, 'u', corsHeaders);
      expect(res.status).toBe(200);

      const saved = mockStorage.upsertYahooLeague.mock.calls[0][0];
      // Empty renew on the bulk row → 449.l.99 is treated as the root itself.
      expect(saved.recurringLeagueId).toBe('449.l.99');
    });

    it('fetches a shared ancestor meta only once across two leagues that share a chain', async () => {
      // Two 2025 leagues whose renew chains converge on a common ancestor:
      //   A: 449.l.10 -(423_10)-> 423.l.10 -(308_10)-> 308.l.10 (root, empty renew)
      //   B: 449.l.20 -(423_20)-> 423.l.20 -(308_10)-> 308.l.10 (same root)
      // The shared 308.l.10 meta should be fetched exactly once: the metaCache /
      // recurringIdCache shared across both leagues' walks dedups it.
      const metaFetchCounts = new Map<string, number>();
      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes('/users;use_login=1/games/leagues')) {
          return jsonResponse(
            twoLeagueDiscoveryResponse(
              '2025',
              { leagueKey: '449.l.10', renew: '423_10' },
              { leagueKey: '449.l.20', renew: '423_20' }
            )
          );
        }
        const match = url.match(/\/league\/([^?]+)\?format=json$/);
        if (match) {
          const key = match[1];
          metaFetchCounts.set(key, (metaFetchCounts.get(key) ?? 0) + 1);
          if (key === '423.l.10') return jsonResponse(leagueMeta('423.l.10', '308_10'));
          if (key === '423.l.20') return jsonResponse(leagueMeta('423.l.20', '308_10'));
          if (key === '308.l.10') return jsonResponse(leagueMeta('308.l.10', '')); // shared root
        }
        return new Response(null, { status: 404 });
      });

      const res = await handleYahooDiscover(env, 'u', corsHeaders);
      expect(res.status).toBe(200);

      // Both leagues resolved to the shared root.
      expect(mockStorage.upsertYahooLeague).toHaveBeenCalledTimes(2);
      const savedRoots = mockStorage.upsertYahooLeague.mock.calls.map((call) => call[0].recurringLeagueId);
      expect(savedRoots).toEqual(['308.l.10', '308.l.10']);

      // The shared ancestor meta is fetched exactly once despite two chain walks
      // reaching it; the per-walk seed covers the first hop of each league.
      expect(metaFetchCounts.get('308.l.10')).toBe(1);
      expect(metaFetchCounts.get('423.l.10')).toBe(1);
      expect(metaFetchCounts.get('423.l.20')).toBe(1);
    });
  });

  // ===========================================================================
  // resolveYahooArchiveTarget — fresh root re-resolution + persist parity
  // ===========================================================================

  describe('resolveYahooArchiveTarget', () => {
    it('re-resolves the canonical root fresh when a row was keyed on a fallback id', async () => {
      // Stored rows keyed on a season-scoped fallback (recurringLeagueId == leagueKey).
      mockStorage.getYahooLeagues.mockResolvedValue([
        {
          id: 'row-2025', clerkUserId: 'u', sport: 'football', seasonYear: 2025,
          leagueKey: '449.l.10', leagueName: 'Zombie', recurringLeagueId: '449.l.10',
        },
        {
          id: 'row-2024', clerkUserId: 'u', sport: 'football', seasonYear: 2024,
          leagueKey: '423.l.10', leagueName: 'Zombie', recurringLeagueId: '449.l.10',
        },
      ]);

      // Fresh chain from the freshest row (449.l.10): renew 423_10 → 423.l.10 root.
      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        if (url === `${YAHOO_API}/league/449.l.10?format=json`) {
          return jsonResponse(leagueMeta('449.l.10', '423_10'));
        }
        if (url === `${YAHOO_API}/league/423.l.10?format=json`) {
          return jsonResponse(leagueMeta('423.l.10', ''));
        }
        return new Response(null, { status: 404 });
      });

      const target = await resolveYahooArchiveTarget(env, 'u', '449.l.10');

      expect(target.recurringLeagueId).toBe('423.l.10');
      expect(target.seasonLeagueKeys.sort()).toEqual(['423.l.10', '449.l.10']);
      expect(target.leagueName).toBe('Zombie');
      // Persists the resolved root onto the group rows so the read-filter key
      // (recurring_league_id ?? league_key) equals the archive key.
      expect(mockStorage.persistYahooRecurringRoot).toHaveBeenCalledWith(
        'u',
        expect.arrayContaining(['449.l.10', '423.l.10']),
        '423.l.10',
      );
    });

    it('resolves without looping when the renew chain cycles back to a visited key', async () => {
      // Stored group keyed on a season-scoped fallback so re-resolution runs.
      mockStorage.getYahooLeagues.mockResolvedValue([
        {
          id: 'row-2025', clerkUserId: 'u', sport: 'football', seasonYear: 2025,
          leagueKey: '449.l.10', leagueName: 'Zombie', recurringLeagueId: '449.l.10',
        },
      ]);

      // Chain loops: 449.l.10 -> (renew 423_10) 423.l.10 -> (renew 449_10) 449.l.10.
      // The visited guard must trip on the second visit to 449.l.10 rather than loop.
      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        if (url === `${YAHOO_API}/league/449.l.10?format=json`) {
          return jsonResponse(leagueMeta('449.l.10', '423_10'));
        }
        if (url === `${YAHOO_API}/league/423.l.10?format=json`) {
          return jsonResponse(leagueMeta('423.l.10', '449_10')); // points back → cycle
        }
        return new Response(null, { status: 404 });
      });

      const target = await resolveYahooArchiveTarget(env, 'u', '449.l.10');

      // Cycle → resolution fails → fall back to the freshest row's season-scoped id.
      // The important assertion is that it returns at all (no infinite loop / hang).
      expect(target.recurringLeagueId).toBe('449.l.10');
      expect(mockStorage.persistYahooRecurringRoot).toHaveBeenCalledWith(
        'u', ['449.l.10'], '449.l.10',
      );
    });

    it('terminates and falls back when the renew chain exceeds the depth cap', async () => {
      mockStorage.getYahooLeagues.mockResolvedValue([
        {
          id: 'row', clerkUserId: 'u', sport: 'football', seasonYear: 2025,
          leagueKey: '1000.l.10', leagueName: 'Zombie', recurringLeagueId: '1000.l.10',
        },
      ]);

      // An unbounded descending chain: every league points to the prior game key,
      // never terminating. The depth cap (MAX_YAHOO_CHAIN_DEPTH) must stop the walk.
      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        const match = url.match(/\/league\/(\d+)\.l\.10\?format=json$/);
        if (match) {
          const gameKey = Number(match[1]);
          // Always point one game key lower → chain never reaches an empty renew.
          return jsonResponse(leagueMeta(`${gameKey}.l.10`, `${gameKey - 1}_10`));
        }
        return new Response(null, { status: 404 });
      });

      const target = await resolveYahooArchiveTarget(env, 'u', '1000.l.10');

      // Depth cap trips → fall back to the freshest row's season-scoped id.
      expect(target.recurringLeagueId).toBe('1000.l.10');
      expect(mockStorage.persistYahooRecurringRoot).toHaveBeenCalledWith(
        'u', ['1000.l.10'], '1000.l.10',
      );
    });

    it('returns the oldest reachable league when a meta fetch resolves but carries no further renew (§8.5 #2)', async () => {
      mockStorage.getYahooLeagues.mockResolvedValue([
        {
          id: 'row-2025', clerkUserId: 'u', sport: 'football', seasonYear: 2025,
          leagueKey: '449.l.10', leagueName: 'Zombie', recurringLeagueId: '449.l.10',
        },
      ]);

      // Walk: 449.l.10 -> (renew 423_10) 423.l.10 -> (renew 308_10) 308.l.10.
      // 308.l.10's meta is reachable but its renew is empty → it is the oldest
      // reachable league and becomes the root. Not a throw, and not the
      // season-scoped 449.l.10 fallback, since the earlier links resolved.
      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        if (url === `${YAHOO_API}/league/449.l.10?format=json`) {
          return jsonResponse(leagueMeta('449.l.10', '423_10'));
        }
        if (url === `${YAHOO_API}/league/423.l.10?format=json`) {
          return jsonResponse(leagueMeta('423.l.10', '308_10'));
        }
        if (url === `${YAHOO_API}/league/308.l.10?format=json`) {
          return jsonResponse(leagueMeta('308.l.10', '')); // oldest reachable
        }
        return new Response(null, { status: 404 });
      });

      const target = await resolveYahooArchiveTarget(env, 'u', '449.l.10');

      // Oldest reachable league_key becomes the root, not the season-scoped fallback.
      expect(target.recurringLeagueId).toBe('308.l.10');
      expect(mockStorage.persistYahooRecurringRoot).toHaveBeenCalledWith(
        'u',
        ['449.l.10'],
        '308.l.10',
      );
    });

    it('uses the oldest reached league_key as root when a meta fetch 404s mid-walk (§8.5 #2)', async () => {
      // The walk follows 449 -> 423 -> 308, but 308.l.10's own meta is unreachable
      // (404 → getYahooLeagueMeta throws). Rather than collapsing to the season-scoped
      // start (449.l.10), the resolver uses the oldest league it actually reached
      // (308.l.10) as the root. A consistently-unreachable deep season then yields a
      // stable root year-over-year, so the archived league does not resurface on the
      // next re-sync.
      mockStorage.getYahooLeagues.mockResolvedValue([
        {
          id: 'row-2025', clerkUserId: 'u', sport: 'football', seasonYear: 2025,
          leagueKey: '449.l.10', leagueName: 'Zombie', recurringLeagueId: '449.l.10',
        },
      ]);

      mockFetch.mockImplementation(async (input) => {
        const url = String(input);
        if (url === `${YAHOO_API}/league/449.l.10?format=json`) {
          return jsonResponse(leagueMeta('449.l.10', '423_10'));
        }
        if (url === `${YAHOO_API}/league/423.l.10?format=json`) {
          return jsonResponse(leagueMeta('423.l.10', '308_10'));
        }
        // 308.l.10 meta is unreachable → getYahooLeagueMeta throws mid-walk.
        return new Response(null, { status: 404 });
      });

      const target = await resolveYahooArchiveTarget(env, 'u', '449.l.10');

      // Oldest reached league_key (308.l.10) becomes the root, not the season-scoped
      // 449.l.10 — and the walk does not throw.
      expect(target.recurringLeagueId).toBe('308.l.10');
      expect(mockStorage.persistYahooRecurringRoot).toHaveBeenCalledWith(
        'u', ['449.l.10'], '308.l.10',
      );
    });

    it('falls back to the freshest stored id when no usable token is available', async () => {
      mockStorage.getYahooCredentials.mockResolvedValue(null);
      mockStorage.getYahooLeagues.mockResolvedValue([
        {
          id: 'row-2025', clerkUserId: 'u', sport: 'football', seasonYear: 2025,
          leagueKey: '449.l.10', leagueName: 'Zombie', recurringLeagueId: '300.l.10',
        },
      ]);

      const target = await resolveYahooArchiveTarget(env, 'u', '300.l.10');

      // No token → keep the freshest row's stored recurring id; no meta fetch.
      expect(target.recurringLeagueId).toBe('300.l.10');
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockStorage.persistYahooRecurringRoot).toHaveBeenCalledWith(
        'u', ['449.l.10'], '300.l.10',
      );
    });
  });
});
