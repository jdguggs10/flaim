import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { footballHandlers } from '../football/handlers';
import type { HandlerToolParams } from '../../types';
import { getCredentials } from '../../shared/auth';
import { espnFetch } from '../../shared/espn-api';
import { getEspnPlayersIndex } from '../../shared/espn-players-cache';
import { withSeasonContext } from '../../shared/season';

vi.mock('../../shared/auth', () => ({ getCredentials: vi.fn() }));
vi.mock('../../shared/espn-players-cache', () => ({ getEspnPlayersIndex: vi.fn() }));
vi.mock('../../shared/espn-api', async () => {
  const actual = await vi.importActual('../../shared/espn-api') as Record<string, unknown>;
  return { ...actual, espnFetch: vi.fn() };
});

const SEASON = 2026;

function makeParams(count = 10): HandlerToolParams {
  return withSeasonContext({
    sport: 'football',
    league_id: '123',
    season_year: SEASON,
    query: 'Search',
    count,
  });
}

function seasonStats(appliedTotal: number | null | undefined, appliedAverage: number | null | undefined) {
  return [
    // These weekly values must never win merely because ESPN lists them first.
    { id: '0120264', seasonId: SEASON, statSourceId: 0, statSplitTypeId: 1, scoringPeriodId: 4, appliedTotal: 999, appliedAverage: 99 },
    { id: '002026', seasonId: SEASON, statSourceId: 0, statSplitTypeId: 0, scoringPeriodId: 0, appliedTotal, appliedAverage },
  ];
}

function rosterResponse(entries: Array<{ id: number; stats?: ReturnType<typeof seasonStats> }>) {
  return new Response(JSON.stringify({
    teams: [{
      id: 1,
      name: 'Team One',
      roster: {
        entries: entries.map(({ id, stats }) => ({
          playerPoolEntry: { player: { id, stats } },
        })),
      },
    }],
  }), { status: 200 });
}

function freeAgentResponse(entries: Array<{ id: number; stats?: ReturnType<typeof seasonStats> }>) {
  return new Response(JSON.stringify({
    players: entries.map(({ id, stats }) => ({
      player: { id, stats },
      status: 'FREEAGENT',
    })),
  }), { status: 200 });
}

describe('ESPN football get_players league scoring (FLA-421)', () => {
  const getCredentialsMock = getCredentials as MockedFunction<typeof getCredentials>;
  const getPlayersIndexMock = getEspnPlayersIndex as MockedFunction<typeof getEspnPlayersIndex>;
  const espnFetchMock = espnFetch as MockedFunction<typeof espnFetch>;

  beforeEach(() => {
    vi.resetAllMocks();
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    getPlayersIndexMock.mockResolvedValue(new Map([
      [1, { id: 1, fullName: 'Search Rostered', defaultPositionId: 1, proTeamId: 1, percentOwned: 90 }],
      [2, { id: 2, fullName: 'Search Zero', defaultPositionId: 2, proTeamId: 2, percentOwned: 80 }],
      [3, { id: 3, fullName: 'Search Null', defaultPositionId: 3, proTeamId: 3, percentOwned: 70 }],
      [4, { id: 4, fullName: 'Search Free Agent', defaultPositionId: 4, proTeamId: 4, percentOwned: 60 }],
      [5, { id: 5, fullName: 'Search Outside Pool', defaultPositionId: 5, proTeamId: 5, percentOwned: 50 }],
    ]));
  });

  it('uses pinned mRoster scoring for rostered matches and one shared pool request for unrostered matches', async () => {
    espnFetchMock.mockImplementation(async (path: string) => {
      if (path.includes('view=mRoster')) {
        return rosterResponse([
          { id: 1, stats: seasonStats(12.345, 2.345) },
          { id: 2, stats: seasonStats(0, 0) },
          { id: 3, stats: seasonStats(undefined, null) },
        ]);
      }
      if (path.includes('view=kona_player_info')) {
        return freeAgentResponse([{ id: 4, stats: seasonStats(22.225, 4.445) }]);
      }
      throw new Error(`unexpected ESPN path: ${path}`);
    });

    const result = await footballHandlers.get_players({} as never, makeParams(), 'Bearer x', 'cid');
    expect(result.success).toBe(true);
    if (!result.success) return;

    const players = (result.data as { players: Array<Record<string, unknown>> }).players;
    expect(players).toHaveLength(5);
    expect(players).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '1', league_status: 'ROSTERED', seasonPoints: 12.35, pointsPerGame: 2.35 }),
      expect.objectContaining({ id: '2', league_status: 'ROSTERED', seasonPoints: 0, pointsPerGame: 0 }),
      expect.objectContaining({ id: '3', league_status: 'ROSTERED', seasonPoints: null, pointsPerGame: null }),
      expect.objectContaining({ id: '4', league_status: 'FREE_AGENT', seasonPoints: 22.23, pointsPerGame: 4.45 }),
      // ESPN's 100-player availability pool did not return this unrostered result.
      expect.objectContaining({ id: '5', league_status: 'FREE_AGENT', seasonPoints: null, pointsPerGame: null }),
    ]));

    expect(espnFetchMock).toHaveBeenCalledTimes(2);
    const poolCall = espnFetchMock.mock.calls.find(([path]) => String(path).includes('view=kona_player_info'));
    expect(poolCall).toBeDefined();
    const filter = JSON.parse(String(poolCall?.[2]?.headers?.['X-Fantasy-Filter']));
    expect(filter).toEqual({
      players: {
        filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
        sortPercOwned: { sortPriority: 1, sortAsc: false },
        limit: 100,
      },
    });
    expect(JSON.stringify(filter)).not.toContain('filterIds');
  });

  it('skips the free-agent request when every matching player is rostered', async () => {
    getPlayersIndexMock.mockResolvedValue(new Map([
      [1, { id: 1, fullName: 'Search Rostered', defaultPositionId: 1, proTeamId: 1, percentOwned: 90 }],
      [2, { id: 2, fullName: 'Search Zero', defaultPositionId: 2, proTeamId: 2, percentOwned: 80 }],
    ]));
    espnFetchMock.mockResolvedValue(rosterResponse([
      { id: 1, stats: seasonStats(12, 2) },
      { id: 2, stats: seasonStats(0, 0) },
    ]));

    const result = await footballHandlers.get_players({} as never, makeParams(), 'Bearer x', 'cid');
    expect(result.success).toBe(true);
    expect(espnFetchMock).toHaveBeenCalledTimes(1);
    expect(String(espnFetchMock.mock.calls[0]?.[0])).toContain('view=mRoster');
  });

  it('keeps the existing maximum of 25 search matches', async () => {
    getPlayersIndexMock.mockResolvedValue(new Map(Array.from({ length: 30 }, (_, index) => [
      index + 1,
      { id: index + 1, fullName: `Search ${index + 1}`, defaultPositionId: 1, proTeamId: 1, percentOwned: null },
    ])));
    espnFetchMock.mockResolvedValue(rosterResponse(Array.from({ length: 30 }, (_, index) => ({
      id: index + 1,
      stats: seasonStats(index, 1),
    }))));

    const result = await footballHandlers.get_players({} as never, makeParams(100), 'Bearer x', 'cid');
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((result.data as { players: unknown[] }).players).toHaveLength(25);
    expect(espnFetchMock).toHaveBeenCalledTimes(1);
  });
});
