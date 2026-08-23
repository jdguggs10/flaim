// workers/espn-client/src/sports/__tests__/roster-keeper-value-cross-sport.test.ts
import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { baseballHandlers } from '../baseball/handlers';
import { basketballHandlers } from '../basketball/handlers';
import { footballHandlers } from '../football/handlers';
import { hockeyHandlers } from '../hockey/handlers';
import type { HandlerToolParams, Sport, ToolParams } from '../../types';
import { getCredentials } from '../../shared/auth';
import { espnFetch } from '../../shared/espn-api';
import { clearScoringPeriodAnchorCache } from '../../shared/scoring-period';
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
  { label: 'football', sport: 'football', handlers: footballHandlers },
  { label: 'baseball', sport: 'baseball', handlers: baseballHandlers },
  { label: 'basketball', sport: 'basketball', handlers: basketballHandlers },
  { label: 'hockey', sport: 'hockey', handlers: hockeyHandlers },
] as const;

const dailyScenarios = [
  { label: 'baseball', sport: 'baseball', handlers: baseballHandlers },
  { label: 'basketball', sport: 'basketball', handlers: basketballHandlers },
  { label: 'hockey', sport: 'hockey', handlers: hockeyHandlers },
] as const;

// Constant-offset calendar for resolving an as_of_date snapshot to a
// scoringPeriodId, matching the pattern in roster-snapshot-cross-sport.test.ts.
// Period n corresponds to 2024-04-(n+9) ET.
function calendarResponse(): Response {
  const periods: Record<string, Array<{ date: number }>> = {};
  for (let period = 1; period <= 20; period += 1) {
    const day = String(period + 9).padStart(2, '0');
    periods[String(period)] = [{ date: Date.parse(`2024-04-${day}T23:00:00Z`) }];
  }
  return new Response(JSON.stringify({
    settings: { proTeams: [{ proGamesByScoringPeriod: periods }] },
  }), { status: 200 });
}

function makeParams(sport: Sport, overrides: Partial<ToolParams> = {}): HandlerToolParams {
  return withSeasonContext({
    sport,
    league_id: '123',
    season_year: 2024,
    ...overrides,
  });
}

function rosterEntry(playerId: number, keeperValue?: number, keeperValueFuture?: number) {
  return {
    playerPoolEntry: {
      player: {
        id: playerId,
        fullName: `Player ${playerId}`,
        defaultPositionId: 1,
        eligibleSlots: [0],
        proTeamId: 1,
      },
      ...(keeperValue !== undefined ? { keeperValue } : {}),
      ...(keeperValueFuture !== undefined ? { keeperValueFuture } : {}),
    },
    lineupSlotId: 0,
    acquisitionType: 'DRAFT',
    acquisitionDate: 1700000000000,
  };
}

type RosterData = {
  keeperValueUnit?: string;
  isKeeperLeague?: boolean;
  roster: Array<{
    playerId?: number;
    keeperValue?: number;
    keeperValueFuture?: number;
  }>;
};

