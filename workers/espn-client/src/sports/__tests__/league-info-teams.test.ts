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

const scenarios = [
  { label: 'football', sport: 'football', handlers: footballHandlers, expectedEspnYear: 2024 },
  { label: 'baseball', sport: 'baseball', handlers: baseballHandlers, expectedEspnYear: 2024 },
  { label: 'basketball', sport: 'basketball', handlers: basketballHandlers, expectedEspnYear: 2025 },
  { label: 'hockey', sport: 'hockey', handlers: hockeyHandlers, expectedEspnYear: 2025 },
] as const;

const crossCalendarScenarios = scenarios.filter(
  (scenario) => scenario.sport === 'basketball' || scenario.sport === 'hockey'
);

function makeParams(sport: Sport): HandlerToolParams {
  return withSeasonContext({
    sport,
    league_id: '123',
    season_year: 2024,
  });
}

const mockLeagueResponse = {
  id: 123,
  seasonId: 2025,
  segmentId: 0,
  scoringPeriodId: 5,
  currentMatchupPeriod: 5,
  status: {
    currentMatchupPeriod: 5,
    isActive: true,
    previousSeasons: [2024, 2025],
  },
  settings: {
    name: 'Test League',
    size: 10,
    scoringSettings: { scoringType: 'H2H_POINTS' },
    rosterSettings: { lineupSlotCounts: {} },
    scheduleSettings: {},
  },
  teams: [
    {
      id: 1,
      location: 'Gerry',
      nickname: 'Sluggers',
      abbrev: 'GS',
      owners: [{ displayName: 'Gerry G', firstName: 'Gerry' }],
    },
    {
      id: 6,
      name: 'Team 6',
      abbrev: 'T6',
      owners: [{ firstName: 'Mike' }],
    },
    {
      id: 7,
      location: 'The',
      nickname: 'Aces',
      abbrev: 'TA',
      // No owners array — tests graceful fallback
    },
    {
      id: 8,
      name: 'Ghost Team',
      abbrev: 'GT',
      // Owner object exists but has no name fields — should not produce "Unknown"
      owners: [{}],
    },
  ],
};

describe('espn cross-sport get_league_info teams array', () => {
  const getCredentialsMock = getCredentials as MockedFunction<typeof getCredentials>;
  const espnFetchMock = espnFetch as MockedFunction<typeof espnFetch>;

  beforeEach(() => {
    vi.resetAllMocks();
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
  });

  it.each(scenarios)('$label returns teams with ownerName and owners', async ({ sport, handlers }) => {
    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockLeagueResponse), { status: 200 })
    );

    const params = makeParams(sport);
    const result = await handlers.get_league_info({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as {
      teams: Array<{
        teamId: number;
        teamName: string;
        abbrev: string;
        ownerName?: string;
        owners?: string[];
      }>;
    };

    expect(data.teams).toHaveLength(4);

    // Team with displayName owner
    expect(data.teams[0]).toEqual({
      teamId: 1,
      teamName: 'Gerry Sluggers',
      abbrev: 'GS',
      ownerName: 'Gerry G',
      owners: ['Gerry G'],
    });

    // Team with only firstName owner
    expect(data.teams[1]).toEqual({
      teamId: 6,
      teamName: 'Team 6',
      abbrev: 'T6',
      ownerName: 'Mike',
      owners: ['Mike'],
    });

    // Team with no owners array
    expect(data.teams[2]).toEqual({
      teamId: 7,
      teamName: 'The Aces',
      abbrev: 'TA',
      ownerName: undefined,
      owners: undefined,
    });

    // Team with empty owner object — must not fabricate "Unknown"
    expect(data.teams[3]).toEqual({
      teamId: 8,
      teamName: 'Ghost Team',
      abbrev: 'GT',
      ownerName: undefined,
      owners: undefined,
    });
  });

  it.each(scenarios)('$label keeps outward seasonId canonical', async ({ sport, handlers }) => {
    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockLeagueResponse), { status: 200 })
    );

    const params = makeParams(sport);
    const result = await handlers.get_league_info({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as { seasonId?: number };

    expect(data.seasonId).toBe(2024);
  });

  it.each(crossCalendarScenarios)('$label normalizes status.previousSeasons to canonical years', async ({ sport, handlers }) => {
    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockLeagueResponse), { status: 200 })
    );

    const params = makeParams(sport);
    const result = await handlers.get_league_info({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as {
      status?: {
        previousSeasons?: number[];
      };
    };

    expect(data.status?.previousSeasons).toEqual([2023, 2024]);
  });

  it.each(scenarios)('$label requests mTeam view in API path', async ({ sport, handlers, expectedEspnYear }) => {
    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockLeagueResponse), { status: 200 })
    );

    const params = makeParams(sport);
    await handlers.get_league_info({} as never, params, 'Bearer x', 'cid');

    const fetchPath = espnFetchMock.mock.calls[0][0] as string;
    expect(fetchPath).toContain(`/seasons/${expectedEspnYear}/segments/0/leagues/123`);
    expect(fetchPath).toContain('view=mSettings');
    expect(fetchPath).toContain('view=mTeam');
  });
});
