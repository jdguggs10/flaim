import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { createGetMatchupsHandler } from '../handlers/get-matchups';
import type { YahooHandlerContext } from '../handlers/types';
import type { ToolParams } from '../../types';
import { getYahooCredentials } from '../auth';
import { yahooFetch } from '../yahoo-api';

vi.mock('../auth', () => ({
  getYahooCredentials: vi.fn(),
  resolveUserTeamKey: vi.fn(),
}));

vi.mock('../yahoo-api', async () => {
  const actual = await vi.importActual('../yahoo-api') as Record<string, unknown>;
  return {
    ...actual,
    yahooFetch: vi.fn(),
  };
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const HOME_TEAM_KEY = '449.l.777.t.1';
const AWAY_TEAM_KEY = '449.l.777.t.2';

// 12 stats: 10 scored (mixed batting/pitching) + 2 display-only (H/AB, IP).
// AVG (stat_id 5) is sent as a NUMBER here — the rest are strings — to
// exercise Yahoo's inconsistent stat_id encoding.
const CATEGORY_STATS: Array<{ statId: string | number; home: string; away: string }> = [
  { statId: '1', home: '45', away: '38' }, // R
  { statId: '2', home: '12', away: '9' }, // HR
  { statId: '3', home: '50', away: '40' }, // RBI
  { statId: '4', home: '8', away: '5' }, // SB
  { statId: 5, home: '.280', away: '.255' }, // AVG (number stat_id)
  { statId: '6', home: '5', away: '3' }, // W
  { statId: '7', home: '3', away: '1' }, // SV
  { statId: '8', home: '4.10', away: '3.20' }, // ERA (away wins — lower is better)
  { statId: '9', home: '1.25', away: '1.25' }, // WHIP (tied)
  { statId: '10', home: '40', away: '55' }, // K (away wins)
  { statId: '11', home: '150/500', away: '140/480' }, // H/AB (display-only, no stat_winner)
  { statId: '12', home: '60.0', away: '58.0' }, // IP (display-only, no stat_winner)
];

function buildTeamStats(side: 'home' | 'away') {
  return {
    coverage_type: 'week',
    week: '5',
    stats: CATEGORY_STATS.map(({ statId, home, away }) => ({
      stat: { stat_id: statId, value: side === 'home' ? home : away },
    })),
  };
}

// Home wins R/HR/RBI/SB/AVG/W/SV (7), away wins ERA/K (2), WHIP ties (1) —
// matching the team_points.total "categories won" counts below (7 / 2).
const STAT_WINNERS = [
  { stat_winner: { stat_id: '1', winner_team_key: HOME_TEAM_KEY } },
  { stat_winner: { stat_id: '2', winner_team_key: HOME_TEAM_KEY } },
  { stat_winner: { stat_id: '3', winner_team_key: HOME_TEAM_KEY } },
  { stat_winner: { stat_id: '4', winner_team_key: HOME_TEAM_KEY } },
  { stat_winner: { stat_id: 5, winner_team_key: HOME_TEAM_KEY } },
  { stat_winner: { stat_id: '6', winner_team_key: HOME_TEAM_KEY } },
  { stat_winner: { stat_id: '7', winner_team_key: HOME_TEAM_KEY } },
  { stat_winner: { stat_id: '8', winner_team_key: AWAY_TEAM_KEY } },
  { stat_winner: { stat_id: '9', is_tied: 1 } },
  { stat_winner: { stat_id: '10', winner_team_key: AWAY_TEAM_KEY } },
];

function buildCategoriesScoreboard({ statWinners }: { statWinners: boolean }): unknown {
  return {
    fantasy_content: {
      league: [
        { league_key: '449.l.777', name: 'Category League', scoring_type: 'head', current_week: 5 },
        {
          scoreboard: {
            '0': {
              matchups: {
                '0': {
                  matchup: {
                    '0': {
                      teams: {
                        '0': {
                          team: [
                            [{ team_key: HOME_TEAM_KEY, team_id: '1', name: 'Team A' }],
                            { team_points: { total: '7' }, team_stats: buildTeamStats('home') },
                          ],
                        },
                        '1': {
                          team: [
                            [{ team_key: AWAY_TEAM_KEY, team_id: '2', name: 'Team B' }],
                            { team_points: { total: '2' }, team_stats: buildTeamStats('away') },
                          ],
                        },
                        count: 2,
                      },
                    },
                    ...(statWinners ? { stat_winners: STAT_WINNERS } : {}),
                  },
                },
                count: 1,
              },
            },
          },
        },
      ],
    },
  };
}

function buildHeadpointScoreboard(): unknown {
  return {
    fantasy_content: {
      league: [
        { league_key: '449.l.888', name: 'Points League', scoring_type: 'headpoint', current_week: 5 },
        {
          scoreboard: {
            '0': {
              matchups: {
                '0': {
                  matchup: {
                    '0': {
                      teams: {
                        '0': {
                          team: [
                            [{ team_key: '449.l.888.t.1', team_id: '1', name: 'Team C' }],
                            { team_points: { total: '243.90' }, team_stats: buildTeamStats('home') },
                          ],
                        },
                        '1': {
                          team: [
                            [{ team_key: '449.l.888.t.2', team_id: '2', name: 'Team D' }],
                            { team_points: { total: '198.40' }, team_stats: buildTeamStats('away') },
                          ],
                        },
                        count: 2,
                      },
                    },
                    // A verified headpoint capture carries stat_winners AND
                    // team_stats too — the gate must be scoring_type, never
                    // their presence.
                    stat_winners: STAT_WINNERS,
                  },
                },
                count: 1,
              },
            },
          },
        },
      ],
    },
  };
}

function buildRotoScoreboard(): unknown {
  return {
    fantasy_content: {
      league: [
        { league_key: '449.l.999', name: 'Roto League', scoring_type: 'roto', current_week: 5 },
        {
          scoreboard: { '0': { matchups: { count: 0 } } },
        },
      ],
    },
  };
}

function buildStatCategoriesSettingsResponse(): unknown {
  return {
    fantasy_content: {
      league: [
        { league_key: '449.l.777', name: 'Category League' },
        {
          settings: [
            {
              stat_categories: {
                stats: [
                  { stat: { stat_id: '1', name: 'Runs', display_name: 'R' } },
                  { stat: { stat_id: '2', name: 'Home Runs', display_name: 'HR' } },
                  { stat: { stat_id: '3', name: 'Runs Batted In', display_name: 'RBI' } },
                  { stat: { stat_id: '4', name: 'Stolen Bases', display_name: 'SB' } },
                  { stat: { stat_id: '5', name: 'Batting Average', display_name: 'AVG' } },
                  { stat: { stat_id: '6', name: 'Wins', display_name: 'W' } },
                  { stat: { stat_id: '7', name: 'Saves', display_name: 'SV' } },
                  { stat: { stat_id: '8', name: 'Earned Run Average', display_name: 'ERA' } },
                  { stat: { stat_id: '9', name: 'Walks Plus Hits Per Inning Pitched', display_name: 'WHIP' } },
                  { stat: { stat_id: '10', name: 'Strikeouts', display_name: 'K' } },
                  { stat: { stat_id: '11', name: 'Hits/At Bats', display_name: 'H/AB', is_only_display_stat: '1' } },
                  { stat: { stat_id: '12', name: 'Innings Pitched', display_name: 'IP', is_only_display_stat: '1' } },
                  // Present in settings but never sent on the scoreboard's
                  // own stat list — must not break the fallback.
                  { stat: { stat_id: '13', name: 'On-Base Plus Slugging', display_name: 'OPS' } },
                ],
              },
            },
            { min_games_played: '' },
          ],
        },
      ],
    },
  };
}

describe('yahoo get_matchups category scoring', () => {
  const getCredsMock = getYahooCredentials as MockedFunction<typeof getYahooCredentials>;
  const fetchMock = yahooFetch as MockedFunction<typeof yahooFetch>;
  const context: YahooHandlerContext = { sport: 'baseball', getPositionFilter: () => '' };
  const handler = createGetMatchupsHandler(context);

  beforeEach(() => {
    vi.clearAllMocks();
    getCredsMock.mockResolvedValue({ accessToken: 'token' });
  });

  it('emits scoringType "categories" with per-category rows and a stat_winners-derived categoryScore', async () => {
    fetchMock.mockImplementation(async (path: unknown) => {
      const p = path as string;
      return jsonResponse(p.includes('/settings') ? buildStatCategoriesSettingsResponse() : buildCategoriesScoreboard({ statWinners: true }));
    });

    const params: ToolParams = { sport: 'baseball', league_id: '449.l.777', season_year: 2025 };
    const result = await handler({} as never, params, 'Bearer x', 'cid-1');

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.scoringType).toBe('categories');
    expect(data.scoringTypeRaw).toBe('head');

    const matchup = (data.matchups as Array<Record<string, unknown>>)[0];
    expect(matchup.statWinnersAvailable).toBe(true);

    const home = matchup.home as Record<string, unknown>;
    const away = matchup.away as Record<string, unknown>;
    expect(home.categoryScore).toEqual({ wins: 7, losses: 2, ties: 1 });
    expect(away.categoryScore).toEqual({ wins: 2, losses: 7, ties: 1 });

    const homeCategories = home.categories as Array<Record<string, unknown>>;
    expect(homeCategories).toHaveLength(12);
    const runs = homeCategories.find((c) => c.statId === '1');
    expect(runs).toMatchObject({ displayName: 'R', value: '45', result: 'win' });
    const whip = homeCategories.find((c) => c.statId === '9');
    expect(whip).toMatchObject({ result: 'tie' });
  });

  it('names categories from /league/{key}/settings and flags display-only stats', async () => {
    fetchMock.mockImplementation(async (path: unknown) => {
      const p = path as string;
      return jsonResponse(p.includes('/settings') ? buildStatCategoriesSettingsResponse() : buildCategoriesScoreboard({ statWinners: true }));
    });

    const params: ToolParams = { sport: 'baseball', league_id: '449.l.777', season_year: 2025 };
    const result = await handler({} as never, params, 'Bearer x', 'cid-2');

    const data = result.data as Record<string, unknown>;
    expect(data.categoryNamesAvailable).toBe(true);
    const matchup = (data.matchups as Array<Record<string, unknown>>)[0];
    const home = matchup.home as Record<string, unknown>;
    const categories = home.categories as Array<Record<string, unknown>>;

    const avg = categories.find((c) => c.statId === '5');
    expect(avg).toMatchObject({ name: 'Batting Average', displayName: 'AVG', isDisplayOnly: false });

    const hAb = categories.find((c) => c.statId === '11');
    expect(hAb).toMatchObject({ name: 'Hits/At Bats', displayName: 'H/AB', isDisplayOnly: true, result: null });

    const ip = categories.find((c) => c.statId === '12');
    expect(ip).toMatchObject({ isDisplayOnly: true });
  });

  it('leaves categoryScore null and every category result null when Yahoo omits stat_winners, and never derives them from team_points.total', async () => {
    fetchMock.mockImplementation(async (path: unknown) => {
      const p = path as string;
      return jsonResponse(p.includes('/settings') ? buildStatCategoriesSettingsResponse() : buildCategoriesScoreboard({ statWinners: false }));
    });

    const params: ToolParams = { sport: 'baseball', league_id: '449.l.777', season_year: 2025 };
    const result = await handler({} as never, params, 'Bearer x', 'cid-3');

    const data = result.data as Record<string, unknown>;
    const matchup = (data.matchups as Array<Record<string, unknown>>)[0];
    expect(matchup.statWinnersAvailable).toBe(false);

    const home = matchup.home as Record<string, unknown>;
    const away = matchup.away as Record<string, unknown>;
    expect(home.categoryScore).toBeNull();
    expect(away.categoryScore).toBeNull();

    const homeCategories = home.categories as Array<Record<string, unknown>>;
    expect(homeCategories.every((c) => c.result === null)).toBe(true);

    // team_points.total is still preserved as points/categoriesWon — it is
    // never used to synthesize a categoryScore or per-category result.
    expect(home.points).toBe(7);
    expect(home.categoriesWon).toBe(7);
    expect(away.categoriesWon).toBe(2);
  });

  it('falls back to stat ids with categoryNamesAvailable false and a warning when the settings fetch fails', async () => {
    fetchMock.mockImplementation(async (path: unknown) => {
      const p = path as string;
      if (p.includes('/settings')) {
        return new Response('Not Found', { status: 404 });
      }
      return jsonResponse(buildCategoriesScoreboard({ statWinners: true }));
    });

    const params: ToolParams = { sport: 'baseball', league_id: '449.l.777', season_year: 2025 };
    const result = await handler({} as never, params, 'Bearer x', 'cid-4');

    const data = result.data as Record<string, unknown>;
    expect(data.categoryNamesAvailable).toBe(false);
    expect(data.warning).toContain('MATCHUP_CATEGORY_NAMES_UNAVAILABLE');

    const matchup = (data.matchups as Array<Record<string, unknown>>)[0];
    const home = matchup.home as Record<string, unknown>;
    const categories = home.categories as Array<Record<string, unknown>>;
    const runs = categories.find((c) => c.statId === '1');
    expect(runs).toMatchObject({ name: null, displayName: null });
  });

  it('normalizes numeric and string stat_id to the same string key', async () => {
    fetchMock.mockImplementation(async (path: unknown) => {
      const p = path as string;
      return jsonResponse(p.includes('/settings') ? buildStatCategoriesSettingsResponse() : buildCategoriesScoreboard({ statWinners: true }));
    });

    const params: ToolParams = { sport: 'baseball', league_id: '449.l.777', season_year: 2025 };
    const result = await handler({} as never, params, 'Bearer x', 'cid-5');

    const data = result.data as Record<string, unknown>;
    const matchup = (data.matchups as Array<Record<string, unknown>>)[0];
    const home = matchup.home as Record<string, unknown>;
    const categories = home.categories as Array<Record<string, unknown>>;

    // AVG carries a NUMBER stat_id (5) on the scoreboard's team_stats and a
    // STRING stat_id ('5') in the settings response and in stat_winners —
    // all three must resolve to the same category row.
    const avg = categories.find((c) => c.statId === '5');
    expect(avg).toBeDefined();
    expect(avg).toMatchObject({ name: 'Batting Average', displayName: 'AVG', result: 'win' });
  });

  it('does not emit categories for a headpoint league that still carries team_stats', async () => {
    fetchMock.mockResolvedValue(jsonResponse(buildHeadpointScoreboard()));

    const params: ToolParams = { sport: 'baseball', league_id: '449.l.888', season_year: 2025 };
    const result = await handler({} as never, params, 'Bearer x', 'cid-6');

    const data = result.data as Record<string, unknown>;
    expect(data.scoringType).toBe('points');
    expect(data.scoringTypeRaw).toBe('headpoint');
    expect(data.categoryNamesAvailable).toBeUndefined();

    const matchup = (data.matchups as Array<Record<string, unknown>>)[0];
    expect(matchup.statWinnersAvailable).toBeUndefined();

    const home = matchup.home as Record<string, unknown>;
    expect(home.points).toBe(243.9);
    expect(home.categories).toBeUndefined();
    expect(home.categoryScore).toBeUndefined();
    expect(home.categoriesWon).toBeUndefined();

    // The settings fetch is categories-only — a points league with
    // team_stats/stat_winners still present must not trigger it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports matchupsUnavailableReason NOT_HEAD_TO_HEAD for a roto league with an empty scoreboard', async () => {
    fetchMock.mockResolvedValue(jsonResponse(buildRotoScoreboard()));

    const params: ToolParams = { sport: 'baseball', league_id: '449.l.999', season_year: 2025 };
    const result = await handler({} as never, params, 'Bearer x', 'cid-7');

    const data = result.data as Record<string, unknown>;
    expect(data.scoringType).toBe('roto');
    expect(data.matchups).toEqual([]);
    expect(data.matchupsUnavailableReason).toBe('NOT_HEAD_TO_HEAD');
    expect(data.warning).toContain('MATCHUPS_NOT_HEAD_TO_HEAD');
    expect(data.warning).toContain('roto');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats an unknown scoring_type conservatively: no categories, points preserved', async () => {
    const response = {
      fantasy_content: {
        league: [
          { league_key: '449.l.555', name: 'One Win League', scoring_type: 'headone', current_week: 5 },
          {
            scoreboard: {
              '0': {
                matchups: {
                  '0': {
                    matchup: {
                      '0': {
                        teams: {
                          '0': {
                            team: [
                              [{ team_key: '449.l.555.t.1', team_id: '1', name: 'Team E' }],
                              { team_points: { total: '3' } },
                            ],
                          },
                          '1': {
                            team: [
                              [{ team_key: '449.l.555.t.2', team_id: '2', name: 'Team F' }],
                              { team_points: { total: '2' } },
                            ],
                          },
                          count: 2,
                        },
                      },
                    },
                  },
                  count: 1,
                },
              },
            },
          },
        ],
      },
    };
    fetchMock.mockResolvedValue(jsonResponse(response));

    const params: ToolParams = { sport: 'baseball', league_id: '449.l.555', season_year: 2025 };
    const result = await handler({} as never, params, 'Bearer x', 'cid-8');

    const data = result.data as Record<string, unknown>;
    expect(data.scoringType).toBe('unknown');
    expect(data.scoringTypeRaw).toBe('headone');
    expect(data.matchupsUnavailableReason).toBeUndefined();

    const matchup = (data.matchups as Array<Record<string, unknown>>)[0];
    const home = matchup.home as Record<string, unknown>;
    expect(home.points).toBe(3);
    expect(home.categories).toBeUndefined();
    expect(home.categoryScore).toBeUndefined();
    expect(home.categoriesWon).toBeUndefined();
    expect(matchup.statWinnersAvailable).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetches /settings only for a categories league, only once, and only after the scoreboard request', async () => {
    const calledPaths: string[] = [];
    fetchMock.mockImplementation(async (path: unknown) => {
      const p = path as string;
      calledPaths.push(p);
      return jsonResponse(p.includes('/settings') ? buildStatCategoriesSettingsResponse() : buildCategoriesScoreboard({ statWinners: true }));
    });

    const params: ToolParams = { sport: 'baseball', league_id: '449.l.777', season_year: 2025 };
    await handler({} as never, params, 'Bearer x', 'cid-9');

    expect(calledPaths).toHaveLength(2);
    expect(calledPaths[0]).toContain('/scoreboard');
    expect(calledPaths[1]).toContain('/settings');
  });

  it('keeps the raw team_points total as points and adds categoriesWon only on categories leagues', async () => {
    fetchMock.mockImplementation(async (path: unknown) => {
      const p = path as string;
      return jsonResponse(p.includes('/settings') ? buildStatCategoriesSettingsResponse() : buildCategoriesScoreboard({ statWinners: true }));
    });

    const categoriesParams: ToolParams = { sport: 'baseball', league_id: '449.l.777', season_year: 2025 };
    const categoriesResult = await handler({} as never, categoriesParams, 'Bearer x', 'cid-10a');
    const categoriesData = categoriesResult.data as Record<string, unknown>;
    const categoriesMatchup = (categoriesData.matchups as Array<Record<string, unknown>>)[0];
    const categoriesHome = categoriesMatchup.home as Record<string, unknown>;
    expect(categoriesHome.points).toBe(7);
    expect(categoriesHome.categoriesWon).toBe(7);

    vi.clearAllMocks();
    getCredsMock.mockResolvedValue({ accessToken: 'token' });
    fetchMock.mockResolvedValue(jsonResponse(buildHeadpointScoreboard()));

    const pointsParams: ToolParams = { sport: 'baseball', league_id: '449.l.888', season_year: 2025 };
    const pointsResult = await handler({} as never, pointsParams, 'Bearer x', 'cid-10b');
    const pointsData = pointsResult.data as Record<string, unknown>;
    const pointsMatchup = (pointsData.matchups as Array<Record<string, unknown>>)[0];
    const pointsHome = pointsMatchup.home as Record<string, unknown>;
    expect(pointsHome.points).toBe(243.9);
    expect(pointsHome.categoriesWon).toBeUndefined();
  });
});