describe('espn cross-sport get_roster keeper value passthrough', () => {
  const getCredentialsMock = getCredentials as MockedFunction<typeof getCredentials>;
  const espnFetchMock = espnFetch as MockedFunction<typeof espnFetch>;

  beforeEach(() => {
    vi.resetAllMocks();
    clearScoringPeriodAnchorCache();
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
  });

  it.each(scenarios)('$label — auction league: keeperValue/keeperValueFuture pass through with keeperValueUnit auction_dollars', async ({ sport, handlers }) => {
    const mockResponse = {
      settings: {
        draftSettings: { keeperCount: 21, type: 'AUCTION' },
      },
      teams: [
        {
          id: 6,
          name: 'Team 6',
          owners: [{ displayName: 'Mike Johnson' }],
          roster: {
            entries: [rosterEntry(42, 79, 75)],
          },
        },
      ],
    };

    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const params = makeParams(sport, { team_id: '6' });
    const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as RosterData;

    expect(data.keeperValueUnit).toBe('auction_dollars');
    expect(data.isKeeperLeague).toBe(true);
    expect(data.roster).toHaveLength(1);
    expect(data.roster[0].keeperValue).toBe(79);
    expect(data.roster[0].keeperValueFuture).toBe(75);
  });

  it.each(scenarios)('$label — snake league: keeperValueUnit is draft_round', async ({ sport, handlers }) => {
    const mockResponse = {
      settings: {
        draftSettings: { keeperCount: 5, type: 'SNAKE' },
      },
      teams: [
        {
          id: 6,
          name: 'Team 6',
          roster: {
            entries: [rosterEntry(42, 3, 4)],
          },
        },
      ],
    };

    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const params = makeParams(sport, { team_id: '6' });
    const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as RosterData;

    expect(data.keeperValueUnit).toBe('draft_round');
    expect(data.roster[0].keeperValue).toBe(3);
    expect(data.roster[0].keeperValueFuture).toBe(4);
  });

  it.each(scenarios)('$label — autopick league: keeperValueUnit is draft_round', async ({ sport, handlers }) => {
    const mockResponse = {
      settings: {
        draftSettings: { keeperCount: 5, type: 'AUTOPICK' },
      },
      teams: [
        {
          id: 6,
          name: 'Team 6',
          roster: {
            entries: [rosterEntry(42, 3, 4)],
          },
        },
      ],
    };

    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const params = makeParams(sport, { team_id: '6' });
    const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as RosterData;

    expect(data.keeperValueUnit).toBe('draft_round');
  });

  it.each(scenarios)('$label — offline draft type: keeperValueUnit is omitted (unknown unit, not guessed)', async ({ sport, handlers }) => {
    const mockResponse = {
      settings: {
        draftSettings: { keeperCount: 5, type: 'OFFLINE' },
      },
      teams: [
        {
          id: 6,
          name: 'Team 6',
          roster: {
            entries: [rosterEntry(42, 3, 4)],
          },
        },
      ],
    };

    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const params = makeParams(sport, { team_id: '6' });
    const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as RosterData;

    expect(data.keeperValueUnit).toBeUndefined();
    expect('keeperValueUnit' in data).toBe(false);
  });

  it.each(scenarios)('$label — unknown/unrecognized draft type string: keeperValueUnit is omitted (unknown unit, not guessed)', async ({ sport, handlers }) => {
    const mockResponse = {
      settings: {
        draftSettings: { keeperCount: 5, type: 'SOME_FUTURE_TYPE' },
      },
      teams: [
        {
          id: 6,
          name: 'Team 6',
          roster: {
            entries: [rosterEntry(42, 3, 4)],
          },
        },
      ],
    };

    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const params = makeParams(sport, { team_id: '6' });
    const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as RosterData;

    expect(data.keeperValueUnit).toBeUndefined();
    expect('keeperValueUnit' in data).toBe(false);
  });

  it.each(scenarios)('$label — roster entries without keeperValue leave the field undefined, no crash', async ({ sport, handlers }) => {
    const mockResponse = {
      settings: {
        draftSettings: { keeperCount: 5, type: 'SNAKE' },
      },
      teams: [
        {
          id: 6,
          name: 'Team 6',
          roster: {
            entries: [rosterEntry(42)],
          },
        },
      ],
    };

    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const params = makeParams(sport, { team_id: '6' });
    const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as RosterData;

    expect(data.roster[0].keeperValue).toBeUndefined();
    expect(data.roster[0].keeperValueFuture).toBeUndefined();
  });

  it.each(scenarios)('$label — no settings in payload omits keeperValueUnit and isKeeperLeague entirely (does not guess)', async ({ sport, handlers }) => {
    const mockResponse = {
      teams: [
        {
          id: 6,
          name: 'Team 6',
          roster: {
            entries: [rosterEntry(42, 8, 8)],
          },
        },
      ],
    };

    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const params = makeParams(sport, { team_id: '6' });
    const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as RosterData;

    expect(data.keeperValueUnit).toBeUndefined();
    expect('keeperValueUnit' in data).toBe(false);
    expect(data.isKeeperLeague).toBeUndefined();
    expect('isKeeperLeague' in data).toBe(false);
    // keeperValue itself still passes through — it lives on playerPoolEntry,
    // independent of whether mSettings happened to be present.
    expect(data.roster[0].keeperValue).toBe(8);
  });

  it.each(scenarios)('$label — requests mSettings alongside mRoster/mTeam', async ({ sport, handlers }) => {
    const mockResponse = {
      settings: { draftSettings: { keeperCount: 5, type: 'SNAKE' } },
      teams: [{ id: 6, name: 'Team 6', roster: { entries: [] } }],
    };

    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const params = makeParams(sport, { team_id: '6' });
    await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

    const fetchPath = espnFetchMock.mock.calls[0][0] as string;
    expect(fetchPath).toContain('view=mRoster');
    expect(fetchPath).toContain('view=mTeam');
    expect(fetchPath).toContain('view=mSettings');
  });
});

