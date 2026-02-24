import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { basketballHandlers } from '../handlers';
import type { Env, ToolParams } from '../../../types';
import { sleeperFetch } from '../../../shared/sleeper-api';
import { getSleeperPlayersIndex } from '../../../shared/sleeper-players-cache';
import { buildSleeperFreeAgents } from '../../../shared/sleeper-free-agents';

vi.mock('../../../shared/sleeper-api', () => ({
  sleeperFetch: vi.fn(),
  handleSleeperError: vi.fn((response: Response) => {
    throw new Error(`SLEEPER_API_ERROR: Sleeper returned ${response.status}`);
  }),
}));

vi.mock('../../../shared/sleeper-players-cache', () => ({
  getSleeperPlayersIndex: vi.fn(),
}));

vi.mock('../../../shared/sleeper-free-agents', () => ({
  buildSleeperFreeAgents: vi.fn(),
}));

describe('sleeper basketball get_free_agents handler', () => {
  const sleeperFetchMock = sleeperFetch as MockedFunction<typeof sleeperFetch>;
  const getPlayersIndexMock = getSleeperPlayersIndex as MockedFunction<typeof getSleeperPlayersIndex>;
  const buildFreeAgentsMock = buildSleeperFreeAgents as MockedFunction<typeof buildSleeperFreeAgents>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches rosters and uses basketball players cache', async () => {
    sleeperFetchMock.mockResolvedValueOnce(new Response(JSON.stringify([
      { players: ['501', '502'] },
    ]), { status: 200 }));

    const playersIndex = new Map();
    getPlayersIndexMock.mockResolvedValue(playersIndex as never);
    buildFreeAgentsMock.mockReturnValue([
      { id: '700', name: 'NBA FA', position: 'PG', team: 'BOS' },
    ]);

    const params: ToolParams = {
      sport: 'basketball',
      league_id: 'league_nba',
      season_year: 2025,
      position: 'PG',
      count: 8,
    };

    const env = { SLEEPER_PLAYERS_CACHE: {} as KVNamespace } as Env;
    const result = await basketballHandlers.get_free_agents(env, params);

    expect(sleeperFetchMock).toHaveBeenCalledWith('/league/league_nba/rosters');
    expect(getPlayersIndexMock).toHaveBeenCalledWith(env, 'basketball');
    expect(buildFreeAgentsMock).toHaveBeenCalledWith(
      playersIndex,
      new Set(['501', '502']),
      'PG',
      8,
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      platform: 'sleeper',
      sport: 'basketball',
      league_id: 'league_nba',
      season_year: 2025,
      count: 1,
      players: [{ id: '700', name: 'NBA FA', position: 'PG', team: 'BOS' }],
    });
  });

  it('clamps requested count to min 1', async () => {
    sleeperFetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ players: [] }]), { status: 200 }));
    getPlayersIndexMock.mockResolvedValue(new Map() as never);
    buildFreeAgentsMock.mockReturnValue([]);

    const params: ToolParams = {
      sport: 'basketball',
      league_id: 'league_nba',
      season_year: 2025,
      count: 0,
    };

    await basketballHandlers.get_free_agents({ SLEEPER_PLAYERS_CACHE: {} as KVNamespace } as Env, params);

    expect(buildFreeAgentsMock).toHaveBeenCalledWith(expect.any(Map), new Set(), undefined, 1);
  });

  it('returns success with warning and empty players when index load fails', async () => {
    sleeperFetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ players: ['501'] }]), { status: 200 }));
    getPlayersIndexMock.mockRejectedValueOnce(new Error('cache unavailable'));

    const params: ToolParams = {
      sport: 'basketball',
      league_id: 'league_nba',
      season_year: 2025,
      count: 5,
    };

    const result = await basketballHandlers.get_free_agents({} as Env, params);

    expect(result.success).toBe(true);
    expect(buildFreeAgentsMock).not.toHaveBeenCalled();
    if (!result.success) return;
    expect(result.data).toMatchObject({
      platform: 'sleeper',
      league_id: 'league_nba',
      count: 0,
      players: [],
    });
    expect((result.data as { warning?: string }).warning).toContain('PLAYER_ENRICHMENT_UNAVAILABLE');
  });
});
