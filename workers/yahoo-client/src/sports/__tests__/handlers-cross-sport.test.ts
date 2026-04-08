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

      // Teams array with owner names from Yahoo's numeric-keyed managers
      const teams = data.teams as Array<{ teamId?: string; teamName?: string; ownerName?: string }>;
      expect(teams).toHaveLength(2);
      expect(teams[0]).toMatchObject({ teamId: '1', teamName: 'Team A', ownerName: 'Alice' });
      expect(teams[1]).toMatchObject({ teamId: '2', teamName: 'Team B' });
      expect(teams[1].ownerName).toBeUndefined();
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
                    count: 2,
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
      expect(teamA?.madePlayoffs).toBe(true);
      expect(teamA?.playoffSeed).toBe(1);
      expect(teamB?.madePlayoffs).toBeNull();
      expect(teamB?.playoffSeed).toBeNull();

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
  });
});