// FLA-284 temporal purity: keeperValueFuture is next season's cost, not yet
// fixed as of a past week/date, so historical snapshots must withhold it
// entirely (mirroring the FLA-278 proTeam/injuryStatus omission) and flag
// `limitations.keeperValueFutureAvailable: false`. keeperValue (this
// season's cost, season-stable) is unaffected.
describe('espn get_roster keeperValueFuture temporal purity (FLA-284)', () => {
  const getCredentialsMock = getCredentials as MockedFunction<typeof getCredentials>;
  const espnFetchMock = espnFetch as MockedFunction<typeof espnFetch>;

  beforeEach(() => {
    vi.resetAllMocks();
    clearScoringPeriodAnchorCache();
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
  });

  function keeperRosterResponse(): unknown {
    return {
      settings: { draftSettings: { keeperCount: 5, type: 'SNAKE' } },
      teams: [{ id: 6, name: 'Team 6', roster: { entries: [rosterEntry(42, 3, 4)] } }],
    };
  }

  it('football: omits keeperValueFuture on a historical week snapshot and flags keeperValueFutureAvailable', async () => {
    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(keeperRosterResponse()), { status: 200 })
    );

    const params = makeParams('football', { team_id: '6', week: 5 });
    const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as RosterData & { limitations?: Record<string, unknown> };

    expect(data.roster[0].keeperValue).toBe(3);
    expect(data.roster[0].keeperValueFuture).toBeUndefined();
    expect('keeperValueFuture' in data.roster[0]).toBe(false);
    expect(data.limitations).toEqual({ playerProTeamAvailable: false, keeperValueFutureAvailable: false });
  });

  it.each(dailyScenarios)('$label: omits keeperValueFuture on a historical date snapshot and flags keeperValueFutureAvailable', async ({ sport, handlers }) => {
    espnFetchMock.mockImplementation(async (path: unknown) => {
      const p = path as string;
      if (p.includes('proTeamSchedules_wl')) return calendarResponse();
      return new Response(JSON.stringify(keeperRosterResponse()), { status: 200 });
    });

    const params = makeParams(sport, { team_id: '6', snapshot: { type: 'date', date: '2024-04-15' } });
    const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as RosterData & { limitations?: Record<string, unknown> };

    expect(data.roster[0].keeperValue).toBe(3);
    expect(data.roster[0].keeperValueFuture).toBeUndefined();
    expect('keeperValueFuture' in data.roster[0]).toBe(false);
    expect(data.limitations).toEqual({ playerProTeamAvailable: false, keeperValueFutureAvailable: false });
  });

  it.each(scenarios)('$label — current snapshot keeps keeperValueFuture unchanged', async ({ sport, handlers }) => {
    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(keeperRosterResponse()), { status: 200 })
    );

    const params = makeParams(sport, { team_id: '6' });
    const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as RosterData & { limitations?: unknown };

    expect(data.roster[0].keeperValue).toBe(3);
    expect(data.roster[0].keeperValueFuture).toBe(4);
    expect(data.limitations).toBeUndefined();
  });
});
