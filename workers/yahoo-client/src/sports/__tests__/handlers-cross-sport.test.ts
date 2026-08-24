import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { baseballHandlers } from '../baseball/handlers';
import { basketballHandlers } from '../basketball/handlers';
import { footballHandlers } from '../football/handlers';
import { hockeyHandlers } from '../hockey/handlers';
import type { ToolParams } from '../../types';
import { getYahooCredentials } from '../../shared/auth';
import { yahooFetch } from '../../shared/yahoo-api';

vi.mock('../../shared/auth', () => ({
  getYahooCredentials: vi.fn(),
  resolveUserTeamKey: vi.fn(),
}));

vi.mock('../../shared/yahoo-api', async () => {
  const actual = await vi.importActual('../../shared/yahoo-api') as Record<string, unknown>;
  return {
    ...actual,
    yahooFetch: vi.fn(),
  };
});

const scenarios = [
  { label: 'football', sport: 'football', handlers: footballHandlers },
  { label: 'baseball', sport: 'baseball', handlers: baseballHandlers },
  { label: 'basketball', sport: 'basketball', handlers: basketballHandlers },
  { label: 'hockey', sport: 'hockey', handlers: hockeyHandlers },
] as const;

const FREE_AGENT_POSITION_FILTER: Record<(typeof scenarios)[number]['sport'], string> = {
  football: 'WR',
  baseball: 'OF',
  basketball: 'PG',
  hockey: 'C',
};

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildLeagueInfoResponse(): unknown {
  return {
    fantasy_content: {
      league: [
        {
          league_key: '449.l.123',
          league_id: '123',
          name: 'Test League',
          url: 'https://example.com',
          num_teams: 10,
          scoring_type: 'head',
          current_week: 5,
          start_week: 1,
          end_week: 17,
          start_date: '2025-03-27',
          end_date: '2025-09-28',
          is_finished: 0,
          draft_status: 'postdraft',
        },
        {
          teams: {
            '0': {
              team: [
                [
                  { team_key: '449.l.123.t.1' },
                  { team_id: '1' },
                  { name: 'Team A' },
                  { managers: { '0': { manager: { manager_id: 'm1', nickname: 'Alice' } }, count: 1 } },
                ],
              ],
            },
            '1': {
              team: [
                [
                  { team_key: '449.l.123.t.2' },
                  { team_id: '2' },
                  { name: 'Team B' },
                  // No managers — tests graceful fallback
                ],
              ],
            },
            count: 2,
          },
        },
      ],
    },
  };
}

// FLA-284: shape verified against a real captured /league/{key}/settings
// fixture (hkyplyr/yahoo_fantasy_ex) — settings is a nested array (not a
// flat object), with a second element carrying unrelated per-week metadata.
function buildLeagueSettingsResponse(): unknown {
  return {
    fantasy_content: {
      league: [
        { league_key: '449.l.123', name: 'Test League' },
        {
          settings: [
            {
              draft_type: 'live',
              is_auction_draft: '0',
              can_trade_draft_picks: '1',
              trade_end_date: '2025-11-20',
              trade_ratify_type: 'commish',
              trade_reject_time: '2',
              uses_faab: '1',
            },
            { min_games_played: '' },
          ],
        },
      ],
    },
  };
}

function buildStandingsResponse(): unknown {
  return {
    fantasy_content: {
      league: [
        { league_key: '449.l.123', name: 'Test League' },
        {
          standings: [
            {
              teams: {
                '0': {
                  team: [
                    [{ team_key: '449.l.123.t.1', team_id: '1', name: 'Team A' }],
                    { team_standings: { rank: 1, outcome_totals: { wins: 8, losses: 2, ties: 0, percentage: '.800' }, points_for: '1200', points_against: '1000' } },
                  ],
                },
                '1': {
                  team: [
                    [{ team_key: '449.l.123.t.2', team_id: '2', name: 'Team B' }],
                    { team_standings: { rank: 2, outcome_totals: { wins: 6, losses: 4, ties: 0, percentage: '.600' }, points_for: '1100', points_against: '1050' } },
                  ],
                },
                count: 2,
              },
            },
          ],
        },
      ],
    },
  };
}

