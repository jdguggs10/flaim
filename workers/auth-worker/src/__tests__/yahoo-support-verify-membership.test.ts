import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../yahoo-storage', async () => {
  const actual = await vi.importActual<typeof import('../yahoo-storage')>('../yahoo-storage');
  return { ...actual, YahooStorage: { ...actual.YahooStorage, fromEnvironment: vi.fn() } };
});

import {
  verifyYahooLeagueMembership,
  type YahooConnectEnv,
  type YahooSupportLeagueMembershipVerification,
} from '../yahoo-connect-handlers';
import {
  parseYahooSupportLeagueMembershipRequest,
  runYahooSupportVerifyLeagueMembership,
  type YahooSupportEnv,
} from '../yahoo-support-diagnostics';
import { YahooStorage } from '../yahoo-storage';

const USER_ID = 'user_3Ie4m68lUbzxyv22NsMU';
const LEAGUE_KEY = '470.l.1234567';
const TEAM_KEY = `${LEAGUE_KEY}.t.3`;
const STORED_GUID = 'stored-yahoo-guid';
const ACCESS_TOKEN = 'sentinel-access-token';
const REFRESH_TOKEN = 'sentinel-refresh-token';
const LEAGUE_NAME = 'Sentinel League Name';
const TEAM_NAME = 'Sentinel Team Name';
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

function directTeamsPayload(owned: 0 | 1 = 1, managerGuid = STORED_GUID) {
  return {
    fantasy_content: {
      league: [
        { league_key: LEAGUE_KEY, name: LEAGUE_NAME },
        {
          teams: {
            count: 1,
            0: {
              team: [
                { team_key: TEAM_KEY },
                { name: TEAM_NAME },
                { is_owned_by_current_login: owned },
                { managers: { count: 1, 0: { manager: [{ guid: managerGuid }] } } },
              ],
            },
          },
        },
      ],
    },
  };
}

