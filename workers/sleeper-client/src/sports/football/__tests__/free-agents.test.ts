import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { footballHandlers } from '../handlers';
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

describe('sleeper football get_free_agents handler', () => {
  const sleeperFetchMock = sleeperFetch as MockedFunction<typeof sleeperFetch>;
  const getPlayersIndexMock = getSleeperPlayersIndex as MockedFunction<typeof getSleeperPlayersIndex>;
  const buildFreeAgentsMock = buildSleeperFreeAgents as MockedFunction<typeof buildSleeperFreeAgents>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches rosters, uses player cache helper, and returns shaped response', async () => {
    sleeperFetchMock.mockResolvedValueOnce(new Response(JSON.stringify([
      { players: ['101', '102'] },
      { players: ['103'] },
    ]), { status: 200 }));

    const playersIndex = new Map();
    getPlayersIndexMock.mockResolvedValue(playersIndex as never);
    buildFreeAgentsMock.mockReturnValue([
      { id: '999', name: 'A Player', position: 'QB', team: 'BUF' },
    ]);

    const params: ToolParams = {
      sport: 'football',
      league_id: 'league_1',
      season_year: 2025,
      position: 'QB',
      count: 10,
    };

    const env = { SLEEPER_PLAYERS_CACHE: {} as KVNamespace } as Env;
    const result = await footballHandlers.get_free_agents(env, params);

    expect(sleeperFetchMock).toHaveBeenCalledWith('/league/league_1/rosters');
    expect(getPlayersIndexMock).toHaveBeenCalledWith(env, 'football');
    expect(buildFreeAgentsMock).toHaveBeenCalledWith(
      playersIndex,
      new Set(['101', '102', '103']),
      'QB',
      10,
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      platform: 'sleeper',
      sport: 'football',
      league_id: 'league_1',
      season_year: 2025,
      count: 1,
      players: [{ id: '999', name: 'A Player', position: 'QB', team: 'BUF' }],
    });
  });

  it('clamps requested count to max 100', async () => {
    sleeperFetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ players: [] }]), { status: 200 }));
    getPlayersIndexMock.mockResolvedValue(new Map() as never);
    buildFreeAgentsMock.mockReturnValue([]);

    const params: ToolParams = {
      sport: 'football',
      league_id: 'league_1',
      season_year: 2025,
      count: 999,
    };

    await footballHandlers.get_free_agents({ SLEEPER_PLAYERS_CACHE: {} as KVNamespace } as Env, params);

    expect(buildFreeAgentsMock).toHaveBeenCalledWith(expect.any(Map), new Set(), undefined, 100);
  });

  it('returns success with warning and empty players when index load fails', async () => {
    sleeperFetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{ players: ['101'] }]), { status: 200 }));
    getPlayersIndexMock.mockRejectedValueOnce(new Error('cache unavailable'));

    const params: ToolParams = {
      sport: 'football',
      league_id: 'league_1',
      season_year: 2025,
      count: 5,
    };

    const result = await footballHandlers.get_free_agents({} as Env, params);

    expect(result.success).toBe(true);
    expect(buildFreeAgentsMock).not.toHaveBeenCalled();
    if (!result.success) return;
    expect(result.data).toMatchObject({
      platform: 'sleeper',
      league_id: 'league_1',
      count: 0,
      players: [],
    });
    expect((result.data as { warning?: string }).warning).toContain('PLAYER_ENRICHMENT_UNAVAILABLE');
  });
});
