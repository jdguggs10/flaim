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
        [{ team_key: '449.l.123.t.1', name: 'Team A' }],
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

describe('yahoo cross-sport handler characterization tests', () => {
  const getCredsMock = getYahooCredentials as MockedFunction<typeof getYahooCredentials>;
  const fetchMock = yahooFetch as MockedFunction<typeof yahooFetch>;

  beforeEach(() => {
    vi.clearAllMocks();
    getCredsMock.mockResolvedValue({ accessToken: 'token' });
  });

  describe('get_league_info', () => {
    it.each(scenarios)('$label returns consistent league metadata shape', async ({ sport, handlers }) => {
      fetchMock.mockResolvedValue(jsonResponse(buildLeagueInfoResponse()));

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
    });

    it('baseball includes startDate and endDate', async () => {
      fetchMock.mockResolvedValue(jsonResponse(buildLeagueInfoResponse()));

      const params: ToolParams = { sport: 'baseball', league_id: '449.l.123', season_year: 2025 };
      const result = await baseballHandlers.get_league_info({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.startDate).toBe('2025-03-27');
      expect(data.endDate).toBe('2025-09-28');
    });

    it.each(scenarios.filter(s => s.label !== 'baseball'))('$label does not include startDate/endDate', async ({ sport, handlers }) => {
      fetchMock.mockResolvedValue(jsonResponse(buildLeagueInfoResponse()));

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

    it.each(scenarios)('$label returns error when league_id is missing', async ({ sport, handlers }) => {
      const params: ToolParams = { sport, league_id: '', season_year: 2025 };
      const result = await handlers.get_standings({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(false);
      expect(result.code).toBe('MISSING_PARAM');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('get_roster', () => {
    it.each(scenarios)('$label returns roster players with selected positions', async ({ sport, handlers }) => {
      fetchMock.mockResolvedValue(jsonResponse(buildRosterResponse()));

      const params: ToolParams = { sport, league_id: '449.l.123', season_year: 2025, team_id: '449.l.123.t.1' };
      const result = await handlers.get_roster({} as never, params, 'Bearer x', `cid-${sport}`);

      expect(result.success).toBe(true);
      const data = result.data as { players: Array<Record<string, unknown>> };
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
  });
});