function buildRosterResponse(): unknown {
  return {
    fantasy_content: {
      team: [
        [
          { team_key: '449.l.123.t.1' },
          { name: 'Team A' },
          { managers: { '0': { manager: { manager_id: 'm1', nickname: 'Alice' } }, count: 1 } },
        ],
        {
          roster: {
            '0': {
              players: {
                '0': {
                  player: [
                    [{ player_key: 'p101', player_id: '101', name: { full: 'Player One' }, editorial_team_abbr: 'NYY', display_position: 'SS', status: 'healthy' }],
                    { selected_position: [{}, { position: 'SS' }] },
                  ],
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

// FLA-284: two roster players — one carrying Yahoo's undocumented is_keeper
// field (present-on-every-player-once-keeper-league shape verified against
// a real captured NHL roster fixture, folkg/auto-coach), one without it.
function buildRosterResponseWithKeeper(statusKept: unknown): unknown {
  return {
    fantasy_content: {
      team: [
        [
          { team_key: '449.l.123.t.1' },
          { name: 'Team A' },
        ],
        {
          roster: {
            '0': {
              players: {
                '0': {
                  player: [
                    [{
                      player_key: 'p101',
                      player_id: '101',
                      name: { full: 'Kept Player' },
                      editorial_team_abbr: 'PIT',
                      display_position: 'C',
                      status: 'healthy',
                      is_keeper: { status: statusKept, cost: false, kept: statusKept },
                    }],
                    { selected_position: [{}, { position: 'C' }] },
                  ],
                },
                '1': {
                  player: [
                    [{
                      player_key: 'p102',
                      player_id: '102',
                      name: { full: 'No Keeper Field' },
                      editorial_team_abbr: 'PIT',
                      display_position: 'LW',
                      status: 'healthy',
                    }],
                    { selected_position: [{}, { position: 'LW' }] },
                  ],
                },
                count: 2,
              },
            },
          },
        },
      ],
    },
  };
}

function buildMatchupsResponse(): unknown {
  return {
    fantasy_content: {
      league: [
        { league_key: '449.l.123', name: 'Test League', current_week: 5 },
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
                            [{ team_key: '449.l.123.t.1', team_id: '1', name: 'Team A' }],
                            { team_points: { total: '120.5' }, team_projected_points: { total: '115.0' } },
                          ],
                        },
                        '1': {
                          team: [
                            [{ team_key: '449.l.123.t.2', team_id: '2', name: 'Team B' }],
                            { team_points: { total: '105.3' }, team_projected_points: { total: '110.0' } },
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
}

function buildFreeAgentsResponse(): unknown {
  return {
    fantasy_content: {
      league: [
        { league_key: '449.l.123', name: 'Test League' },
        {
          players: {
            '0': {
              player: [
                [{ player_key: 'fa101', player_id: '201', name: { full: 'Free Agent' }, editorial_team_abbr: 'BOS', display_position: 'OF', status: undefined }],
                { ownership: { percent_owned: '12.5' } },
              ],
            },
            count: 1,
          },
        },
      ],
    },
  };
}

// FLA-284: same is_keeper shape as the roster fixture, on a free-agent entry.
function buildFreeAgentsResponseWithKeeper(): unknown {
  return {
    fantasy_content: {
      league: [
        { league_key: '449.l.123', name: 'Test League' },
        {
          players: {
            '0': {
              player: [
                [{
                  player_key: 'fa101',
                  player_id: '201',
                  name: { full: 'Free Agent Keeper' },
                  editorial_team_abbr: 'BOS',
                  display_position: 'OF',
                  is_keeper: { status: true, cost: false, kept: true },
                }],
                { ownership: { percent_owned: '12.5' } },
              ],
            },
            count: 1,
          },
        },
      ],
    },
  };
}

function buildFreeAgentsPageResponse(players: Array<{
  player_key: string;
  player_id: string;
  full_name: string;
  team: string;
  position: string;
  percent_owned?: string;
}>): unknown {
  const playersObj: Record<string, unknown> = {};

  players.forEach((player, index) => {
    playersObj[String(index)] = {
      player: [
        [{
          player_key: player.player_key,
          player_id: player.player_id,
          name: { full: player.full_name },
          editorial_team_abbr: player.team,
          display_position: player.position,
        }],
        player.percent_owned == null ? {} : { ownership: { percent_owned: player.percent_owned } },
      ],
    };
  });

  playersObj.count = players.length;

  return {
    fantasy_content: {
      league: [
        { league_key: '449.l.123', name: 'Test League' },
        { players: playersObj },
      ],
    },
  };
}

describe('yahoo cross-sport handler characterization tests', () => {
  const getCredsMock = getYahooCredentials as MockedFunction<typeof getYahooCredentials>;
  const fetchMock = yahooFetch as MockedFunction<typeof yahooFetch>;

  beforeEach(() => {
    vi.clearAllMocks();
    getCredsMock.mockResolvedValue({ accessToken: 'token' });
  });

  describe('get_league_info', () => {
    it.each(scenarios)('$label returns consistent league metadata shape', async ({ sport, handlers }) => {
      // get_league_info now fetches /teams then /settings sequentially
      // (FLA-284) — mockImplementation returns a fresh Response per call so
      // the second read doesn't hit a consumed body ("Body has already been
      // used") from mockResolvedValue's single shared Response. This request
      // doesn't exercise settings fields, so serving /teams-shaped JSON to
      // both calls is fine: extractLeagueSettings finds no settings key and
      // the handler degrades to its warning path, which these assertions
      // don't check.
      fetchMock.mockImplementation(async () => jsonResponse(buildLeagueInfoResponse()));

      const params: ToolParams = { sport, league_id: '449.l.123', season_year: 2025 };
      const result = await handlers.get_league_info({} as never, params, 'Bearer x', `cid-${sport}`);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.leagueKey).toBe('449.l.123');
      expect(data.name).toBe('Test League');
      expect(data.numTeams).toBe(10);
      expect(data.currentWeek).toBe(5);
      expect(data.isFinished).toBe(false);
      expect(data.draftStatus).toBe('postdraft');

      // Teams array with owner names from Yahoo's numeric-keyed managers
      const teams = data.teams as Array<{ teamId?: string; teamName?: string; ownerName?: string }>;
      expect(teams).toHaveLength(2);
      expect(teams[0]).toMatchObject({ teamId: '1', teamName: 'Team A', ownerName: 'Alice' });
      expect(teams[1]).toMatchObject({ teamId: '2', teamName: 'Team B' });
      expect(teams[1].ownerName).toBeUndefined();
    });

    it('baseball includes startDate and endDate', async () => {
      // get_league_info now fetches /teams then /settings sequentially
      // (FLA-284) — mockImplementation returns a fresh Response per call so
      // the second read doesn't hit a consumed body ("Body has already been
      // used") from mockResolvedValue's single shared Response. This request
      // doesn't exercise settings fields, so serving /teams-shaped JSON to
      // both calls is fine: extractLeagueSettings finds no settings key and
      // the handler degrades to its warning path, which these assertions
      // don't check.
      fetchMock.mockImplementation(async () => jsonResponse(buildLeagueInfoResponse()));

      const params: ToolParams = { sport: 'baseball', league_id: '449.l.123', season_year: 2025 };
      const result = await baseballHandlers.get_league_info({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.startDate).toBe('2025-03-27');
      expect(data.endDate).toBe('2025-09-28');
    });

    it.each(scenarios.filter(s => s.label !== 'baseball'))('$label does not include startDate/endDate', async ({ sport, handlers }) => {
      // get_league_info now fetches /teams then /settings sequentially
      // (FLA-284) — mockImplementation returns a fresh Response per call so
      // the second read doesn't hit a consumed body ("Body has already been
      // used") from mockResolvedValue's single shared Response. This request
      // doesn't exercise settings fields, so serving /teams-shaped JSON to
      // both calls is fine: extractLeagueSettings finds no settings key and
      // the handler degrades to its warning path, which these assertions
      // don't check.
      fetchMock.mockImplementation(async () => jsonResponse(buildLeagueInfoResponse()));

      const params: ToolParams = { sport, league_id: '449.l.123', season_year: 2025 };
      const result = await handlers.get_league_info({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.startDate).toBeUndefined();
      expect(data.endDate).toBeUndefined();
    });

    it.each(scenarios)('$label returns error when league_id is missing', async ({ sport, handlers }) => {
      const params: ToolParams = { sport, league_id: '', season_year: 2025 };
      const result = await handlers.get_league_info({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(false);
      expect(result.code).toBe('MISSING_PARAM');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // FLA-284: the new /settings fetch, keyed off the request path so the
    // /teams and /settings calls resolve to genuinely distinct Response
    // objects (unlike the single-mockResolvedValue scenarios above) — this
    // is what a real deployment does, and it exercises the merge logic
    // end-to-end rather than only the degrade path.
    it('includes draft/trade settings fields when the /settings fetch succeeds', async () => {
      fetchMock.mockImplementation(async (path: unknown) => {
        const p = path as string;
        return jsonResponse(p.includes('/settings') ? buildLeagueSettingsResponse() : buildLeagueInfoResponse());
      });

      const params: ToolParams = { sport: 'football', league_id: '449.l.123', season_year: 2025 };
      const result = await footballHandlers.get_league_info({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      // Pre-existing /teams-derived fields are unaffected.
      expect(data.leagueKey).toBe('449.l.123');
      expect((data.teams as unknown[]).length).toBe(2);
      // New settings-derived fields, normalized from Yahoo's string flags.
      expect(data.draftType).toBe('live');
      expect(data.isAuctionDraft).toBe(false);
      expect(data.canTradeDraftPicks).toBe(true);
      expect(data.tradeEndDate).toBe('2025-11-20');
      expect(data.tradeRatifyType).toBe('commish');
      expect(data.tradeRejectTime).toBe(2);
      expect(data.usesFaab).toBe(true);
      expect(data.warning).toBeUndefined();
    });

    it('degrades gracefully (teams-only + warning, no throw) when /settings returns a non-2xx response', async () => {
      fetchMock.mockImplementation(async (path: unknown) => {
        const p = path as string;
        if (p.includes('/settings')) {
          return new Response('Not Found', { status: 404 });
        }
        return jsonResponse(buildLeagueInfoResponse());
      });

      const params: ToolParams = { sport: 'football', league_id: '449.l.123', season_year: 2025 };
      const result = await footballHandlers.get_league_info({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.leagueKey).toBe('449.l.123');
      expect((data.teams as unknown[]).length).toBe(2);
      expect(data.draftType).toBeUndefined();
      expect(data.isAuctionDraft).toBeUndefined();
      expect(data.warning).toBe(
        'LEAGUE_SETTINGS_UNAVAILABLE: could not fetch league settings; draft/trade config fields omitted.'
      );
    });

    it('degrades gracefully (teams-only + warning, no throw) when the /settings fetch itself rejects', async () => {
      fetchMock.mockImplementation(async (path: unknown) => {
        const p = path as string;
        if (p.includes('/settings')) {
          throw new Error('network boom');
        }
        return jsonResponse(buildLeagueInfoResponse());
      });

      const params: ToolParams = { sport: 'football', league_id: '449.l.123', season_year: 2025 };
      const result = await footballHandlers.get_league_info({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.leagueKey).toBe('449.l.123');
      expect((data.teams as unknown[]).length).toBe(2);
      expect(data.warning).toContain('LEAGUE_SETTINGS_UNAVAILABLE');
    });

    it('degrades gracefully (teams-only + warning, no throw) when /settings returns an unexpected shape', async () => {
      fetchMock.mockImplementation(async (path: unknown) => {
        const p = path as string;
        if (p.includes('/settings')) {
          return jsonResponse({ fantasy_content: { league: [{ league_key: '449.l.123' }, { settings: 'not-an-array-or-object' }] } });
        }
        return jsonResponse(buildLeagueInfoResponse());
      });

      const params: ToolParams = { sport: 'football', league_id: '449.l.123', season_year: 2025 };
      const result = await footballHandlers.get_league_info({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.leagueKey).toBe('449.l.123');
      expect(data.draftType).toBeUndefined();
      expect(data.warning).toContain('LEAGUE_SETTINGS_UNAVAILABLE');
    });

    it('surfaces isProLeague from the /teams response metadata without an extra fetch', async () => {
      const responseWithProLeague = {
        fantasy_content: {
          league: [
            { league_key: '449.l.123', name: 'Test League', is_pro_league: '1' },
            { teams: { count: 0 } },
          ],
        },
      };
      fetchMock.mockImplementation(async (path: unknown) => {
        const p = path as string;
        if (p.includes('/settings')) {
          return new Response('Not Found', { status: 404 });
        }
        return jsonResponse(responseWithProLeague);
      });

      const params: ToolParams = { sport: 'football', league_id: '449.l.123', season_year: 2025 };
      const result = await footballHandlers.get_league_info({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.isProLeague).toBe(true);
    });
  });

  describe('get_standings', () => {
    it.each(scenarios)('$label returns sorted standings with W/L/T', async ({ sport, handlers }) => {
      fetchMock.mockResolvedValue(jsonResponse(buildStandingsResponse()));

      const params: ToolParams = { sport, league_id: '449.l.123', season_year: 2025 };
      const result = await handlers.get_standings({} as never, params, 'Bearer x', `cid-${sport}`);

      expect(result.success).toBe(true);
      const data = result.data as { standings: Array<Record<string, unknown>> };
      expect(data.standings).toHaveLength(2);
      expect(data.standings[0]).toMatchObject({ rank: 1, name: 'Team A', wins: 8, losses: 2 });
      expect(data.standings[1]).toMatchObject({ rank: 2, name: 'Team B', wins: 6, losses: 4 });
    });

    it.each(scenarios)('$label returns regular_season phase and null outcome fields during active season', async ({ sport, handlers }) => {
      fetchMock.mockResolvedValue(jsonResponse(buildStandingsResponse())); // is_finished: 0, no playoff_start_week

      const params: ToolParams = { sport, league_id: '449.l.123', season_year: 2025 };
      const result = await handlers.get_standings({} as never, params, 'Bearer x', `cid-${sport}`);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.seasonPhase).toBe('regular_season');
      expect(data.seasonComplete).toBe(false);

      // Yahoo always returns null for unverifiable outcome fields
      const standings = data.standings as Array<Record<string, unknown>>;
      expect(standings[0]).toMatchObject({
        finalRank: null,
        championshipWon: null,
        outcomeConfidence: null,
      });
    });

    it.each(scenarios)('$label returns season_complete when is_finished is 1', async ({ sport, handlers }) => {
      const finishedResponse = {
        fantasy_content: {
          league: [
            {
              league_key: '449.l.123',
              name: 'Test League',
              is_finished: 1,
              current_week: 17,
              playoff_start_week: 14,
            },
            {
              standings: [
                {
                  teams: {
                    '0': {
                      team: [
                        [{ team_key: '449.l.123.t.1', team_id: '1', name: 'Team A' }],
                        { team_standings: { rank: 1, playoff_seed: 1, outcome_totals: { wins: 10, losses: 3, ties: 0, percentage: '.769' }, points_for: '1500', points_against: '1200' } },
                      ],
                    },
                    '1': {
                      team: [
                        [{ team_key: '449.l.123.t.2', team_id: '2', name: 'Team B' }],
                        { team_standings: { rank: 2, outcome_totals: { wins: 9, losses: 4, ties: 0, percentage: '.692' }, points_for: '1400', points_against: '1300' } },
                      ],
                    },
                    '2': {
                      team: [
                        [{ team_key: '449.l.123.t.3', team_id: '3', name: 'Team C' }],
                        { team_standings: { rank: 3, playoff_seed: 'N/A', outcome_totals: { wins: 5, losses: 8, ties: 0, percentage: '.385' }, points_for: '1100', points_against: '1350' } },
                      ],
                    },
                    '3': {
                      team: [
                        [{ team_key: '449.l.123.t.4', team_id: '4', name: 'Team D' }],
                        { team_standings: { rank: 4, playoff_seed: '', outcome_totals: { wins: 4, losses: 9, ties: 0, percentage: '.308' }, points_for: '1050', points_against: '1400' } },
                      ],
                    },
                    '4': {
                      team: [
                        [{ team_key: '449.l.123.t.5', team_id: '5', name: 'Team E' }],
                        { team_standings: { rank: 5, playoff_seed: '   ', outcome_totals: { wins: 3, losses: 10, ties: 0, percentage: '.231' }, points_for: '1000', points_against: '1450' } },
                      ],
                    },
                    '5': {
                      team: [
                        [{ team_key: '449.l.123.t.6', team_id: '6', name: 'Team F' }],
                        { team_standings: { rank: 6, playoff_seed: false, outcome_totals: { wins: 2, losses: 11, ties: 0, percentage: '.154' }, points_for: '950', points_against: '1500' } },
                      ],
                    },
                    '6': {
                      team: [
                        [{ team_key: '449.l.123.t.7', team_id: '7', name: 'Team G' }],
                        { team_standings: { rank: 7, playoff_seed: true, outcome_totals: { wins: 1, losses: 12, ties: 0, percentage: '.077' }, points_for: '900', points_against: '1550' } },
                      ],
                    },
                    '7': {
                      team: [
                        [{ team_key: '449.l.123.t.8', team_id: '8', name: 'Team H' }],
                        { team_standings: { rank: 8, playoff_seed: 0, outcome_totals: { wins: 0, losses: 13, ties: 0, percentage: '.000' }, points_for: '850', points_against: '1600' } },
                      ],
                    },
                    '8': {
                      team: [
                        [{ team_key: '449.l.123.t.9', team_id: '9', name: 'Team I' }],
                        { team_standings: { rank: 9, playoff_seed: '3', outcome_totals: { wins: 6, losses: 7, ties: 0, percentage: '.462' }, points_for: '1150', points_against: '1300' } },
                      ],
                    },
                    count: 9,
                  },
                },
              ],
            },
          ],
        },
      };
      fetchMock.mockResolvedValue(jsonResponse(finishedResponse));

      const params: ToolParams = { sport, league_id: '449.l.123', season_year: 2024 };
      const result = await handlers.get_standings({} as never, params, 'Bearer x', `cid-${sport}`);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.seasonPhase).toBe('season_complete');
      expect(data.seasonComplete).toBe(true);

      // Team with playoff_seed → madePlayoffs true; without → null
      const standings = data.standings as Array<Record<string, unknown>>;
      const teamA = standings.find((s) => s.name === 'Team A');
      const teamB = standings.find((s) => s.name === 'Team B');
      const teamC = standings.find((s) => s.name === 'Team C');
      const teamD = standings.find((s) => s.name === 'Team D');
      const teamE = standings.find((s) => s.name === 'Team E');
      const teamF = standings.find((s) => s.name === 'Team F');
      const teamG = standings.find((s) => s.name === 'Team G');
      const teamH = standings.find((s) => s.name === 'Team H');
      const teamI = standings.find((s) => s.name === 'Team I');
      expect(teamA?.madePlayoffs).toBe(true);
      expect(teamA?.playoffSeed).toBe(1);
      expect(teamB?.madePlayoffs).toBeNull();
      expect(teamB?.playoffSeed).toBeNull();
      // Non-numeric playoff_seed ('N/A') must fall back to null, never NaN
      expect(teamC?.madePlayoffs).toBeNull();
      expect(teamC?.playoffSeed).toBeNull();
      // Empty string, whitespace-only string, booleans, and zero must all reject
      // rather than coerce via Number() (Number('') === 0, Number(true) === 1, etc.)
      expect(teamD?.madePlayoffs).toBeNull();
      expect(teamD?.playoffSeed).toBeNull();
      expect(teamE?.madePlayoffs).toBeNull();
      expect(teamE?.playoffSeed).toBeNull();
      expect(teamF?.madePlayoffs).toBeNull();
      expect(teamF?.playoffSeed).toBeNull();
      expect(teamG?.madePlayoffs).toBeNull();
      expect(teamG?.playoffSeed).toBeNull();
      expect(teamH?.madePlayoffs).toBeNull();
      expect(teamH?.playoffSeed).toBeNull();
      // A valid numeric string must still parse correctly
      expect(teamI?.madePlayoffs).toBe(true);
      expect(teamI?.playoffSeed).toBe(3);

      // Yahoo cannot verify championship outcome — always null
      expect(teamA?.finalRank).toBeNull();
      expect(teamA?.championshipWon).toBeNull();
      expect(teamA?.outcomeConfidence).toBeNull();
    });

    it.each(scenarios)('$label returns playoffs_in_progress when current_week >= playoff_start_week', async ({ sport, handlers }) => {
      const playoffResponse = {
        fantasy_content: {
          league: [
            {
              league_key: '449.l.123',
              name: 'Test League',
              is_finished: 0,
              current_week: 15,
              playoff_start_week: 14,
            },
            {
              standings: [
                {
                  teams: {
                    '0': {
                      team: [
                        [{ team_key: '449.l.123.t.1', team_id: '1', name: 'Team A' }],
                        { team_standings: { rank: 1, outcome_totals: { wins: 8, losses: 5, ties: 0, percentage: '.615' }, points_for: '1200', points_against: '1100' } },
                      ],
                    },
                    count: 1,
                  },
                },
              ],
            },
          ],
        },
      };
      fetchMock.mockResolvedValue(jsonResponse(playoffResponse));

      const params: ToolParams = { sport, league_id: '449.l.123', season_year: 2025 };
      const result = await handlers.get_standings({} as never, params, 'Bearer x', `cid-${sport}`);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.seasonPhase).toBe('playoffs_in_progress');
      expect(data.seasonComplete).toBe(false);

      // Outcome fields always null on Yahoo regardless of season phase
      const standings = data.standings as Array<Record<string, unknown>>;
      expect(standings[0]?.finalRank).toBeNull();
      expect(standings[0]?.championshipWon).toBeNull();
      expect(standings[0]?.playoffOutcome).toBeNull();
      expect(standings[0]?.outcomeConfidence).toBeNull();
    });

    it.each(scenarios)('$label falls back to regular_season when current_week or playoff_start_week is non-numeric', async ({ sport, handlers }) => {
      const nanResponse = {
        fantasy_content: {
          league: [
            {
              league_key: '449.l.123',
              name: 'Test League',
              is_finished: 0,
              current_week: 'N/A',   // non-numeric
              playoff_start_week: null, // missing
            },
            {
              standings: [
                {
                  teams: {
                    '0': {
                      team: [
                        [{ team_key: '449.l.123.t.1', team_id: '1', name: 'Team A' }],
                        { team_standings: { rank: 1, outcome_totals: { wins: 8, losses: 5, ties: 0, percentage: '.615' }, points_for: '1200', points_against: '1100' } },
                      ],
                    },
                    count: 1,
                  },
                },
              ],
            },
          ],
        },
      };
      fetchMock.mockResolvedValue(jsonResponse(nanResponse));

      const params: ToolParams = { sport, league_id: '449.l.123', season_year: 2025 };
      const result = await handlers.get_standings({} as never, params, 'Bearer x', `cid-${sport}`);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      // Non-numeric fields safely default to 0 — no playoffs configured → regular_season
      expect(data.seasonPhase).toBe('regular_season');
      expect(data.seasonComplete).toBe(false);
    });

    it.each(scenarios)('$label returns error when league_id is missing', async ({ sport, handlers }) => {
      const params: ToolParams = { sport, league_id: '', season_year: 2025 };
      const result = await handlers.get_standings({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(false);
      expect(result.code).toBe('MISSING_PARAM');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('get_roster', () => {
    it.each(scenarios)('$label returns roster players with selected positions and ownerName', async ({ sport, handlers }) => {
      fetchMock.mockResolvedValue(jsonResponse(buildRosterResponse()));

      const params: ToolParams = { sport, league_id: '449.l.123', season_year: 2025, team_id: '449.l.123.t.1' };
      const result = await handlers.get_roster({} as never, params, 'Bearer x', `cid-${sport}`);

      expect(result.success).toBe(true);
      const data = result.data as { teamName: string; ownerName?: string; players: Array<Record<string, unknown>> };
      expect(data.teamName).toBe('Team A');
      expect(data.ownerName).toBe('Alice');
      expect(data.players).toHaveLength(1);
      expect(data.players[0]).toMatchObject({
        playerId: '101',
        name: 'Player One',
        selectedPosition: 'SS',
      });
    });

    it.each(scenarios)('$label returns error when team_id is missing', async ({ sport, handlers }) => {
      const params: ToolParams = { sport, league_id: '449.l.123', season_year: 2025 };
      const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(false);
      expect(result.code).toBe('MISSING_PARAM');
    });

    // FLA-284: Yahoo's undocumented is_keeper field, reverse-engineered from
    // real captures. Emitted as normalized booleans only for players that
    // carry the field at all — absent entirely for a non-keeper league.
    it.each(scenarios)('$label includes normalized isKeeper only for the player that has is_keeper', async ({ sport, handlers }) => {
      fetchMock.mockResolvedValue(jsonResponse(buildRosterResponseWithKeeper(true)));

      const params: ToolParams = { sport, league_id: '449.l.123', season_year: 2025, team_id: '449.l.123.t.1' };
      const result = await handlers.get_roster({} as never, params, 'Bearer x', `cid-${sport}`);

      expect(result.success).toBe(true);
      const data = result.data as { players: Array<Record<string, unknown>> };
      expect(data.players).toHaveLength(2);
      expect(data.players[0]).toMatchObject({ isKeeper: { status: true, cost: false, kept: true } });
      expect(data.players[1]).not.toHaveProperty('isKeeper');
    });

    it('football normalizes "0"/"1" string is_keeper flags to booleans', async () => {
      fetchMock.mockResolvedValue(jsonResponse(buildRosterResponseWithKeeper('0')));

      const params: ToolParams = { sport: 'football', league_id: '449.l.123', season_year: 2025, team_id: '449.l.123.t.1' };
      const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const data = result.data as { players: Array<Record<string, unknown>> };
      expect(data.players[0].isKeeper).toEqual({ status: false, cost: false, kept: false });
    });
  });

  describe('get_roster snapshot selectors', () => {
    const dailySports = ['baseball', 'basketball', 'hockey'] as const;
    const handlersBySport = {
      football: footballHandlers,
      baseball: baseballHandlers,
      basketball: basketballHandlers,
      hockey: hockeyHandlers,
    } as const;

    it('football week emits ;week= and reports snapshot metadata', async () => {
      fetchMock.mockResolvedValue(jsonResponse(buildRosterResponse()));

      const params: ToolParams = { sport: 'football', league_id: '449.l.123', season_year: 2025, team_id: '449.l.123.t.1', week: 5 };
      const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      expect(fetchMock.mock.calls[0][0]).toContain('/roster;week=5');
      const data = result.data as { snapshot: Record<string, unknown> };
      expect(data.snapshot).toEqual({ type: 'week', week: 5 });
    });

    it('football rejects an injected date snapshot', async () => {
      const params: ToolParams = {
        sport: 'football', league_id: '449.l.123', season_year: 2025, team_id: '449.l.123.t.1',
        snapshot: { type: 'date', date: '2025-10-05' },
      };
      const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_ROSTER_SNAPSHOT_SELECTOR');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(dailySports)('%s date emits ;date= and never ;week=', async (sport) => {
      fetchMock.mockResolvedValue(jsonResponse(buildRosterResponse()));

      const params: ToolParams = {
        sport, league_id: '449.l.123', season_year: 2025, team_id: '449.l.123.t.1',
        snapshot: { type: 'date', date: '2025-07-10' },
      };
      const result = await handlersBySport[sport].get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const path = fetchMock.mock.calls[0][0] as string;
      expect(path).toContain('/roster;date=2025-07-10');
      expect(path).not.toContain(';week=');
      const data = result.data as { snapshot: Record<string, unknown> };
      expect(data.snapshot).toEqual({ type: 'date', date: '2025-07-10' });
    });

    it.each(dailySports)('%s rejects legacy week instead of emitting ;week=', async (sport) => {
      const params: ToolParams = { sport, league_id: '449.l.123', season_year: 2025, team_id: '449.l.123.t.1', week: 15 };
      const result = await handlersBySport[sport].get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_ROSTER_SNAPSHOT_SELECTOR');
      expect(result.error).toContain('as_of_date');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    // FLA-209 published-client compatibility, contrasted with FLA-278 temporal
    // purity: a raw `week` on a daily sport is rejected above — the gateway is
    // the only place a legacy `week` gets normalized to `{ type: 'current',
    // requestedWeek }` (see validateRosterSnapshotInput in
    // workers/shared/src/roster-snapshot.ts). This injects that
    // already-normalized shape, as the gateway would send it, to prove the
    // resulting response is genuinely a CURRENT roster: no ;week=/;date=
    // selector, team/status still present, and no `limitations` block — the
    // FLA-278 historical-omission rule must not fire on this compat path.
    it.each(dailySports)('%s FLA-209 ignored-week compat snapshot serves current roster with team/status intact and no limitations', async (sport) => {
      fetchMock.mockResolvedValue(jsonResponse(buildRosterResponse()));

      const params: ToolParams = {
        sport, league_id: '449.l.123', season_year: 2025, team_id: '449.l.123.t.1',
        snapshot: { type: 'current', requestedWeek: 15 },
      };
      const result = await handlersBySport[sport].get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const path = fetchMock.mock.calls[0][0] as string;
      expect(path).not.toContain(';week=');
      expect(path).not.toContain(';date=');

      const data = result.data as {
        snapshot: Record<string, unknown>;
        players: Array<Record<string, unknown>>;
        limitations?: unknown;
      };
      expect(data.snapshot.type).toBe('current');
      expect(data.snapshot.requested_week).toBe(15);
      expect(data.snapshot.note).toBeTruthy();
      expect(data.players[0].team).toBe('NYY');
      expect(data.players[0].status).toBe('healthy');
      expect(data.limitations).toBeUndefined();
    });

    it.each(scenarios)('$label rejects a malformed injected snapshot without degrading to current', async ({ sport, handlers }) => {
      const params: ToolParams = {
        sport, league_id: '449.l.123', season_year: 2025, team_id: '449.l.123.t.1',
        snapshot: { type: 'date', date: '2025-02-30' } as never,
      };
      const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_ROSTER_SNAPSHOT_SELECTOR');
      expect(result.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(scenarios)('$label current roster omits both selectors from the URL', async ({ sport, handlers }) => {
      fetchMock.mockResolvedValue(jsonResponse(buildRosterResponse()));

      const params: ToolParams = { sport, league_id: '449.l.123', season_year: 2025, team_id: '449.l.123.t.1' };
      const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const path = fetchMock.mock.calls[0][0] as string;
      expect(path).not.toContain(';week=');
      expect(path).not.toContain(';date=');
      const data = result.data as { snapshot: Record<string, unknown> };
      expect(data.snapshot).toEqual({ type: 'current' });
    });

    // FLA-278: Yahoo's roster player object only carries the CURRENT club/status
    // (editorial_team_abbr/status). A historical week/date snapshot must not
    // relabel that present-day state as true-as-of-then, so `team`/`status`
    // are omitted entirely and `limitations.playerProTeamAvailable: false` is
    // added — mirroring the same rule already applied to ESPN and Sleeper.
    it('football week snapshot omits team/status and flags playerProTeamAvailable', async () => {
      fetchMock.mockResolvedValue(jsonResponse(buildRosterResponse()));

      const params: ToolParams = { sport: 'football', league_id: '449.l.123', season_year: 2025, team_id: '449.l.123.t.1', week: 5 };
      const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const data = result.data as { players: Array<Record<string, unknown>>; limitations?: Record<string, unknown> };
      expect(data.players[0]).not.toHaveProperty('team');
      expect(data.players[0]).not.toHaveProperty('status');
      expect(data.limitations).toEqual({ playerProTeamAvailable: false });
    });

    it.each(dailySports)('%s date snapshot omits team/status and flags playerProTeamAvailable', async (sport) => {
      fetchMock.mockResolvedValue(jsonResponse(buildRosterResponse()));

      const params: ToolParams = {
        sport, league_id: '449.l.123', season_year: 2025, team_id: '449.l.123.t.1',
        snapshot: { type: 'date', date: '2025-07-10' },
      };
      const result = await handlersBySport[sport].get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const data = result.data as { players: Array<Record<string, unknown>>; limitations?: Record<string, unknown> };
      expect(data.players[0]).not.toHaveProperty('team');
      expect(data.players[0]).not.toHaveProperty('status');
      expect(data.limitations).toEqual({ playerProTeamAvailable: false });
    });

    it.each(scenarios)('$label current roster keeps team/status and has no limitations', async ({ sport, handlers }) => {
      fetchMock.mockResolvedValue(jsonResponse(buildRosterResponse()));

      const params: ToolParams = { sport, league_id: '449.l.123', season_year: 2025, team_id: '449.l.123.t.1' };
      const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const data = result.data as { players: Array<Record<string, unknown>>; limitations?: unknown };
      expect(data.players[0].team).toBe('NYY');
      expect(data.players[0].status).toBe('healthy');
      expect(data.limitations).toBeUndefined();
    });
  });

  describe('get_matchups', () => {
    it.each(scenarios)('$label returns matchups with team scores and winner', async ({ sport, handlers }) => {
      fetchMock.mockResolvedValue(jsonResponse(buildMatchupsResponse()));

      const params: ToolParams = { sport, league_id: '449.l.123', season_year: 2025 };
      const result = await handlers.get_matchups({} as never, params, 'Bearer x', `cid-${sport}`);

      expect(result.success).toBe(true);
      const data = result.data as { matchups: Array<Record<string, unknown>>; currentWeek: number };
      expect(data.currentWeek).toBe(5);
      expect(data.matchups).toHaveLength(1);
      const matchup = data.matchups[0] as { home: Record<string, unknown>; away: Record<string, unknown>; winner: string };
      expect(matchup.home).toMatchObject({ teamName: 'Team A', points: 120.5 });
      expect(matchup.away).toMatchObject({ teamName: 'Team B', points: 105.3 });
      expect(matchup.winner).toBe('home');
    });

    it.each(scenarios)('$label returns error when league_id is missing', async ({ sport, handlers }) => {
      const params: ToolParams = { sport, league_id: '', season_year: 2025 };
      const result = await handlers.get_matchups({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(false);
      expect(result.code).toBe('MISSING_PARAM');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('get_free_agents', () => {
    it.each(scenarios)('$label returns free agents with ownership data', async ({ sport, handlers }) => {
      fetchMock.mockResolvedValue(jsonResponse(buildFreeAgentsResponse()));

      const params: ToolParams = { sport, league_id: '449.l.123', season_year: 2025 };
      const result = await handlers.get_free_agents({} as never, params, 'Bearer x', `cid-${sport}`);

      expect(result.success).toBe(true);
      const data = result.data as { freeAgents: Array<Record<string, unknown>>; count: number };
      expect(data.count).toBe(1);
      expect(data.freeAgents[0]).toMatchObject({
        playerId: '201',
        name: 'Free Agent',
        team: 'BOS',
        percentOwned: 12.5,
      });
    });

    it.each(scenarios)('$label returns error when league_id is missing', async ({ sport, handlers }) => {
      const params: ToolParams = { sport, league_id: '', season_year: 2025 };
      const result = await handlers.get_free_agents({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(false);
      expect(result.code).toBe('MISSING_PARAM');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each(scenarios)('$label preserves percent_owned: 0 instead of dropping it', async ({ sport, handlers }) => {
      const response = {
        fantasy_content: {
          league: [
            { league_key: '449.l.123', name: 'Test League' },
            {
              players: {
                '0': {
                  player: [
                    [{ player_key: 'fa101', player_id: '201', name: { full: 'Zero Owned' }, editorial_team_abbr: 'BOS', display_position: 'OF' }],
                    { ownership: { percent_owned: '0' } },
                  ],
                },
                count: 1,
              },
            },
          ],
        },
      };
      fetchMock.mockResolvedValue(jsonResponse(response));

      const params: ToolParams = { sport, league_id: '449.l.123', season_year: 2025 };
      const result = await handlers.get_free_agents({} as never, params, 'Bearer x', `cid-${sport}`);

      expect(result.success).toBe(true);
      const data = result.data as { freeAgents: Array<{ percentOwned: number | null | undefined }> };
      // percent_owned: "0" must not be dropped as undefined
      expect(data.freeAgents[0].percentOwned).toBe(0);
    });

    it.each(scenarios)('$label paginates available players, requests ownership, and returns globally ownership-sorted results', async ({ sport, handlers }) => {
      const firstPagePlayers = Array.from({ length: 100 }, (_unused, index) => ({
        player_key: `fa${index + 1}`,
        player_id: String(index + 1),
        full_name: `Player ${String(index + 1).padStart(3, '0')}`,
        team: 'BOS',
        position: 'OF',
        percent_owned: String(index % 5),
      }));

      const secondPagePlayers = [
        { player_key: 'fa201', player_id: '201', full_name: 'Aaron Ace', team: 'NYY', position: 'OF', percent_owned: '99' },
        { player_key: 'fa202', player_id: '202', full_name: 'Ben Bat', team: 'LAD', position: 'OF', percent_owned: '99' },
        { player_key: 'fa203', player_id: '203', full_name: 'Carl Curve', team: 'ATL', position: 'OF', percent_owned: '88.5' },
        { player_key: 'fa204', player_id: '204', full_name: 'Null Guy', team: 'SEA', position: 'OF' },
      ];

      fetchMock
        .mockResolvedValueOnce(jsonResponse(buildFreeAgentsPageResponse(firstPagePlayers)))
        .mockResolvedValueOnce(jsonResponse(buildFreeAgentsPageResponse(secondPagePlayers)));

      const params: ToolParams = {
        sport,
        league_id: '449.l.123',
        season_year: 2025,
        count: 3,
        position: FREE_AGENT_POSITION_FILTER[sport],
      };
      const result = await handlers.get_free_agents({} as never, params, 'Bearer x', `cid-${sport}`);

      expect(result.success).toBe(true);
      const data = result.data as {
        count: number;
        freeAgents: Array<{ playerId: string; name: string; percentOwned: number | null }>;
      };

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]?.[0]).toContain(
        `/league/449.l.123/players;status=A;count=100;sort=OR;start=0;position=${FREE_AGENT_POSITION_FILTER[sport]}/ownership`
      );
      expect(fetchMock.mock.calls[1]?.[0]).toContain(
        `/league/449.l.123/players;status=A;count=100;sort=OR;start=100;position=${FREE_AGENT_POSITION_FILTER[sport]}/ownership`
      );

      expect(data.count).toBe(3);
      expect(data.freeAgents).toEqual([
        expect.objectContaining({ playerId: '201', name: 'Aaron Ace', percentOwned: 99 }),
        expect.objectContaining({ playerId: '202', name: 'Ben Bat', percentOwned: 99 }),
        expect.objectContaining({ playerId: '203', name: 'Carl Curve', percentOwned: 88.5 }),
      ]);
    });

    // FLA-284: same is_keeper passthrough as get_roster.
    it.each(scenarios)('$label includes normalized isKeeper when a free agent has is_keeper', async ({ sport, handlers }) => {
      fetchMock.mockResolvedValue(jsonResponse(buildFreeAgentsResponseWithKeeper()));

      const params: ToolParams = { sport, league_id: '449.l.123', season_year: 2025 };
      const result = await handlers.get_free_agents({} as never, params, 'Bearer x', `cid-${sport}`);

      expect(result.success).toBe(true);
      const data = result.data as { freeAgents: Array<Record<string, unknown>> };
      expect(data.freeAgents[0]).toMatchObject({ isKeeper: { status: true, cost: false, kept: true } });
    });

    it.each(scenarios)('$label omits isKeeper when a free agent has no is_keeper field', async ({ sport, handlers }) => {
      fetchMock.mockResolvedValue(jsonResponse(buildFreeAgentsResponse()));

      const params: ToolParams = { sport, league_id: '449.l.123', season_year: 2025 };
      const result = await handlers.get_free_agents({} as never, params, 'Bearer x', `cid-${sport}`);

      expect(result.success).toBe(true);
      const data = result.data as { freeAgents: Array<Record<string, unknown>> };
      expect(data.freeAgents[0]).not.toHaveProperty('isKeeper');
    });
  });
});
