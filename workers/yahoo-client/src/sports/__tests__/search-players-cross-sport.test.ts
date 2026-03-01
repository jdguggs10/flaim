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

describe('yahoo cross-sport search_players handlers', () => {
  const getCredsMock = getYahooCredentials as MockedFunction<typeof getYahooCredentials>;
  const fetchMock = yahooFetch as MockedFunction<typeof yahooFetch>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(scenarios)('$label maps ownership and normalizes player identity fields', async ({ sport, handlers }) => {
    getCredsMock.mockResolvedValue({ accessToken: 'token' });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(buildSearchResponse()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const params: ToolParams = {
      sport,
      league_id: '449.l.123',
      season_year: 2025,
      query: 'rice',
      count: 10,
    };

    const result = await handlers.search_players({} as never, params, 'Bearer x', `cid-${sport}`);
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
    });
    expect(data.players[1]).toMatchObject({
      id: '102',
      market_percent_owned: 0,
      ownership_scope: 'platform_global',
    });
    expect(data.players[2]).toMatchObject({
      id: '103',
      market_percent_owned: null,
      ownership_scope: 'platform_global',
    });
    expect(data.players[0].playerKey).toBeUndefined();
    expect(data.players[0].playerId).toBeUndefined();
  });
});
