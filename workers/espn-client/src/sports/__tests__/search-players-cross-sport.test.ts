import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { baseballHandlers } from '../baseball/handlers';
import { basketballHandlers } from '../basketball/handlers';
import { footballHandlers } from '../football/handlers';
import { hockeyHandlers } from '../hockey/handlers';
import type { ToolParams } from '../../types';
import { getEspnPlayersIndex } from '../../shared/espn-players-cache';

vi.mock('../../shared/espn-players-cache', () => ({
  getEspnPlayersIndex: vi.fn(),
}));

const scenarios = [
  { label: 'football', sport: 'football', handlers: footballHandlers },
  { label: 'baseball', sport: 'baseball', handlers: baseballHandlers },
  { label: 'basketball', sport: 'basketball', handlers: basketballHandlers },
  { label: 'hockey', sport: 'hockey', handlers: hockeyHandlers },
] as const;

describe('espn cross-sport search_players handlers', () => {
  const getPlayersIndexMock = getEspnPlayersIndex as MockedFunction<typeof getEspnPlayersIndex>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(scenarios)('$label maps market ownership with platform_global scope', async ({ sport, handlers }) => {
    getPlayersIndexMock.mockResolvedValue(
      new Map([
        [1, { id: 1, fullName: 'Giancarlo Stanton', defaultPositionId: 1, proTeamId: 1, percentOwned: 47 }],
        [2, { id: 2, fullName: 'Ben Rice', defaultPositionId: 1, proTeamId: 1, percentOwned: null }],
      ])
    );

    const params: ToolParams = {
      sport,
      league_id: '123',
      season_year: 2025,
      query: ' ',
      count: 10,
    };

    const result = await handlers.search_players({} as never, params);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const data = result.data as {
      platform: string;
      sport: string;
      count: number;
      players: Array<{
        id: string;
        name: string;
        market_percent_owned: number | null;
        ownership_scope: string;
      }>;
    };
    expect(data.platform).toBe('espn');
    expect(data.sport).toBe(sport);
    expect(data.count).toBe(2);
    expect(data.players[0]).toMatchObject({
      id: '1',
      name: 'Giancarlo Stanton',
      market_percent_owned: 47,
      ownership_scope: 'platform_global',
    });
    expect(data.players[1]).toMatchObject({
      id: '2',
      name: 'Ben Rice',
      market_percent_owned: null,
      ownership_scope: 'platform_global',
    });
    expect(data.players[0]).toHaveProperty('position');
    expect(data.players[0]).toHaveProperty('team');
  });
});
