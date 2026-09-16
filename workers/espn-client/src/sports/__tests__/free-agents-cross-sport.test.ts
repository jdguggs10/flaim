import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { baseballHandlers } from '../baseball/handlers';
import { basketballHandlers } from '../basketball/handlers';
import { footballHandlers } from '../football/handlers';
import { hockeyHandlers } from '../hockey/handlers';
import type { HandlerToolParams, Sport } from '../../types';
import { getCredentials } from '../../shared/auth';
import { espnFetch } from '../../shared/espn-api';
import { withSeasonContext } from '../../shared/season';

vi.mock('../../shared/auth', () => ({
  getCredentials: vi.fn(),
}));

vi.mock('../../shared/espn-api', async () => {
  const actual = await vi.importActual('../../shared/espn-api') as Record<string, unknown>;
  return {
    ...actual,
    espnFetch: vi.fn(),
  };
});

// football/baseball look up stats by the raw season_year; basketball/hockey
// convert canonicalYear 2024 -> ESPN-native espnYear 2025 first (see
// search-players-cross-sport.test.ts for the same conversion table).
const scenarios = [
  { label: 'football', sport: 'football', handlers: footballHandlers, statsSeasonId: 2024 },
  { label: 'baseball', sport: 'baseball', handlers: baseballHandlers, statsSeasonId: 2024 },
  { label: 'basketball', sport: 'basketball', handlers: basketballHandlers, statsSeasonId: 2025 },
  { label: 'hockey', sport: 'hockey', handlers: hockeyHandlers, statsSeasonId: 2025 },
] as const;

function makeParams(sport: Sport): HandlerToolParams {
  return withSeasonContext({
    sport,
    league_id: '123',
    season_year: 2024,
    count: 10,
  });
}

function playerPoolResponse(statsSeasonId: number): Response {
  const buildStats = (offset: number) => [
    // weekly entries listed first to defeat a naive .find()
    { seasonId: statsSeasonId, statSourceId: 0, statSplitTypeId: 1, scoringPeriodId: 7, appliedTotal: 999, appliedAverage: 999 },
    { seasonId: statsSeasonId, statSourceId: 1, statSplitTypeId: 1, scoringPeriodId: 7, appliedTotal: 888, appliedAverage: 888 },
    { seasonId: statsSeasonId, statSourceId: 0, statSplitTypeId: 0, scoringPeriodId: 0, appliedTotal: 100 + offset, appliedAverage: 10 + offset },
    { seasonId: statsSeasonId, statSourceId: 1, statSplitTypeId: 0, scoringPeriodId: 0, appliedTotal: 150 + offset, appliedAverage: 15 + offset },
  ];

  return new Response(JSON.stringify({
    players: [
      {
        player: {
          id: 1,
          fullName: 'Free Agent One',
          defaultPositionId: 0,
          eligibleSlots: [],
          proTeamId: 1,
          ownership: { percentOwned: 12.3, percentStarted: 4.5 },
          stats: buildStats(0),
        },
        status: 'FREEAGENT',
        waiverProcessDate: 1700000000000,
      },
      {
        player: {
          id: 2,
          fullName: 'Free Agent Two',
          defaultPositionId: 0,
          eligibleSlots: [],
          proTeamId: 2,
          ownership: { percentOwned: 33.7, percentStarted: 20.1 },
          stats: buildStats(1),
        },
        status: 'WAIVERS',
        waiverProcessDate: 1700000001000,
      },
    ],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('espn cross-sport get_free_agents handlers (FLA-132)', () => {
  const getCredentialsMock = getCredentials as MockedFunction<typeof getCredentials>;
  const espnFetchMock = espnFetch as MockedFunction<typeof espnFetch>;

  beforeEach(() => {
    vi.resetAllMocks();
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
  });

  it.each(scenarios)('$label returns rankable scoring scalars instead of a raw stats dictionary', async ({ sport, handlers, statsSeasonId }) => {
    espnFetchMock.mockResolvedValue(playerPoolResponse(statsSeasonId));

    const params = makeParams(sport);
    const result = await handlers.get_free_agents({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;

    const data = result.data as {
      leagueId: string;
      seasonYear: number;
      position: string;
      count: number;
      freeAgents: Array<Record<string, unknown>>;
    };

    expect(data.leagueId).toBe('123');
    expect(data.seasonYear).toBe(2024);
    expect(data.position).toBe('ALL');
    expect(data.count).toBe(2);
    expect(data.freeAgents).toHaveLength(2);

    expect(data.freeAgents[0]).toMatchObject({
      playerId: 1,
      name: 'Free Agent One',
      percentOwned: 12.3,
      percentStarted: 4.5,
      status: 'FREEAGENT',
      waiverProcessDate: 1700000000000,
      seasonPoints: 100,
      pointsPerGame: 10,
      projectedSeasonPoints: 150,
    });
    expect(data.freeAgents[0]).toHaveProperty('position');
    expect(data.freeAgents[0]).toHaveProperty('proTeam');
    expect(data.freeAgents[0]).not.toHaveProperty('stats');

    expect(data.freeAgents[1]).toMatchObject({
      playerId: 2,
      name: 'Free Agent Two',
      percentOwned: 33.7,
      percentStarted: 20.1,
      status: 'WAIVERS',
      waiverProcessDate: 1700000001000,
      seasonPoints: 101,
      pointsPerGame: 11,
      projectedSeasonPoints: 151,
    });
    expect(data.freeAgents[1]).not.toHaveProperty('stats');
  });
});
