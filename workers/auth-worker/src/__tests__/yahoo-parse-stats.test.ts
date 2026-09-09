import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createYahooParseStats,
  parseYahooLeaguesResponse,
  type YahooParseStats,
} from '../yahoo-connect-handlers';

/**
 * Diagnostics for the Yahoo league parser (FLA-360).
 *
 * The first block is the regression guard that makes the whole instrumentation
 * safe to ship: the persisted discovery path calls the parser with no `stats`
 * argument, and for every fixture the existing suites already drive through it,
 * that call must return exactly what it returned before. The remaining blocks
 * cover the stats themselves.
 */

// ---------------------------------------------------------------------------
// Fixtures reused verbatim from the suites that already exercise this parser.
// ---------------------------------------------------------------------------

/** yahoo-connect-handlers.test.ts — the empty-account discovery response. */
const EMPTY_USERS_FIXTURE = { fantasy_content: { users: { count: 0 } } };

/** yahoo-connect-handlers.test.ts — "stores historical multi-sport league and team associations". */
const MULTI_SPORT_FIXTURE = {
  fantasy_content: {
    users: {
      count: 1,
      0: {
        user: [
          { guid: 'guid-123' },
          {
            games: {
              count: 2,
              0: {
                game: [
                  { code: 'nfl', season: '2026', game_type: 'full' },
                  {
                    leagues: {
                      count: 1,
                      0: {
                        league: [
                          { league_key: '461.l.123', name: 'Football League', renew: '' },
                          {
                            teams: {
                              count: 1,
                              0: {
                                team: [[
                                  { team_key: '461.l.123.t.3' },
                                  { team_id: '3' },
                                  { name: 'Football Team' },
                                ]],
                              },
                            },
                          },
                        ],
                      },
                    },
                  },
                ],
              },
              1: {
                game: [
                  { code: 'mlb', season: '2007', game_type: 'full' },
                  {
                    leagues: {
                      count: 1,
                      0: {
                        league: [
                          { league_key: '175.l.456', name: 'Baseball League', renew: '' },
                          {
                            teams: {
                              count: 1,
                              0: {
                                team: [[
                                  { team_key: '175.l.456.t.7' },
                                  { team_id: '7' },
                                  { name: 'Baseball Team' },
                                ]],
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
        ],
      },
    },
  },
};

/** yahoo-archive-resolution.test.ts — one NFL league carrying a renew pointer, no teams block. */
const RENEW_POINTER_FIXTURE = {
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
                  { code: 'nfl', season: '2026' },
                  {
                    leagues: {
                      count: 1,
                      0: {
                        league: [
                          { league_key: '461.l.999', name: 'Zombie League', renew: '449_999', renewed: '' },
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

/** yahoo-archive-resolution.test.ts — two leagues under one game. */
const TWO_LEAGUE_FIXTURE = {
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
                  { code: 'nfl', season: '2026' },
                  {
                    leagues: {
                      count: 2,
                      0: { league: [{ league_key: '461.l.1', name: 'League A', renew: '449_1', renewed: '' }] },
                      1: { league: [{ league_key: '461.l.2', name: 'League B', renew: '449_2', renewed: '' }] },
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

const REGRESSION_FIXTURES: Array<{ name: string; data: unknown; expected: unknown[] }> = [
  { name: 'empty users collection', data: EMPTY_USERS_FIXTURE, expected: [] },
  { name: 'no fantasy_content', data: {}, expected: [] },
  { name: 'null input', data: null, expected: [] },
  {
    name: 'multi-sport history with teams',
    data: MULTI_SPORT_FIXTURE,
    expected: [
      {
        sport: 'football',
        seasonYear: 2026,
        leagueKey: '461.l.123',
        leagueName: 'Football League',
        teamId: '3',
        teamKey: '461.l.123.t.3',
        teamName: 'Football Team',
        renew: '',
      },
      {
        sport: 'baseball',
        seasonYear: 2007,
        leagueKey: '175.l.456',
        leagueName: 'Baseball League',
        teamId: '7',
        teamKey: '175.l.456.t.7',
        teamName: 'Baseball Team',
        renew: '',
      },
    ],
  },
  {
    name: 'renew pointer without a teams block',
    data: RENEW_POINTER_FIXTURE,
    expected: [
      {
        sport: 'football',
        seasonYear: 2026,
        leagueKey: '461.l.999',
        leagueName: 'Zombie League',
        teamId: '',
        teamKey: '',
        teamName: '',
        renew: '449_999',
      },
    ],
  },
  {
    name: 'two leagues under one game',
    data: TWO_LEAGUE_FIXTURE,
    expected: [
      {
        sport: 'football',
        seasonYear: 2026,
        leagueKey: '461.l.1',
        leagueName: 'League A',
        teamId: '',
        teamKey: '',
        teamName: '',
        renew: '449_1',
      },
      {
        sport: 'football',
        seasonYear: 2026,
        leagueKey: '461.l.2',
        leagueName: 'League B',
        teamId: '',
        teamKey: '',
        teamName: '',
        renew: '449_2',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Small builders for the counter tests.
// ---------------------------------------------------------------------------

function envelope(users: unknown): unknown {
  return { fantasy_content: { users } };
}

/** One user whose games collection is exactly `games`. */
function oneUserWithGames(games: unknown): unknown {
  return envelope({ count: 1, 0: { user: [{ guid: 'guid-1' }, { games }] } });
}

/** One game (`gameInfo` + `leagues`) under one user. */
function oneGame(gameInfo: unknown, leagues: unknown): unknown {
  return oneUserWithGames({ count: 1, 0: { game: [gameInfo, { leagues }] } });
}

/** Games built from a list of game-info objects, each with an empty leagues collection. */
function gamesFromInfos(infos: unknown[]): unknown {
  const games: Record<string, unknown> = { count: infos.length };
  infos.forEach((info, index) => {
    games[String(index)] = { game: [info, { leagues: { count: 0 } }] };
  });
  return oneUserWithGames(games);
}

function statsFor(data: unknown): { stats: YahooParseStats; leagues: unknown[] } {
  const stats = createYahooParseStats();
  const leagues = parseYahooLeaguesResponse(data, stats);
  return { stats, leagues };
}

const NO_SKIPS: YahooParseStats['skipped'] = {
  userMissingShape: 0,
  gamesCollectionMissing: 0,
  gameMissingShape: 0,
  leaguesCollectionMissing: 0,
  unsupportedSportCode: 0,
  unparseableSeason: 0,
  leagueMissingShape: 0,
  leagueMissingKeyOrName: 0,
};

/** The whole `skipped` block with exactly one counter set — "this branch and nothing else". */
function onlySkip(key: keyof YahooParseStats['skipped'], value = 1): YahooParseStats['skipped'] {
  return { ...NO_SKIPS, [key]: value };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseYahooLeaguesResponse without a stats argument (regression guard)', () => {
  it.each(REGRESSION_FIXTURES)('returns the unchanged result for $name', ({ data, expected }) => {
    expect(parseYahooLeaguesResponse(data)).toEqual(expected);
  });

  it.each(REGRESSION_FIXTURES)('produces a byte-identical result with and without stats for $name', ({ data }) => {
    const withoutStats = parseYahooLeaguesResponse(data);
    const withStats = parseYahooLeaguesResponse(data, createYahooParseStats());

    expect(JSON.stringify(withStats)).toBe(JSON.stringify(withoutStats));
  });

  it('leaves a supplied stats object untouched by a second no-stats call', () => {
    const stats = createYahooParseStats();
    parseYahooLeaguesResponse(MULTI_SPORT_FIXTURE, stats);
    const afterInstrumented = JSON.stringify(stats);

    parseYahooLeaguesResponse(MULTI_SPORT_FIXTURE);

    expect(JSON.stringify(stats)).toBe(afterInstrumented);
  });
});

describe('createYahooParseStats', () => {
  it('starts empty, with the envelope at its "nothing validated yet" state', () => {
    expect(createYahooParseStats()).toEqual({
      envelope: 'missing_fantasy_content',
      declared: { users: 0, games: 0, leagues: 0 },
      indexed: { users: 0, games: 0, leagues: 0 },
      skipped: NO_SKIPS,
      unsupportedGameCodes: [],
      acceptedSports: {},
      acceptedSeasonRange: null,
      accepted: 0,
      threw: false,
      thrownErrorName: null,
    });
  });

  it('hands out an independent object each call', () => {
    const first = createYahooParseStats();
    const second = createYahooParseStats();
    first.accepted = 5;
    first.unsupportedGameCodes.push('pickem');

    expect(second.accepted).toBe(0);
    expect(second.unsupportedGameCodes).toEqual([]);
  });
});

describe('envelope classification', () => {
  it('reports a missing fantasy_content top level', () => {
    expect(statsFor({}).stats.envelope).toBe('missing_fantasy_content');
    expect(statsFor(null).stats.envelope).toBe('missing_fantasy_content');
    expect(statsFor({ fantasy_content: null }).stats.envelope).toBe('missing_fantasy_content');
  });

  it('reports a present envelope with no users collection', () => {
    expect(statsFor({ fantasy_content: {} }).stats.envelope).toBe('missing_users');
    expect(statsFor({ fantasy_content: { users: null } }).stats.envelope).toBe('missing_users');
  });

  it('reports a valid envelope even when it carries no leagues', () => {
    const { stats } = statsFor(EMPTY_USERS_FIXTURE);

    expect(stats.envelope).toBe('valid');
    expect(stats.declared).toEqual({ users: 0, games: 0, leagues: 0 });
    expect(stats.accepted).toBe(0);
  });
});

describe('accepted-league tallies', () => {
  it('matches the returned array and records sports and the season range', () => {
    const { stats, leagues } = statsFor(MULTI_SPORT_FIXTURE);

    expect(stats.accepted).toBe(leagues.length);
    expect(stats.accepted).toBe(2);
    expect(stats.acceptedSports).toEqual({ football: 1, baseball: 1 });
    expect(stats.acceptedSeasonRange).toEqual({ min: 2007, max: 2026 });
    expect(stats.declared).toEqual({ users: 1, games: 2, leagues: 2 });
    expect(stats.indexed).toEqual({ users: 1, games: 2, leagues: 2 });
    expect(stats.skipped).toEqual(NO_SKIPS);
    expect(stats.threw).toBe(false);
  });

  it('collapses a single accepted season into a min/max pair', () => {
    const { stats } = statsFor(TWO_LEAGUE_FIXTURE);

    expect(stats.acceptedSeasonRange).toEqual({ min: 2026, max: 2026 });
    expect(stats.acceptedSports).toEqual({ football: 2 });
  });
});

describe('skip counters', () => {
  it('counts a user entry with no user array', () => {
    const { stats } = statsFor(envelope({ count: 1, 0: {} }));

    expect(stats.skipped).toEqual(onlySkip('userMissingShape'));
    expect(stats.declared.users).toBe(1);
  });

  it('counts a user array too short to hold games', () => {
    const { stats } = statsFor(envelope({ count: 1, 0: { user: [{ guid: 'guid-1' }] } }));

    expect(stats.skipped).toEqual(onlySkip('userMissingShape'));
  });

  it('counts a user with no games collection', () => {
    const { stats } = statsFor(envelope({ count: 1, 0: { user: [{ guid: 'guid-1' }, {}] } }));

    expect(stats.skipped).toEqual(onlySkip('gamesCollectionMissing'));
    expect(stats.declared.games).toBe(0);
  });

  it('counts a game entry with no game array', () => {
    const { stats } = statsFor(oneUserWithGames({ count: 1, 0: {} }));

    expect(stats.skipped).toEqual(onlySkip('gameMissingShape'));
    expect(stats.declared.games).toBe(1);
  });

  it('counts a game array too short to hold leagues', () => {
    const { stats } = statsFor(oneUserWithGames({ count: 1, 0: { game: [{ code: 'nfl', season: '2026' }] } }));

    expect(stats.skipped).toEqual(onlySkip('gameMissingShape'));
  });

  it('counts a game with no leagues collection', () => {
    const { stats } = statsFor(
      oneUserWithGames({ count: 1, 0: { game: [{ code: 'nfl', season: '2026' }, {}] } })
    );

    expect(stats.skipped).toEqual(onlySkip('leaguesCollectionMissing'));
    expect(stats.declared.leagues).toBe(0);
  });

  it('counts an unsupported sport code and nothing else', () => {
    const { stats } = statsFor(oneGame({ code: 'pickem', season: '2026' }, { count: 0 }));

    expect(stats.skipped).toEqual(onlySkip('unsupportedSportCode'));
    expect(stats.unsupportedGameCodes).toEqual(['pickem']);
  });

  it('counts an unparseable season and nothing else', () => {
    const { stats } = statsFor(oneGame({ code: 'nfl', season: 'not-a-year' }, { count: 0 }));

    expect(stats.skipped).toEqual(onlySkip('unparseableSeason'));
    expect(stats.unsupportedGameCodes).toEqual([]);
  });

  it('attributes a game that is both unsupported and unparseable to the sport code only', () => {
    const { stats } = statsFor(oneGame({ code: 'pickem', season: 'not-a-year' }, { count: 0 }));

    expect(stats.skipped).toEqual(onlySkip('unsupportedSportCode'));
  });

  it('counts a league entry with no league array', () => {
    const { stats } = statsFor(oneGame({ code: 'nfl', season: '2026' }, { count: 1, 0: {} }));

    expect(stats.skipped).toEqual(onlySkip('leagueMissingShape'));
    expect(stats.declared.leagues).toBe(1);
  });

  it('counts an empty league array', () => {
    const { stats } = statsFor(oneGame({ code: 'nfl', season: '2026' }, { count: 1, 0: { league: [] } }));

    expect(stats.skipped).toEqual(onlySkip('leagueMissingShape'));
  });

  it('counts a league missing its key or its name', () => {
    const missingName = statsFor(
      oneGame({ code: 'nfl', season: '2026' }, { count: 1, 0: { league: [{ league_key: '461.l.1' }] } })
    );
    const missingKey = statsFor(
      oneGame({ code: 'nfl', season: '2026' }, { count: 1, 0: { league: [{ name: 'League A' }] } })
    );

    expect(missingName.stats.skipped).toEqual(onlySkip('leagueMissingKeyOrName'));
    expect(missingKey.stats.skipped).toEqual(onlySkip('leagueMissingKeyOrName'));
    expect(missingName.leagues).toEqual([]);
  });
});

describe('indexed entry counts', () => {
  it('counts league entries Yahoo declared as zero (the count||0 swallow signal)', () => {
    const { stats, leagues } = statsFor(
      oneGame({ code: 'nfl', season: '2026' }, {
        // No `count` at all — the parser's `count || 0` walks nothing.
        0: { league: [{ league_key: '461.l.1', name: 'League A' }] },
        1: { league: [{ league_key: '461.l.2', name: 'League B' }] },
      })
    );

    expect(leagues).toEqual([]);
    expect(stats.declared.leagues).toBe(0);
    expect(stats.indexed.leagues).toBe(2);
    expect(stats.accepted).toBe(0);
    expect(stats.skipped).toEqual(NO_SKIPS);
  });

  it('counts games and users independently of their declared counts', () => {
    const { stats } = statsFor(
      envelope({
        0: { user: [{ guid: 'guid-1' }, { games: { 0: {}, 1: {}, 2: {} } }] },
        1: { user: [{ guid: 'guid-2' }, { games: { 0: {} } }] },
      })
    );

    expect(stats.declared.users).toBe(0);
    expect(stats.indexed.users).toBe(2);
    // Games are only reachable through a walked user, and no user was walked.
    expect(stats.indexed.games).toBe(0);
  });

  it('ignores non-numeric keys when counting entries', () => {
    const { stats } = statsFor(
      envelope({ count: 1, 0: { user: [{ guid: 'guid-1' }, { games: { count: 0, foo: {}, '01': {}, '1x': {} } }] } })
    );

    // '0' is absent; 'count', 'foo' and '1x' are not indexed entries. '01' is.
    expect(stats.indexed.games).toBe(1);
  });

  it('counts indexed leagues even for a game dropped on its sport code', () => {
    const { stats } = statsFor(
      oneGame({ code: 'pickem', season: '2026' }, {
        count: 2,
        0: { league: [{ league_key: 'pickem.l.1', name: 'Pick A' }] },
        1: { league: [{ league_key: 'pickem.l.2', name: 'Pick B' }] },
      })
    );

    expect(stats.declared.leagues).toBe(2);
    expect(stats.indexed.leagues).toBe(2);
    expect(stats.accepted).toBe(0);
    expect(stats.skipped.unsupportedSportCode).toBe(1);
  });
});

describe('unsupportedGameCodes', () => {
  it('lowercases and dedupes the codes it records', () => {
    const { stats } = statsFor(
      gamesFromInfos([
        { code: 'PICKEM', season: '2026' },
        { code: 'pickem', season: '2025' },
        { code: 'nflp', season: '2026' },
      ])
    );

    expect(stats.unsupportedGameCodes).toEqual(['pickem', 'nflp']);
    expect(stats.skipped.unsupportedSportCode).toBe(3);
  });

  it('caps the list at 20 distinct codes while still counting every skip', () => {
    const infos = Array.from({ length: 25 }, (_, index) => ({ code: `zz${index}`, season: '2026' }));
    const { stats } = statsFor(gamesFromInfos(infos));

    expect(stats.unsupportedGameCodes).toHaveLength(20);
    expect(stats.unsupportedGameCodes).toEqual(infos.slice(0, 20).map((info) => info.code));
    expect(stats.skipped.unsupportedSportCode).toBe(25);
  });

  it('records nothing for a non-string game code', () => {
    // `code: undefined` leaves gameCode undefined; the game is still skipped.
    const { stats } = statsFor(gamesFromInfos([{ season: '2026' }]));

    expect(stats.unsupportedGameCodes).toEqual([]);
    expect(stats.skipped.unsupportedSportCode).toBe(1);
  });
});

describe('the thrown-error path', () => {
  class SentinelParseError extends Error {
    override name = 'SentinelParseError';
  }

  const SECRET_MESSAGE = 'league 461.l.777 "Private Dynasty" blew up';

  /** One good league, then a getter that throws while reading the next one. */
  function throwingFixture(): unknown {
    return oneGame({ code: 'nfl', season: '2026' }, {
      count: 2,
      0: { league: [{ league_key: '461.l.123', name: 'Football League' }] },
      get 1() {
        throw new SentinelParseError(SECRET_MESSAGE);
      },
    });
  }

  it('still returns the leagues accumulated before the throw', () => {
    const { stats, leagues } = statsFor(throwingFixture());

    expect(leagues).toHaveLength(1);
    expect(stats.accepted).toBe(1);
    expect(stats.threw).toBe(true);
  });

  it('records the error name only, never its message', () => {
    const { stats } = statsFor(throwingFixture());

    expect(stats.thrownErrorName).toBe('SentinelParseError');
    expect(JSON.stringify(stats)).not.toContain(SECRET_MESSAGE);
    expect(JSON.stringify(stats)).not.toContain('461.l.777');
    expect(JSON.stringify(stats)).not.toContain('Private Dynasty');
  });

  it('names a non-Error throw "unknown"', () => {
    const { stats } = statsFor(
      oneGame({ code: 'nfl', season: '2026' }, {
        count: 1,
        get 0(): unknown {
          throw 'a bare string';
        },
      })
    );

    expect(stats.threw).toBe(true);
    expect(stats.thrownErrorName).toBe('unknown');
  });

  it('leaves threw false on a clean parse', () => {
    const { stats } = statsFor(MULTI_SPORT_FIXTURE);

    expect(stats.threw).toBe(false);
    expect(stats.thrownErrorName).toBeNull();
  });
});
