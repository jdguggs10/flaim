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
const NEAR_PREFIX_LEAGUE_TEAM_KEY = '470.l.12345678.t.1';
const UNRELATED_MALFORMED_TEAM_KEY = 'unrelated-team-key-sentinel';
const NON_STRING_TEAM_KEY_SENTINEL = 'non-string-team-key-sentinel';
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
let logSpy: ReturnType<typeof vi.spyOn>;

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

function directUserTeamsPayload(
  teamKeys: string[] = [TEAM_KEY],
  teamShape: 'fragments' | 'nested-fragments' | 'object' = 'fragments'
) {
  return {
    fantasy_content: {
      users: {
        count: 1,
        0: {
          user: [
            {},
            {
              teams: {
                count: teamKeys.length,
                ...Object.fromEntries(teamKeys.map((teamKey, index) => [
                  String(index), {
                    team: teamShape === 'object'
                      ? { team_key: teamKey }
                      : teamShape === 'nested-fragments'
                        ? [[{ team_key: teamKey }]]
                        : [{ team_key: teamKey }],
                  },
                ])),
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
    if (url.includes('/users;use_login=1/teams')) return json(directUserTeamsPayload());
    throw new Error('unexpected Yahoo request');
  });
  vi.stubGlobal('fetch', fetchSpy);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('verifyYahooLeagueMembership', () => {
  it('makes exactly the three fixed Yahoo GETs and returns redacted confirmed evidence', async () => {
    const result = await verifyYahooLeagueMembership(env, USER_ID, LEAGUE_KEY, 'correlation-id');

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual([
      `https://fantasysports.yahooapis.com/fantasy/v2/league/${LEAGUE_KEY}/teams?format=json`,
      'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/games;game_keys=470/teams?format=json',
      'https://fantasysports.yahooapis.com/fantasy/v2/users;use_login=1/teams?format=json',
    ]);
    expect(result).toMatchObject({
      stage: 'completed',
      calls: [
        { label: 'league_teams' },
        { label: 'user_game_teams' },
      ],
      evidence: {
        requestedLeagueInUserScopedTeams: true,
        directIsOwnedByCurrentLogin: true,
        managerGuidComparison: 'matches_logged_in_yahoo_guid',
      },
    });
    const report = JSON.stringify(result);
    for (const forbidden of [LEAGUE_KEY, TEAM_KEY, STORED_GUID, ACCESS_TOKEN, REFRESH_TOKEN, LEAGUE_NAME, TEAM_NAME]) {
      expect(report).not.toContain(forbidden);
    }
    const log = logSpy.mock.calls.map(([line]) => String(line)).join('\n');
    expect(log).toContain('"event":"yahoo_support_membership_shape"');
    expect(log).toContain('"direct_parse":"parsed"');
    expect(log).toContain('"scoped_parse":"parsed"');
    expect(log).toContain('"direct_user_teams_parse":"parsed"');
    expect(log).toContain('"direct_user_teams_requested_league_team_keys":"one"');
    expect(log).toContain('"correlation_id":"correlation-id"');
    for (const forbidden of [LEAGUE_KEY, TEAM_KEY, STORED_GUID, ACCESS_TOKEN, REFRESH_TOKEN, LEAGUE_NAME, TEAM_NAME]) {
      expect(log).not.toContain(forbidden);
    }
  });

  it.each([
    ['no teams', 'zero', directUserTeamsPayload([])],
    ['near-prefix league', 'zero', directUserTeamsPayload([NEAR_PREFIX_LEAGUE_TEAM_KEY])],
    ['arbitrary malformed unrelated key', 'zero', directUserTeamsPayload([UNRELATED_MALFORMED_TEAM_KEY])],
    ['exact target', 'one', directUserTeamsPayload([TEAM_KEY])],
    ['nested exact target', 'one', directUserTeamsPayload([TEAM_KEY], 'nested-fragments')],
    ['object exact target', 'one', directUserTeamsPayload([TEAM_KEY], 'object')],
    ['multiple exact targets', 'multiple', directUserTeamsPayload([TEAM_KEY, `${LEAGUE_KEY}.t.8`])],
  ] as const)('logs %s direct login-scoped requested-league shape as %s only', async (_label, expected, directUserPayload) => {
    fetchSpy.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/users;use_login=1/teams')) return json(directUserPayload);
      if (url.includes('/users;use_login=1/games;game_keys=470/teams')) return json(userScopedPayload());
      return json(directTeamsPayload());
    });

    const result = await verifyYahooLeagueMembership(env, USER_ID, LEAGUE_KEY);

    expect(result).toMatchObject({
      stage: 'completed',
      evidence: {
        requestedLeagueInUserScopedTeams: true,
        directIsOwnedByCurrentLogin: true,
      },
    });
    const log = logSpy.mock.calls.map(([line]) => String(line)).join('\n');
    expect(log).toContain('"direct_user_teams_parse":"parsed"');
    expect(log).toContain(`"direct_user_teams_requested_league_team_keys":"${expected}"`);
    for (const forbidden of [
      LEAGUE_KEY,
      TEAM_KEY,
      NEAR_PREFIX_LEAGUE_TEAM_KEY,
      UNRELATED_MALFORMED_TEAM_KEY,
      ACCESS_TOKEN,
      REFRESH_TOKEN,
      LEAGUE_NAME,
      TEAM_NAME,
    ]) {
      expect(log).not.toContain(forbidden);
      expect(JSON.stringify(result)).not.toContain(forbidden);
    }
  });

  it.each([
    ['zero logged-in users', {
      fantasy_content: { users: { count: 0 } },
    }, 'invalid_logged_in_user_count'],
    ['multiple logged-in users', {
      fantasy_content: {
        users: {
          count: 2,
          0: { user: [{}, { teams: { count: 0 } }] },
          1: { user: [{}, { teams: { count: 0 } }] },
        },
      },
    }, 'invalid_logged_in_user_count'],
    ['nested user resources', {
      fantasy_content: {
        users: { count: 1, 0: { user: [{}, [{ teams: { count: 0 } }]] } },
      },
    }, 'invalid_user_resources'],
    ['incomplete teams count', {
      fantasy_content: {
        users: { count: 1, 0: { user: [{}, { teams: { count: 2, 0: { team: [{ team_key: TEAM_KEY }] } } }] } },
      },
    }, 'invalid_teams_collection'],
    ['missing direct team key', {
      fantasy_content: {
        users: { count: 1, 0: { user: [{}, { teams: { count: 1, 0: { team: [{}] } } }] } },
      },
    }, 'missing_direct_team_key'],
    ['multiple direct team key fields', {
      fantasy_content: {
        users: {
          count: 1,
          0: {
            user: [{}, {
              teams: {
                count: 1,
                0: { team: [{ team_key: TEAM_KEY }, { team_key: TEAM_KEY }] },
              },
            }],
          },
        },
      },
    }, 'multiple_direct_team_keys'],
    ['non-string direct team key', {
      fantasy_content: {
        users: {
          count: 1,
          0: {
            user: [{}, {
              teams: {
                count: 1,
                0: { team: [{ team_key: { value: NON_STRING_TEAM_KEY_SENTINEL } }] },
              },
            }],
          },
        },
      },
    }, 'non_string_direct_team_key'],
    ['leading decoration containing target prefix', directUserTeamsPayload([`x${TEAM_KEY}`]), 'malformed_target_team_key'],
    ['empty target team id', directUserTeamsPayload([`${LEAGUE_KEY}.t.`]), 'malformed_target_team_key'],
    ['target id with trailing whitespace', directUserTeamsPayload([`${TEAM_KEY} `]), 'malformed_target_team_key'],
    ['target id with trailing newline', directUserTeamsPayload([`${TEAM_KEY}\n`]), 'malformed_target_team_key'],
    ['invalid team wrapper', {
      fantasy_content: {
        users: {
          count: 1,
          0: {
            user: [{}, {
              teams: { count: 1, 0: 'not-a-team-wrapper' },
            }],
          },
        },
      },
    }, 'invalid_team_wrapper'],
    ['missing team entity', {
      fantasy_content: {
        users: { count: 1, 0: { user: [{}, { teams: { count: 1, 0: {} } }] } },
      },
    }, 'invalid_team_entity_shape'],
  ] as const)('keeps malformed direct login-scoped %s unavailable', async (_label, directUserPayload, parseStatus) => {
    fetchSpy.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/users;use_login=1/teams')) return json(directUserPayload);
      if (url.includes('/users;use_login=1/games;game_keys=470/teams')) return json(userScopedPayload());
      return json(directTeamsPayload());
    });

    const result = await verifyYahooLeagueMembership(env, USER_ID, LEAGUE_KEY);

    const log = logSpy.mock.calls.map(([line]) => String(line)).join('\n');
    expect(log).toContain(`"direct_user_teams_parse":"${parseStatus}"`);
    expect(log).toContain('"direct_user_teams_requested_league_team_keys":"unavailable"');
    for (const forbidden of [TEAM_KEY, NON_STRING_TEAM_KEY_SENTINEL]) {
      expect(log).not.toContain(forbidden);
      expect(JSON.stringify(result)).not.toContain(forbidden);
    }
  });

  it('keeps a non-200 direct login-scoped response unavailable', async () => {
    fetchSpy.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/users;use_login=1/teams')) return json({ fantasy_content: {} }, 503);
      if (url.includes('/users;use_login=1/games;game_keys=470/teams')) return json(userScopedPayload());
      return json(directTeamsPayload());
    });

    await verifyYahooLeagueMembership(env, USER_ID, LEAGUE_KEY);

    const log = logSpy.mock.calls.map(([line]) => String(line)).join('\n');
    expect(log).toContain('"direct_user_teams_parse":"response_unusable"');
    expect(log).toContain('"direct_user_teams_requested_league_team_keys":"unavailable"');
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
        managerGuidComparison: 'does_not_match_authenticated_yahoo_guid',
      },
    });
  });

  it('logs only closed parse-stage reasons when usable envelopes lack membership structure', async () => {
    fetchSpy.mockImplementation(async (input: unknown) => String(input).includes('/users;')
      ? json({ fantasy_content: { users: { count: 0 } } })
      : json({ fantasy_content: {} }));

    const result = await verifyYahooLeagueMembership(env, USER_ID, LEAGUE_KEY, 'shape-correlation');

    expect(result).toMatchObject({
      stage: 'completed',
      evidence: {
        requestedLeagueInUserScopedTeams: null,
        directIsOwnedByCurrentLogin: null,
        managerGuidComparison: 'unavailable',
      },
    });
    const log = logSpy.mock.calls.map(([line]) => String(line)).join('\n');
    expect(log).toContain('"direct_parse":"invalid_league_entity"');
    expect(log).toContain('"scoped_parse":"empty_users_collection"');
    expect(log).toContain('"correlation_id":"shape-correlation"');
    for (const forbidden of [LEAGUE_KEY, TEAM_KEY, STORED_GUID, ACCESS_TOKEN, REFRESH_TOKEN, LEAGUE_NAME, TEAM_NAME]) {
      expect(log).not.toContain(forbidden);
    }
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
    ['team entry has a blank key', {
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
                      { teams: { count: 1, 0: { team: [{ team_key: '   ' }] } } },
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

  it('preserves a logged-in GUID mismatch when Yahoo omits the scoped teams collection', async () => {
    const loggedInGuid = 'logged-in-yahoo-guid';
    fetchSpy.mockImplementation(async (input: unknown) => String(input).includes('/users;')
      ? json({
          fantasy_content: {
            users: {
              count: 1,
              0: {
                user: [
                  { guid: loggedInGuid },
                  { games: { count: 1, 0: { game: [{ game_key: '470' }, {}] } } },
                ],
              },
            },
          },
        })
      : json(directTeamsPayload(0, STORED_GUID)));

    const verification = await verifyYahooLeagueMembership(env, USER_ID, LEAGUE_KEY);
    expect(verification).toMatchObject({
      stage: 'completed',
      evidence: {
        requestedLeagueInUserScopedTeams: null,
        directIsOwnedByCurrentLogin: false,
        managerGuidComparison: 'does_not_match_authenticated_yahoo_guid',
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
        category: 'membership_not_confirmed',
        summary: expect.stringContaining('does not match any manager identity'),
        nextAction: expect.stringContaining('reconnect Yahoo'),
      },
    });
    const serialized = JSON.stringify(report);
    const log = logSpy.mock.calls.map(([line]) => String(line)).join('\n');
    expect(log).toContain('"scoped_parse":"invalid_teams_collection"');
    expect(log).toContain('"direct_manager_parse":"complete"');
    expect(log).toContain('"manager_guid_comparison":"does_not_match_authenticated_yahoo_guid"');
    for (const forbidden of [
      LEAGUE_KEY, TEAM_KEY, STORED_GUID, loggedInGuid,
      ACCESS_TOKEN, REFRESH_TOKEN, LEAGUE_NAME, TEAM_NAME,
    ]) {
      expect(serialized).not.toContain(forbidden);
      expect(log).not.toContain(forbidden);
    }
  });

  it.each([
    ['counted object collection', { count: 1, 0: { manager: { guid: STORED_GUID } } }],
    ['native array collection', [{ manager: { guid: STORED_GUID } }]],
  ])('accepts nested Yahoo manager entities in a %s', async (_label, managers) => {
    const loggedInGuid = 'logged-in-yahoo-guid';
    fetchSpy.mockImplementation(async (input: unknown) => String(input).includes('/users;')
      ? json({
          fantasy_content: {
            users: {
              count: 1,
              0: {
                user: [
                  { guid: loggedInGuid },
                  { games: { count: 1, 0: { game: [{ game_key: '470' }, {}] } } },
                ],
              },
            },
          },
        })
      : json({
          fantasy_content: {
            league: [
              { league_key: LEAGUE_KEY },
              {
                teams: {
                  count: 1,
                  0: {
                    team: [[
                      { team_key: TEAM_KEY },
                      { is_owned_by_current_login: 0 },
                      { managers },
                    ]],
                  },
                },
              },
            ],
          },
        }));

    const verification = await verifyYahooLeagueMembership(env, USER_ID, LEAGUE_KEY);
    expect(verification).toMatchObject({
      stage: 'completed',
      evidence: {
        requestedLeagueInUserScopedTeams: null,
        directIsOwnedByCurrentLogin: false,
        managerGuidComparison: 'does_not_match_authenticated_yahoo_guid',
      },
    });
    expect(logSpy.mock.calls.map(([line]) => String(line)).join('\n'))
      .toContain('"direct_manager_parse":"complete"');
  });

  it('does not treat managers or ownership flags inside object-valued subresources as direct evidence', async () => {
    const loggedInGuid = 'logged-in-yahoo-guid';
    fetchSpy.mockImplementation(async (input: unknown) => String(input).includes('/users;')
      ? json(userScopedPayload(false, loggedInGuid))
      : json({
          fantasy_content: {
            league: [
              { league_key: LEAGUE_KEY },
              {
                teams: {
                  count: 1,
                  0: {
                    team: [
                      [
                        { team_key: TEAM_KEY },
                        { is_owned_by_current_login: 0 },
                        { managers: [{ manager: { guid: 'direct-manager-guid' } }] },
                      ],
                      {
                        roster: {
                          is_owned_by_current_login: 1,
                          managers: [{ manager: { guid: loggedInGuid } }],
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
        }));

    const verification = await verifyYahooLeagueMembership(env, USER_ID, LEAGUE_KEY);
    expect(verification).toMatchObject({
      evidence: {
        directIsOwnedByCurrentLogin: false,
        managerGuidComparison: 'does_not_match_authenticated_yahoo_guid',
      },
    });
  });

  it('preserves a logged-in GUID mismatch when Yahoo returns malformed user resources', async () => {
    const loggedInGuid = 'logged-in-yahoo-guid';
    fetchSpy.mockImplementation(async (input: unknown) => String(input).includes('/users;')
      ? json({
          fantasy_content: {
            users: {
              count: 1,
              0: { user: [{ guid: loggedInGuid }, null] },
            },
          },
        })
      : json(directTeamsPayload(0, STORED_GUID)));

    const verification = await verifyYahooLeagueMembership(env, USER_ID, LEAGUE_KEY);
    expect(verification).toMatchObject({
      stage: 'completed',
      evidence: {
        requestedLeagueInUserScopedTeams: null,
        directIsOwnedByCurrentLogin: false,
        managerGuidComparison: 'does_not_match_authenticated_yahoo_guid',
      },
    });

    const serialized = JSON.stringify(verification);
    const log = logSpy.mock.calls.map(([line]) => String(line)).join('\n');
    expect(log).toContain('"scoped_parse":"invalid_user_resources"');
    for (const forbidden of [
      LEAGUE_KEY, TEAM_KEY, STORED_GUID, loggedInGuid,
      ACCESS_TOKEN, REFRESH_TOKEN, LEAGUE_NAME, TEAM_NAME,
    ]) {
      expect(serialized).not.toContain(forbidden);
      expect(log).not.toContain(forbidden);
    }
  });

  it('keeps a GUID non-match inconclusive when direct manager metadata is incomplete', async () => {
    storage.getYahooCredentials.mockResolvedValue({
      clerkUserId: USER_ID,
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      yahooGuid: null,
      expiresAt: new Date(Date.now() + 60_000),
      needsRefresh: false,
    });
    fetchSpy.mockImplementation(async (input: unknown) => String(input).includes('/users;')
      ? json({
          fantasy_content: {
            users: {
              count: 1,
              0: {
                user: [
                  { guid: 'logged-in-yahoo-guid' },
                  { games: { count: 1, 0: { game: [{ game_key: '470' }, {}] } } },
                ],
              },
            },
          },
        })
      : json({
          fantasy_content: {
            league: [
              { league_key: LEAGUE_KEY },
              {
                teams: {
                  count: 1,
                  0: { team: [{ team_key: TEAM_KEY }, { is_owned_by_current_login: 0 }] },
                },
              },
            ],
          },
        }));

    const verification = await verifyYahooLeagueMembership(env, USER_ID, LEAGUE_KEY);
    expect(verification).toMatchObject({
      stage: 'completed',
      evidence: {
        requestedLeagueInUserScopedTeams: null,
        directIsOwnedByCurrentLogin: false,
        managerGuidComparison: 'unavailable',
      },
    });
    const report = await runYahooSupportVerifyLeagueMembership(
      env as unknown as YahooSupportEnv,
      { userId: USER_ID, leagueKey: LEAGUE_KEY },
      { verify: vi.fn().mockResolvedValue(verification) },
    );
    expect(report).toMatchObject({ interpretation: { category: 'inconclusive' } });
    expect(logSpy.mock.calls.map(([line]) => String(line)).join('\n'))
      .toContain('"direct_manager_parse":"incomplete"');
  });

  it.each([
    ['zero managers', [
      { managers: { count: 0 } },
    ]],
    ['contradictory manager count', [
      { managers: { count: 0, 0: { manager: [{ guid: 'league-manager-guid' }] } } },
    ]],
    ['manager missing its GUID', [
      { managers: { count: 1, 0: { manager: [{}] } } },
    ]],
    ['blank manager GUID', [
      { managers: { count: 1, 0: { manager: [{ guid: '   ' }] } } },
    ]],
    ['multiple GUIDs in one manager entity', [
      { managers: { count: 1, 0: { manager: [{ guid: 'first-guid' }, { guid: 'second-guid' }] } } },
    ]],
    ['duplicate manager collections', [
      { managers: { count: 1, 0: { manager: [{ guid: 'league-manager-guid' }] } } },
      { managers: { count: 1, 0: { manager: [{ guid: 'second-manager-guid' }] } } },
    ]],
  ])('requires complete manager evidence before a decisive mismatch: %s', async (_label, managerEntries) => {
    storage.getYahooCredentials.mockResolvedValue({
      clerkUserId: USER_ID,
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      yahooGuid: null,
      expiresAt: new Date(Date.now() + 60_000),
      needsRefresh: false,
    });
    fetchSpy.mockImplementation(async (input: unknown) => String(input).includes('/users;')
      ? json({
          fantasy_content: {
            users: {
              count: 1,
              0: {
                user: [
                  { guid: 'logged-in-yahoo-guid' },
                  { games: { count: 1, 0: { game: [{ game_key: '470' }, {}] } } },
                ],
              },
            },
          },
        })
      : json({
          fantasy_content: {
            league: [
              { league_key: LEAGUE_KEY },
              {
                teams: {
                  count: 1,
                  0: {
                    team: [
                      { team_key: TEAM_KEY },
                      { is_owned_by_current_login: 0 },
                      ...managerEntries,
                    ],
                  },
                },
              },
            ],
          },
        }));

    const verification = await verifyYahooLeagueMembership(env, USER_ID, LEAGUE_KEY);
    expect(verification).toMatchObject({
      evidence: { managerGuidComparison: 'unavailable' },
    });
    expect(logSpy.mock.calls.map(([line]) => String(line)).join('\n'))
      .toContain('"direct_manager_parse":"incomplete"');
  });

  it.each([
    ['multiple users', {
      fantasy_content: {
        users: {
          count: 2,
          0: { user: [{ guid: 'first-guid' }, { games: { count: 0 } }] },
          1: { user: [{ guid: STORED_GUID }, { games: { count: 0 } }] },
        },
      },
    }],
    ['missing authenticated GUID', {
      fantasy_content: {
        users: { count: 1, 0: { user: [{}, { games: { count: 0 } }] } },
      },
    }],
    ['blank authenticated GUID', {
      fantasy_content: {
        users: { count: 1, 0: { user: [{ guid: '   ' }, { games: { count: 0 } }] } },
      },
    }],
    ['multiple authenticated GUIDs', {
      fantasy_content: {
        users: {
          count: 1,
          0: { user: [[{ guid: 'first-guid' }, { guid: STORED_GUID }], { games: { count: 0 } }] },
        },
      },
    }],
  ])('does not infer a mismatch from incomplete authenticated identity evidence: %s', async (_label, scopedPayload) => {
    storage.getYahooCredentials.mockResolvedValue({
      clerkUserId: USER_ID,
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      yahooGuid: null,
      expiresAt: new Date(Date.now() + 60_000),
      needsRefresh: false,
    });
    fetchSpy.mockImplementation(async (input: unknown) => String(input).includes('/users;')
      ? json(scopedPayload)
      : json(directTeamsPayload(0, 'different-league-manager-guid')));

    const verification = await verifyYahooLeagueMembership(env, USER_ID, LEAGUE_KEY);
    expect(verification).toMatchObject({
      stage: 'completed',
      evidence: {
        requestedLeagueInUserScopedTeams: null,
        directIsOwnedByCurrentLogin: false,
        managerGuidComparison: 'unavailable',
      },
    });
    const report = await runYahooSupportVerifyLeagueMembership(
      env as unknown as YahooSupportEnv,
      { userId: USER_ID, leagueKey: LEAGUE_KEY },
      { verify: vi.fn().mockResolvedValue(verification) },
    );
    expect(report).toMatchObject({ interpretation: { category: 'inconclusive' } });
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
    if (category === 'membership_confirmed_collection_omitted') {
      expect(report).toMatchObject({
        interpretation: {
          nextAction:
            'Use the approved guarded exact-key recovery path for this confirmed league. Do not run a broad discovery refresh or prompt for reconnect.',
        },
      });
    }
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

  it('keeps a direct ownership confirmation when manager GUID evidence conflicts', async () => {
    const completed: YahooSupportLeagueMembershipVerification = {
      stage: 'completed',
      calls: [
        { label: 'league_teams', httpStatus: 200, ok: true, bodyIsJson: true, bodyLooksLikeEnvelope: true, errorSnippetCategory: 'none', durationMs: 1 },
        { label: 'user_game_teams', httpStatus: 200, ok: true, bodyIsJson: true, bodyLooksLikeEnvelope: true, errorSnippetCategory: 'none', durationMs: 1 },
      ],
      evidence: {
        requestedLeagueInUserScopedTeams: false,
        directIsOwnedByCurrentLogin: true,
        managerGuidComparison: 'does_not_match_authenticated_yahoo_guid',
      },
    };
    const report = await runYahooSupportVerifyLeagueMembership(
      env as unknown as YahooSupportEnv,
      { userId: USER_ID, leagueKey: LEAGUE_KEY },
      { verify: vi.fn().mockResolvedValue(completed) },
    );
    expect(report).toMatchObject({
      collection: 'omits_requested_team',
      interpretation: { category: 'membership_confirmed_collection_omitted' },
    });
  });
});
