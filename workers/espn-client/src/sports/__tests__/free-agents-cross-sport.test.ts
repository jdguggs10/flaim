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
//
// Football is the only sport where the raw per-stat dictionary was dropped:
// ESPN scores every football league in points, so the scalars always carry a
// number there. Baseball, basketball, and hockey leagues are often category or
// rotisserie leagues where ESPN applies no points at all, so those three keep
// the dictionary alongside the scalars.
const scenarios = [
  { label: 'football', sport: 'football', handlers: footballHandlers, statsSeasonId: 2024, keepsStatsDictionary: false },
  { label: 'baseball', sport: 'baseball', handlers: baseballHandlers, statsSeasonId: 2024, keepsStatsDictionary: true },
  { label: 'basketball', sport: 'basketball', handlers: basketballHandlers, statsSeasonId: 2025, keepsStatsDictionary: true },
  { label: 'hockey', sport: 'hockey', handlers: hockeyHandlers, statsSeasonId: 2025, keepsStatsDictionary: true },
] as const;

function makeParams(sport: Sport): HandlerToolParams {
  return withSeasonContext({
    sport,
    league_id: '123',
    season_year: 2024,
    count: 10,
  });
}

// Stat id 999 maps to no named stat in any of the four sports, so every
// sport's transformStats renders it as "STAT_999" and one expectation covers
// all of them.
const UNMAPPED_STAT_ID = '999';

function playerPoolResponse(statsSeasonId: number): Response {
  const buildStats = (offset: number) => [
    // weekly entries listed first, and each raw stats map carries a distinct
    // value, so a naive .find() would surface the wrong dictionary too
    { seasonId: statsSeasonId, statSourceId: 0, statSplitTypeId: 1, scoringPeriodId: 7, appliedTotal: 999, appliedAverage: 999, stats: { [UNMAPPED_STAT_ID]: 777 } },
    { seasonId: statsSeasonId, statSourceId: 1, statSplitTypeId: 1, scoringPeriodId: 7, appliedTotal: 888, appliedAverage: 888, stats: { [UNMAPPED_STAT_ID]: 666 } },
    { seasonId: statsSeasonId, statSourceId: 0, statSplitTypeId: 0, scoringPeriodId: 0, appliedTotal: 100 + offset, appliedAverage: 10 + offset, stats: { [UNMAPPED_STAT_ID]: 7 + offset } },
    { seasonId: statsSeasonId, statSourceId: 1, statSplitTypeId: 0, scoringPeriodId: 0, appliedTotal: 150 + offset, appliedAverage: 15 + offset, stats: { [UNMAPPED_STAT_ID]: 555 } },
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

  it.each(scenarios)('$label returns rankable scoring scalars from the pinned season split', async ({ sport, handlers, statsSeasonId, keepsStatsDictionary }) => {
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

    if (!keepsStatsDictionary) {
      // Football only: the raw dictionary is gone from the payload entirely.
      expect(data.freeAgents[0]).not.toHaveProperty('stats');
      expect(data.freeAgents[1]).not.toHaveProperty('stats');
      return;
    }

    // The dictionary must come from the pinned actual-season split, not the
    // weekly entry listed first (777) and not the projected season split (555).
    expect(data.freeAgents[0].stats).toEqual({ STAT_999: 7 });
    expect(data.freeAgents[1].stats).toEqual({ STAT_999: 8 });
  });
});