function userScopedPayload(includeTeam = true, loggedInGuid = STORED_GUID) {
  return {
    fantasy_content: {
      users: {
        count: 1,
        0: {
          user: [
            { guid: loggedInGuid },
            {
              games: {
                count: 1,
                0: {
                  game: [
                    { game_key: '470' },
                    {
                      teams: includeTeam
                        ? { count: 1, 0: { team: [{ team_key: TEAM_KEY }, { name: TEAM_NAME }] } }
                        : { count: 0 },
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
      yahooGuid: STORED_GUID,
      expiresAt: new Date(Date.now() + 60_000),
      needsRefresh: false,
    }),
  };
  vi.mocked(YahooStorage.fromEnvironment).mockReturnValue(storage as unknown as YahooStorage);
  fetchSpy = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes(`/league/${LEAGUE_KEY}/teams`)) return json(directTeamsPayload());
    if (url.includes('/users;use_login=1/games;game_keys=470/teams')) return json(userScopedPayload());
    throw new Error('unexpected Yahoo request');
  });
  vi.stubGlobal('fetch', fetchSpy);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('verifyYahooLeagueMembership', () => {
  it('makes only the two fixed Yahoo GETs and returns redacted confirmed evidence', async () => {
    const result = await verifyYahooLeagueMembership(env, USER_ID, LEAGUE_KEY, 'correlation-id');

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual([
      `https://fantasysports.yahooapis.com/fantasy/v2/league/${LEAGUE_KEY}/teams?format=json`,
      'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=470/teams?format=json',
    ]);
    expect(result).toMatchObject({
      stage: 'completed',
      evidence: {
        requestedLeagueInUserScopedTeams: true,
        directIsOwnedByCurrentLogin: true,
        managerGuidComparison: 'matches_stored_yahoo_guid',
      },
    });
    const report = JSON.stringify(result);
    for (const forbidden of [LEAGUE_KEY, TEAM_KEY, STORED_GUID, ACCESS_TOKEN, REFRESH_TOKEN, LEAGUE_NAME, TEAM_NAME]) {
      expect(report).not.toContain(forbidden);
    }
  });

  it('reports a collection omission without mistaking a direct public league read for proof by itself', async () => {
    fetchSpy.mockImplementation(async (input: unknown) => String(input).includes('/users;')
      ? json(userScopedPayload(false))
      : json(directTeamsPayload(0, 'another-manager-guid')));

    const result = await verifyYahooLeagueMembership(env, USER_ID, LEAGUE_KEY);

    expect(result).toMatchObject({
      stage: 'completed',
      evidence: {
        requestedLeagueInUserScopedTeams: false,
        directIsOwnedByCurrentLogin: false,
        managerGuidComparison: 'unavailable',
      },
    });
  });

  it('accepts a direct manager match to Yahoo’s logged-in GUID as affirmative evidence', async () => {
    const loggedInGuid = 'logged-in-yahoo-guid';
    fetchSpy.mockImplementation(async (input: unknown) => String(input).includes('/users;')
      ? json(userScopedPayload(false, loggedInGuid))
      : json(directTeamsPayload(0, loggedInGuid)));

    const result = await verifyYahooLeagueMembership(env, USER_ID, LEAGUE_KEY);

    expect(result).toMatchObject({
      stage: 'completed',
      evidence: {
        requestedLeagueInUserScopedTeams: false,
        directIsOwnedByCurrentLogin: false,
        managerGuidComparison: 'matches_logged_in_yahoo_guid',
      },
    });
  });

  it.each([
    ['missing users', { fantasy_content: {} }],
    ['missing games', {
      fantasy_content: {
        users: { count: 1, 0: { user: [{ guid: STORED_GUID }, {}] } },
      },
    }],
    ['missing teams', {
      fantasy_content: {
        users: {
          count: 1,
          0: {
            user: [
              { guid: STORED_GUID },
              { games: { count: 1, 0: { game: [{ game_key: '470' }, {}] } } },
            ],
          },
        },
      },
    }],
    ['contradictory count', {
      fantasy_content: {
        users: {
          count: 1,
          0: {
            user: [
              { guid: STORED_GUID },
              {
                games: {
                  count: 1,
                  0: {
                    game: [
                      { game_key: '470' },
                      { teams: { count: 0, 0: { team: [{ team_key: TEAM_KEY }] } } },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
    }],
    ['team entry missing its key', {
      fantasy_content: {
        users: {
          count: 1,
          0: {
            user: [
              { guid: STORED_GUID },
              {
                games: {
                  count: 1,
                  0: {
                    game: [
                      { game_key: '470' },
                      { teams: { count: 1, 0: { team: [{ name: TEAM_NAME }] } } },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
    }],
  ])('keeps a partial 200 scoped response unavailable: %s', async (_label, scopedPayload) => {
    fetchSpy.mockImplementation(async (input: unknown) => String(input).includes('/users;')
      ? json(scopedPayload)
      : json(directTeamsPayload()));

    const verification = await verifyYahooLeagueMembership(env, USER_ID, LEAGUE_KEY);
    expect(verification).toMatchObject({
      stage: 'completed',
      evidence: {
        requestedLeagueInUserScopedTeams: null,
        directIsOwnedByCurrentLogin: true,
      },
    });

    const report = await runYahooSupportVerifyLeagueMembership(
      env as unknown as YahooSupportEnv,
      { userId: USER_ID, leagueKey: LEAGUE_KEY },
      { verify: vi.fn().mockResolvedValue(verification) },
    );
    expect(report).toMatchObject({
      collection: 'unavailable',
      interpretation: {
        category: 'inconclusive',
        summary: expect.stringContaining('direct team metadata confirmed ownership'),
        nextAction: expect.stringContaining('do not call this a confirmed collection omission'),
      },
    });
  });

  it('does not turn a direct rejection plus an incomplete scoped response into non-membership', async () => {
    fetchSpy.mockImplementation(async (input: unknown) => String(input).includes('/users;')
      ? json({ fantasy_content: {} })
      : json(directTeamsPayload(0, 'another-manager-guid')));

    const verification = await verifyYahooLeagueMembership(env, USER_ID, LEAGUE_KEY);
    const report = await runYahooSupportVerifyLeagueMembership(
      env as unknown as YahooSupportEnv,
      { userId: USER_ID, leagueKey: LEAGUE_KEY },
      { verify: vi.fn().mockResolvedValue(verification) },
    );

    expect(report).toMatchObject({
      collection: 'unavailable',
      interpretation: {
        category: 'inconclusive',
        summary: expect.stringContaining('not structurally complete enough to confirm non-membership'),
        nextAction: expect.stringContaining('do not infer non-membership'),
      },
    });
  });

  it.each(['1234567', 'nfl.l.1234567', '470.l.1234567.t.3', '../470.l.1234567', `${'4'.repeat(60)}.l.1234567`])(
    'rejects invalid full key %s before storage or Yahoo calls',
    async (leagueKey) => {
      await expect(verifyYahooLeagueMembership(env, USER_ID, leagueKey)).rejects.toThrow('invalid full league key');
      expect(storage.getYahooCredentials).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );
});

describe('verify-league-membership support contract', () => {
  it('parses only userId plus a strict full numeric leagueKey', async () => {
    const valid = await parseYahooSupportLeagueMembershipRequest(new Request('https://example.test', {
      method: 'POST', body: JSON.stringify({ userId: USER_ID, leagueKey: LEAGUE_KEY }),
    }));
    expect(valid).toEqual({ request: { userId: USER_ID, leagueKey: LEAGUE_KEY } });

    const invalid = await parseYahooSupportLeagueMembershipRequest(new Request('https://example.test', {
      method: 'POST', body: JSON.stringify({ userId: USER_ID, leagueKey: '470.l.1234567.t.3' }),
    }));
    expect(invalid).toMatchObject({ error: { body: { error: 'invalid_league_key' } } });
  });

  it.each([
    ['membership_confirmed_collection_present', {
      requestedLeagueInUserScopedTeams: true, directIsOwnedByCurrentLogin: null,
      managerGuidComparison: 'unavailable',
    }],
    ['membership_confirmed_collection_omitted', {
      requestedLeagueInUserScopedTeams: false, directIsOwnedByCurrentLogin: true,
      managerGuidComparison: 'unavailable',
    }],
    ['membership_not_confirmed', {
      requestedLeagueInUserScopedTeams: false, directIsOwnedByCurrentLogin: false,
      managerGuidComparison: 'unavailable',
    }],
  ] as const)('interprets %s from safe evidence only', async (category, evidence) => {
    const completed: YahooSupportLeagueMembershipVerification = {
      stage: 'completed',
      calls: [
        { label: 'league_teams', httpStatus: 200, ok: true, bodyIsJson: true, bodyLooksLikeEnvelope: true, errorSnippetCategory: 'none', durationMs: 1 },
        { label: 'user_game_teams', httpStatus: 200, ok: true, bodyIsJson: true, bodyLooksLikeEnvelope: true, errorSnippetCategory: 'none', durationMs: 1 },
      ],
      evidence,
    };
    const report = await runYahooSupportVerifyLeagueMembership(
      env as unknown as YahooSupportEnv,
      { userId: USER_ID, leagueKey: LEAGUE_KEY },
      { now: () => Date.parse('2026-09-20T12:00:00.000Z'), verify: vi.fn().mockResolvedValue(completed) },
    );
    expect(report).toMatchObject({ outcome: 'ok', interpretation: { category } });
    expect(report).not.toHaveProperty('evidence');
    expect(JSON.stringify(report)).not.toContain('managerGuidComparison');
  });

  it('keeps a direct confirmation while correctly reporting an unavailable collection', async () => {
    const completed: YahooSupportLeagueMembershipVerification = {
      stage: 'completed',
      calls: [
        { label: 'league_teams', httpStatus: 200, ok: true, bodyIsJson: true, bodyLooksLikeEnvelope: true, errorSnippetCategory: 'none', durationMs: 1 },
        { label: 'user_game_teams', httpStatus: 503, ok: false, bodyIsJson: true, bodyLooksLikeEnvelope: false, errorSnippetCategory: 'yahoo_error_json', durationMs: 1 },
      ],
      evidence: {
        requestedLeagueInUserScopedTeams: null, directIsOwnedByCurrentLogin: true,
        managerGuidComparison: 'unavailable',
      },
    };
    const report = await runYahooSupportVerifyLeagueMembership(
      env as unknown as YahooSupportEnv,
      { userId: USER_ID, leagueKey: LEAGUE_KEY },
      { verify: vi.fn().mockResolvedValue(completed) },
    );
    expect(report).toMatchObject({
      collection: 'unavailable',
      interpretation: { category: 'malformed_payload' },
    });
  });
});
