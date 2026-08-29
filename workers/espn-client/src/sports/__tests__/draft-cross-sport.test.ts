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
  { label: 'football', sport: 'football', handlers: footballHandlers, espnYear: 2024 },
  { label: 'baseball', sport: 'baseball', handlers: baseballHandlers, espnYear: 2024 },
  { label: 'basketball', sport: 'basketball', handlers: basketballHandlers, espnYear: 2025 },
  { label: 'hockey', sport: 'hockey', handlers: hockeyHandlers, espnYear: 2025 },
] as const;

function makeParams(sport: Sport): HandlerToolParams {
  return withSeasonContext({
    sport,
    league_id: '123',
    season_year: 2024,
  });
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200 });
}

type DraftData = {
  platform: string;
  sport: string;
  leagueId: string;
  seasonYear: number;
  draft: { type: string; status: string };
  picks: Array<Record<string, unknown>>;
  warnings?: string[];
};

describe('espn cross-sport get_draft', () => {
  const getCredentialsMock = getCredentials as MockedFunction<typeof getCredentials>;
  const espnFetchMock = espnFetch as MockedFunction<typeof espnFetch>;

  beforeEach(() => {
    vi.resetAllMocks();
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
  });

  it.each(scenarios)('$label maps completed snake picks as confirmed provider results', async ({ sport, handlers }) => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      settings: { draftSettings: { type: 'SNAKE' } },
      draftDetail: {
        drafted: true,
        picks: [{
          roundId: 2,
          roundPickNumber: 3,
          overallPickNumber: 15,
          playerId: 101,
          teamId: 7,
          keeper: false,
          bidAmount: 47,
        }],
      },
    }));

    const result = await handlers.get_draft({} as never, makeParams(sport), 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as DraftData;
    expect(data).toMatchObject({
      platform: 'espn',
      sport,
      leagueId: '123',
      seasonYear: 2024,
      draft: { type: 'snake', status: 'complete' },
    });
    expect(data.picks).toEqual([{
      round: 2,
      selectionInRound: 3,
      overallPick: 15,
      selectionTeamId: 7,
      playerId: 101,
      isKeeper: false,
      placement: { status: 'confirmed', source: 'provider_pick' },
    }]);
    expect(data.picks[0]).not.toHaveProperty('cost');
    expect(data).not.toHaveProperty('ownership');
  });

  it.each(scenarios)('$label maps auction keeper cost in auction dollars', async ({ sport, handlers }) => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      settings: { draftSettings: { type: 'AUCTION' } },
      draftDetail: {
        drafted: true,
        picks: [{ roundId: 1, playerId: 202, teamId: 3, keeper: true, bidAmount: 22 }],
      },
    }));

    const result = await handlers.get_draft({} as never, makeParams(sport));

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as DraftData;
    expect(data.draft.type).toBe('auction');
    expect(data.picks[0]).toMatchObject({
      round: 1,
      playerId: 202,
      selectionTeamId: 3,
      isKeeper: true,
      cost: { amount: 22, unit: 'auction_dollars' },
      placement: { status: 'confirmed', source: 'provider_pick' },
    });
  });

  it.each(scenarios)('$label filters pre-draft empty slots and warns instead of projecting a board', async ({ sport, handlers }) => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      settings: { draftSettings: { type: 'SNAKE' } },
      draftDetail: {
        drafted: false,
        picks: [
          { roundId: 1, roundPickNumber: 1, overallPickNumber: 1, teamId: 1 },
          { roundId: 1, roundPickNumber: 2, overallPickNumber: 2, teamId: 2 },
        ],
      },
    }));

    const result = await handlers.get_draft({} as never, makeParams(sport));

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as DraftData;
    expect(data.draft.status).toBe('pre_draft');
    expect(data.picks).toEqual([]);
    expect(data.warnings?.[0]).toContain('DRAFT_RESULTS_UNAVAILABLE');
    expect(data).not.toHaveProperty('ownership');
  });

  it.each(scenarios)('$label gives inProgress precedence over drafted', async ({ sport, handlers }) => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      settings: { draftSettings: { type: 'SNAKE' } },
      draftDetail: { drafted: true, inProgress: true, picks: [] },
    }));

    const result = await handlers.get_draft({} as never, makeParams(sport));

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((result.data as DraftData).draft.status).toBe('in_progress');
  });

  it.each(scenarios)('$label omits malformed optional pick values without inventing them', async ({ sport, handlers }) => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      settings: { draftSettings: { type: 'AUCTION' } },
      draftDetail: {
        drafted: true,
        picks: [{
          roundId: 4,
          playerId: 404,
          roundPickNumber: 0,
          overallPickNumber: -1,
          teamId: Number.POSITIVE_INFINITY,
          keeper: 'true',
          bidAmount: -22,
        }],
      },
    }));

    const result = await handlers.get_draft({} as never, makeParams(sport));

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect((result.data as DraftData).picks).toEqual([{
      round: 4,
      playerId: 404,
      placement: { status: 'confirmed', source: 'provider_pick' },
    }]);
  });

  it.each(scenarios)('$label fails closed when ESPN marks a draft complete but supplies no usable selections', async ({ sport, handlers }) => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      settings: { draftSettings: { type: 'SNAKE' } },
      draftDetail: { drafted: true },
    }));

    const result = await handlers.get_draft({} as never, makeParams(sport));

    expect(result).toMatchObject({
      success: false,
      code: 'ESPN_DRAFT_RESULTS_UNAVAILABLE',
    });
  });

  it.each(scenarios)('$label warns when malformed completed rows are omitted from otherwise usable results', async ({ sport, handlers }) => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      settings: { draftSettings: { type: 'SNAKE' } },
      draftDetail: {
        drafted: true,
        picks: [
          { roundId: 1, playerId: 101, teamId: 1 },
          { roundId: 1, teamId: 2 },
          { roundId: 0, playerId: 303, teamId: 3 },
        ],
      },
    }));

    const result = await handlers.get_draft({} as never, makeParams(sport));

    expect(result).toMatchObject({
      success: true,
      data: {
        picks: [expect.objectContaining({ playerId: 101 })],
        warnings: [expect.stringContaining('DRAFT_PICKS_PARTIAL')],
      },
    });
  });

  it.each(scenarios)('$label uses the ESPN-native year in the draft request', async ({ sport, handlers, espnYear }) => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      settings: { draftSettings: { type: 'SNAKE' } },
      draftDetail: { drafted: true, picks: [{ roundId: 1, playerId: 1, teamId: 1 }] },
    }));

    await handlers.get_draft({} as never, makeParams(sport));

    expect(espnFetchMock).toHaveBeenCalledWith(
      `/seasons/${espnYear}/segments/0/leagues/123?view=mDraftDetail&view=mSettings`,
      expect.any(String),
      expect.objectContaining({
        league: expect.objectContaining({ espnSeasonYear: espnYear }),
      }),
    );
  });
});
