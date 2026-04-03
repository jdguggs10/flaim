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

const SEARCH_POSITION_FILTER: Record<(typeof scenarios)[number]['sport'], string> = {
  football: 'QB',
  baseball: '1B',
  basketball: 'PG',
  hockey: 'C',
};

function buildSearchResponse(): unknown {
  return {
    fantasy_content: {
      league: [
        { league_key: '449.l.123', name: 'Test League' },
        {
          players: {
            '0': {
              player: [
                [{
                  player_id: '101',
                  name: { full: 'Giancarlo Stanton' },
                  editorial_team_abbr: 'NYY',
                  display_position: 'OF',
                }],
                { ownership: { percent_owned: '47' } },
              ],
            },
            '1': {
              player: [
                [{
                  player_id: '102',
                  name: { full: 'Ben Rice' },
                  editorial_team_abbr: 'NYY',
                  display_position: '1B',
                }],
                { ownership: { percent_owned: '0' } },
              ],
            },
            '2': {
              player: [
                [{
                  player_id: '103',
                  name: { full: 'No Value Player' },
                  editorial_team_abbr: 'NYY',
                  display_position: 'C',
                }],
                { ownership: { percent_owned: 'n/a' } },
              ],
            },
            count: 3,
          },
        },
      ],
    },
  };
}

function buildLeagueInfoWithTeamsResponse(): unknown {
  return {
    fantasy_content: {
      league: [
        { league_key: '449.l.123', name: 'Test League' },
        {
          teams: {
            '0': {
              team: [[
                { team_key: '449.l.123.t.1' },
                { team_id: '1' },
                { name: 'Team A' },
                { managers: { '0': { manager: { manager_id: 'm1', nickname: 'Alice' } }, count: 1 } },
              ]],
            },
            '1': {
              team: [[
                { team_key: '449.l.123.t.2' },
                { team_id: '2' },
                { name: 'Team B' },
              ]],
            },
            count: 2,
          },
        },
      ],
    },
  };
}

function buildRosterResponse(teamKey: string, playerIds: string[]): unknown {
  const players: Record<string, unknown> = {};

  playerIds.forEach((playerId, index) => {
    players[String(index)] = {
      player: [
        [{
          player_id: playerId,
          name: { full: `Rostered ${playerId}` },
          editorial_team_abbr: 'NYY',
          display_position: 'OF',
        }],
      ],
    };
  });

  players.count = playerIds.length;

  return {
    fantasy_content: {
      team: [
        [
          { team_key: teamKey },
          { name: teamKey.endsWith('.1') ? 'Team A' : 'Team B' },
          ...(teamKey.endsWith('.1')
            ? [{ managers: { '0': { manager: { manager_id: 'm1', nickname: 'Alice' } }, count: 1 } }]
            : []),
        ],
        {
          roster: {
            '0': {
              players,
            },
          },
        },
      ],
    },
  };
}

describe('yahoo cross-sport get_players handlers', () => {
  const getCredsMock = getYahooCredentials as MockedFunction<typeof getYahooCredentials>;
  const fetchMock = yahooFetch as MockedFunction<typeof yahooFetch>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(scenarios)('$label maps ownership and normalizes player identity fields', async ({ sport, handlers }) => {
    getCredsMock.mockResolvedValue({ accessToken: 'token' });
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(buildSearchResponse()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(buildLeagueInfoWithTeamsResponse()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(buildRosterResponse('449.l.123.t.1', ['101'])), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(buildRosterResponse('449.l.123.t.2', ['103'])), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const params: ToolParams = {
      sport,
      league_id: '449.l.123',
      season_year: 2025,
      query: 'rice',
      count: 10,
    };

    const result = await handlers.get_players({} as never, params, 'Bearer x', `cid-${sport}`);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const data = result.data as {
      count: number;
      players: Array<{
        id: string;
        market_percent_owned: number | null;
        ownership_scope: string;
        playerKey?: string;
        playerId?: string;
      }>;
    };

    expect(data.count).toBe(3);
    expect(data.players[0]).toMatchObject({
      id: '101',
      market_percent_owned: 47,
      ownership_scope: 'platform_global',
      league_status: 'ROSTERED',
      league_team_name: 'Team A',
      league_owner_name: 'Alice',
    });
    expect(data.players[1]).toMatchObject({
      id: '102',
      market_percent_owned: 0,
      ownership_scope: 'platform_global',
      league_status: 'FREE_AGENT',
      league_team_name: null,
      league_owner_name: null,
    });
    expect(data.players[2]).toMatchObject({
      id: '103',
      market_percent_owned: null,
      ownership_scope: 'platform_global',
      league_status: 'ROSTERED',
      league_team_name: 'Team B',
      league_owner_name: null,
    });
    expect(data.players[0].playerKey).toBeUndefined();
    expect(data.players[0].playerId).toBeUndefined();
  });

  it.each(scenarios)('$label requests Yahoo ownership sub-resource for player search', async ({ sport, handlers }) => {
    getCredsMock.mockResolvedValue({ accessToken: 'token' });
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify(buildSearchResponse()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(buildLeagueInfoWithTeamsResponse()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(buildRosterResponse('449.l.123.t.1', ['101'])), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(buildRosterResponse('449.l.123.t.2', ['103'])), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const params: ToolParams = {
      sport,
      league_id: '449.l.123',
      season_year: 2025,
      query: 'rice',
      count: 10,
      position: SEARCH_POSITION_FILTER[sport],
    };

    const result = await handlers.get_players({} as never, params, 'Bearer x', `cid-${sport}`);
    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(`/league/449.l.123/players;search=rice;count=10;position=${SEARCH_POSITION_FILTER[sport]}/ownership`);
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/league/449.l.123/teams');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/team/449.l.123.t.1/roster');
    expect(fetchMock.mock.calls[3]?.[0]).toBe('/team/449.l.123.t.2/roster');
  });
});
