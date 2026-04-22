import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { baseballHandlers } from '../baseball/handlers';
import { basketballHandlers } from '../basketball/handlers';
import { footballHandlers } from '../football/handlers';
import { hockeyHandlers } from '../hockey/handlers';
import type { HandlerToolParams, Sport, ToolParams } from '../../types';
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

function makeParams(sport: Sport, overrides: Partial<ToolParams> = {}): HandlerToolParams {
  return withSeasonContext({
    sport,
    league_id: '123',
    season_year: 2024,
    ...overrides,
  });
}

const mockRosterResponse = {
  teams: [
    {
      id: 6,
      name: 'Team 6',
      owners: [{ displayName: 'Mike Johnson', firstName: 'Mike' }],
      roster: {
        entries: [
          {
            playerPoolEntry: {
              player: {
                id: 42,
                fullName: 'Paul Skenes',
                defaultPositionId: 1,
                eligibleSlots: [0],
                proTeamId: 1,
              },
            },
            lineupSlotId: 0,
          },
        ],
      },
    },
    {
      id: 1,
      location: 'Gerry',
      nickname: 'Sluggers',
      owners: [{ displayName: 'Gerry G' }],
      roster: { entries: [] },
    },
  ],
};

describe('espn cross-sport get_roster ownerName', () => {
  const getCredentialsMock = getCredentials as MockedFunction<typeof getCredentials>;
  const espnFetchMock = espnFetch as MockedFunction<typeof espnFetch>;

  beforeEach(() => {
    vi.resetAllMocks();
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
  });

  it.each(scenarios)('$label includes ownerName in roster response', async ({ sport, handlers }) => {
    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockRosterResponse), { status: 200 })
    );

    const params = makeParams(sport, { team_id: '6' });
    const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as {
      teamId: number;
      teamName: string;
      ownerName?: string;
      roster: Array<{ name: string }>;
    };

    expect(data.teamId).toBe(6);
    expect(data.teamName).toBe('Team 6');
    expect(data.ownerName).toBe('Mike Johnson');
    expect(data.roster).toHaveLength(1);
    expect(data.roster[0].name).toBe('Paul Skenes');
  });

  it.each(scenarios)('$label requests mTeam view alongside mRoster', async ({ sport, handlers, expectedEspnYear }) => {
    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockRosterResponse), { status: 200 })
    );

    const params = makeParams(sport, { team_id: '6' });
    await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

    const fetchPath = espnFetchMock.mock.calls[0][0] as string;
    expect(fetchPath).toContain(`/seasons/${expectedEspnYear}/segments/0/leagues/123`);
    expect(fetchPath).toContain('view=mRoster');
    expect(fetchPath).toContain('view=mTeam');
  });

  it.each(scenarios)('$label handles missing owners gracefully', async ({ sport, handlers }) => {
    const noOwnerResponse = {
      teams: [{
        id: 3,
        location: 'No',
        nickname: 'Owner',
        roster: { entries: [] },
      }],
    };

    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(noOwnerResponse), { status: 200 })
    );

    const params = makeParams(sport, { team_id: '3' });
    const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as { ownerName?: string };
    expect(data.ownerName).toBeUndefined();
  });

  it.each(scenarios)('$label skips empty owner objects and finds valid co-owner', async ({ sport, handlers }) => {
    const emptyFirstOwnerResponse = {
      teams: [{
        id: 5,
        name: 'Team 5',
        owners: [{}, { displayName: 'Bob' }],
        roster: { entries: [] },
      }],
    };

    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(emptyFirstOwnerResponse), { status: 200 })
    );

    const params = makeParams(sport, { team_id: '5' });
    const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as { ownerName?: string };
    expect(data.ownerName).toBe('Bob');
  });
});
