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
  flaimSportToSleeper: vi.fn((sport: string) => (sport === 'football' ? 'nfl' : 'nba')),
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

  it('returns MISSING_PARAM when league_id is omitted', async () => {
    const params = {
      sport: 'football',
      season_year: 2025,
      count: 5,
    } as unknown as ToolParams;

    const result = await footballHandlers.get_free_agents({} as Env, params);

    expect(result.success).toBe(false);
    expect(result.code).toBe('MISSING_PARAM');
    expect(sleeperFetchMock).not.toHaveBeenCalled();
    expect(getPlayersIndexMock).not.toHaveBeenCalled();
    expect(buildFreeAgentsMock).not.toHaveBeenCalled();
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
    // Trending fetch is unmocked here (no second sleeperFetchMock response
    // queued) so it fails closed to an empty map — see the dedicated
    // trending-fallback test below for that path's assertions.
    expect(buildFreeAgentsMock).toHaveBeenCalledWith(
      playersIndex,
      new Set(['101', '102', '103']),
      'QB',
      10,
      new Map(),
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

    expect(buildFreeAgentsMock).toHaveBeenCalledWith(expect.any(Map), new Set(), undefined, 100, expect.any(Map));
  });

  it('falls back to an empty trending map (no warning) when the trending fetch fails', async () => {
    sleeperFetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([{ players: ['101'] }]), { status: 200 }))
      .mockRejectedValueOnce(new Error('network error'));

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

    expect(buildFreeAgentsMock).toHaveBeenCalledWith(playersIndex, new Set(['101']), 'QB', 10, new Map());
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
    const data = result.data as { warning?: string; warnings?: string[] };
    expect(data.warning).toBeUndefined();
    expect(data.warnings).toBeUndefined();
  });

  it('fetches trending adds alongside rosters and passes the parsed map to the builder', async () => {
    sleeperFetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([{ players: ['101'] }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { player_id: '201', count: 42 },
        { player_id: '202', count: 7 },
        { player_id: '203' }, // missing count — skipped
        { count: 5 }, // missing player_id — skipped
        { player_id: '204', count: 'not-a-number' }, // wrong type — skipped
        null, // non-object entry — skipped
      ]), { status: 200 }));

    const playersIndex = new Map();
    getPlayersIndexMock.mockResolvedValue(playersIndex as never);
    buildFreeAgentsMock.mockReturnValue([]);

    const params: ToolParams = {
      sport: 'football',
      league_id: 'league_1',
      season_year: 2025,
      count: 10,
    };

    await footballHandlers.get_free_agents({ SLEEPER_PLAYERS_CACHE: {} as KVNamespace } as Env, params);

    expect(sleeperFetchMock).toHaveBeenCalledWith('/league/league_1/rosters');
    const trendingCall = sleeperFetchMock.mock.calls.find(([path]) => String(path).includes('/trending/add'));
    expect(trendingCall).toBeDefined();
    const [trendingPath, trendingOptions] = trendingCall!;
    expect(trendingPath).toContain('lookback_hours=24');
    expect(trendingPath).toContain('limit=200');
    expect(trendingOptions).toEqual({ timeout: 3000 });

    expect(buildFreeAgentsMock).toHaveBeenCalledWith(
      playersIndex,
      new Set(['101']),
      undefined,
      10,
      new Map([
        ['201', 42],
        ['202', 7],
      ]),
    );
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
    const data = result.data as { warning?: string; warnings?: string[] };
    expect(data.warning).toContain('PLAYER_ENRICHMENT_UNAVAILABLE');
    // warnings[] mirrors the legacy singular warning so Sleeper tools expose
    // degradation consistently, without removing the field published clients read.
    expect(data.warnings).toEqual([data.warning]);
  });
});
