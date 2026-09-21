import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../yahoo-storage', async () => {
  const actual = await vi.importActual<typeof import('../yahoo-storage')>('../yahoo-storage');
  return { ...actual, YahooStorage: { ...actual.YahooStorage, fromEnvironment: vi.fn() } };
});

import {
  locateYahooLeagueByTeamNameDigest,
  type YahooConnectEnv,
} from '../yahoo-connect-handlers';
import { YahooStorage } from '../yahoo-storage';

const USER_ID = 'user_3Ie4m68lUbzxyv22NsMU';
const GAME_KEY = '470';
const LEAGUE_KEY = '470.l.1495612';
const OTHER_LEAGUE_KEY = '470.l.7777777';
const TEAM_NAME = 'Third Team  ';
const ACCESS_TOKEN = 'sentinel-access-token';
const REFRESH_TOKEN = 'sentinel-refresh-token';
const env: YahooConnectEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  YAHOO_CLIENT_ID: 'test-client',
  YAHOO_CLIENT_SECRET: 'test-secret',
  ENVIRONMENT: 'test',
};

let fetchSpy: ReturnType<typeof vi.fn>;
let storage: { getYahooCredentials: ReturnType<typeof vi.fn> };

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

async function sha256ExactUtf8(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function payload(leagues: Array<{ leagueKey: string; teamNames: string[] }>) {
  return {
    fantasy_content: {
      users: {
        count: 1,
        0: {
          user: [
            {},
            {
              games: {
                count: 1,
                0: {
                  game: [
                    { game_key: GAME_KEY },
                    {
                      leagues: {
                        count: leagues.length,
                        ...Object.fromEntries(leagues.map((league, leagueIndex) => [
                          String(leagueIndex),
                          {
                            league: [
                              { league_key: league.leagueKey },
                              {
                                teams: {
                                  count: league.teamNames.length,
                                  ...Object.fromEntries(league.teamNames.map((name, teamIndex) => [
                                    String(teamIndex),
                                    { team: [[{ team_key: `${league.leagueKey}.t.${teamIndex + 1}` }, { name }]] },
                                  ])),
                                },
                              },
                            ],
                          },
                        ])),
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

beforeEach(() => {
  vi.clearAllMocks();
  storage = {
    getYahooCredentials: vi.fn().mockResolvedValue({
      clerkUserId: USER_ID,
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      expiresAt: new Date(Date.now() + 60_000),
      needsRefresh: false,
    }),
  };
  vi.mocked(YahooStorage.fromEnvironment).mockReturnValue(storage as unknown as YahooStorage);
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('locateYahooLeagueByTeamNameDigest', () => {
  it('makes exactly the documented scoped GET and returns only the one exact matching league key', async () => {
    fetchSpy.mockResolvedValue(json(payload([
      { leagueKey: LEAGUE_KEY, teamNames: [TEAM_NAME, 'Other Team'] },
      { leagueKey: OTHER_LEAGUE_KEY, teamNames: ['Unrelated Team'] },
    ])));

    const result = await locateYahooLeagueByTeamNameDigest(env, USER_ID, GAME_KEY, await sha256ExactUtf8(TEAM_NAME));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      `https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=${GAME_KEY}/leagues;out=teams?format=json`,
      expect.objectContaining({ headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }),
    );
    expect(result).toEqual({ status: 'unique', leagueKey: LEAGUE_KEY });
    const safeResult = JSON.stringify(result);
    for (const forbidden of [TEAM_NAME, OTHER_LEAGUE_KEY, ACCESS_TOKEN, REFRESH_TOKEN]) {
      expect(safeResult).not.toContain(forbidden);
    }
  });

  it('hashes the original UTF-8 name rather than a trimmed or normalized variant', async () => {
    fetchSpy.mockResolvedValue(json(payload([{ leagueKey: LEAGUE_KEY, teamNames: [TEAM_NAME] }])));

    const result = await locateYahooLeagueByTeamNameDigest(env, USER_ID, GAME_KEY, await sha256ExactUtf8(TEAM_NAME.trim()));

    expect(result).toEqual({ status: 'none' });
  });

  it('deduplicates matching teams within one league before deciding uniqueness', async () => {
    fetchSpy.mockResolvedValue(json(payload([
      { leagueKey: LEAGUE_KEY, teamNames: [TEAM_NAME, TEAM_NAME] },
    ])));

    const result = await locateYahooLeagueByTeamNameDigest(env, USER_ID, GAME_KEY, await sha256ExactUtf8(TEAM_NAME));

    expect(result).toEqual({ status: 'unique', leagueKey: LEAGUE_KEY });
  });

  it.each([
    ['no exact name match', payload([{ leagueKey: LEAGUE_KEY, teamNames: ['Different Team'] }]), { status: 'none' }],
    ['two exact name matches', payload([
      { leagueKey: LEAGUE_KEY, teamNames: [TEAM_NAME] },
      { leagueKey: OTHER_LEAGUE_KEY, teamNames: [TEAM_NAME] },
    ]), { status: 'multiple' }],
    ['a malformed sibling team', {
      fantasy_content: {
        users: {
          count: 1,
          0: { user: [{}, { games: { count: 1, 0: { game: [{ game_key: GAME_KEY }, { leagues: { count: 1, 0: { league: [{ league_key: LEAGUE_KEY }, { teams: { count: 1, 0: { team: [[{ team_key: `${LEAGUE_KEY}.t.1` }]] } } }] } } }] } } }] },
        },
      },
    }, { status: 'unavailable' }],
  ] as const)('returns a closed %s status without leaking payload data', async (_label, response, expected) => {
    fetchSpy.mockResolvedValue(json(response));

    const result = await locateYahooLeagueByTeamNameDigest(env, USER_ID, GAME_KEY, await sha256ExactUtf8(TEAM_NAME));

    expect(result).toEqual(expected);
    const safeResult = JSON.stringify(result);
    for (const forbidden of [TEAM_NAME, LEAGUE_KEY, OTHER_LEAGUE_KEY, ACCESS_TOKEN, REFRESH_TOKEN]) {
      expect(safeResult).not.toContain(forbidden);
    }
  });

  it('refuses a near-expiry credential instead of refreshing or making any Yahoo request', async () => {
    storage.getYahooCredentials.mockResolvedValueOnce({
      clerkUserId: USER_ID,
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      expiresAt: new Date(Date.now() - 1),
      needsRefresh: true,
    });

    const result = await locateYahooLeagueByTeamNameDigest(env, USER_ID, GAME_KEY, await sha256ExactUtf8(TEAM_NAME));

    expect(result).toEqual({ status: 'unavailable' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(Object.keys(storage)).toEqual(['getYahooCredentials']);
  });
});
