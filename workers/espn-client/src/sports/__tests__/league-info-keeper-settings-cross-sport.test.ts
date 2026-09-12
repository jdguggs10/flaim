// workers/espn-client/src/sports/__tests__/league-info-keeper-settings-cross-sport.test.ts
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
  { label: 'football', sport: 'football', handlers: footballHandlers },
  { label: 'baseball', sport: 'baseball', handlers: baseballHandlers },
  { label: 'basketball', sport: 'basketball', handlers: basketballHandlers },
  { label: 'hockey', sport: 'hockey', handlers: hockeyHandlers },
] as const;

function makeParams(sport: Sport): HandlerToolParams {
  return withSeasonContext({
    sport,
    league_id: '123',
    season_year: 2024,
  });
}

const baseSettings = {
  name: 'Test League',
  size: 10,
  scoringSettings: { scoringType: 'H2H_POINTS' },
  rosterSettings: { lineupSlotCounts: {} },
  scheduleSettings: { matchupPeriods: {} },
};

const baseTeams = [
  {
    id: 1,
    location: 'Gerry',
    nickname: 'Sluggers',
    abbrev: 'GS',
    owners: [{ displayName: 'Gerry G' }],
  },
];

type LeagueInfoData = {
  keeperSettings?: {
    keeperCount?: number;
    keeperCountFuture?: number;
    keeperOrderType?: string;
    keeperDeadlineDate?: string | null;
  };
  isKeeperLeague?: boolean;
  draftSettings?: {
    type?: string;
    auctionBudget?: number;
    pickTradingEnabled?: boolean;
  };
  tradeSettings?: {
    deadlineDate?: string | null;
    revisionHours?: number;
    vetoVotesRequired?: number;
    allowOutOfUniverse?: boolean;
    max?: number;
  };
  teams: Array<{
    teamId: number;
    keeperPlayerIds?: number[];
    futureKeeperPlayerIds?: number[];
  }>;
};

describe('espn cross-sport get_league_info keeper/format settings', () => {
  const getCredentialsMock = getCredentials as MockedFunction<typeof getCredentials>;
  const espnFetchMock = espnFetch as MockedFunction<typeof espnFetch>;

  beforeEach(() => {
    vi.resetAllMocks();
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
  });

  it.each(scenarios)('$label — keeper league (auction) exposes keeperSettings, draftSettings, tradeSettings, and per-team keeper IDs', async ({ sport, handlers }) => {
    const mockResponse = {
      id: 123,
      settings: {
        ...baseSettings,
        draftSettings: {
          keeperCount: 21,
          keeperCountFuture: 21,
          keeperOrderType: 'TRADITIONAL',
          keeperDeadlineDate: 1773964800000, // 2026-03-20T00:00:00.000Z
          type: 'AUCTION',
          auctionBudget: 272,
          isTradingEnabled: false,
        },
        tradeSettings: {
          deadlineDate: 1785110400000, // 2026-07-27T00:00:00.000Z
          revisionHours: 48,
          vetoVotesRequired: 7,
          allowOutOfUniverse: false,
          max: -1,
        },
      },
      teams: [
        {
          ...baseTeams[0],
          draftStrategy: {
            keeperPlayerIds: [4025, 4026, 4027],
            futureKeeperPlayerIds: [4025],
          },
        },
      ],
    };

    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const result = await handlers.get_league_info({} as never, makeParams(sport), 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as LeagueInfoData;

    expect(data.keeperSettings).toEqual({
      keeperCount: 21,
      keeperCountFuture: 21,
      keeperOrderType: 'TRADITIONAL',
      keeperDeadlineDate: '2026-03-20T00:00:00.000Z',
    });
    expect(data.isKeeperLeague).toBe(true);
    expect(data.draftSettings).toEqual({
      type: 'AUCTION',
      auctionBudget: 272,
      pickTradingEnabled: false,
    });
    expect(data.tradeSettings).toEqual({
      deadlineDate: '2026-07-27T00:00:00.000Z',
      revisionHours: 48,
      vetoVotesRequired: 7,
      allowOutOfUniverse: false,
      max: -1,
    });
    expect(data.teams[0].keeperPlayerIds).toEqual([4025, 4026, 4027]);
    expect(data.teams[0].futureKeeperPlayerIds).toEqual([4025]);
  });

  it.each(scenarios)('$label — snake keeper league still exposes keeperSettings with a null deadline', async ({ sport, handlers }) => {
    const mockResponse = {
      id: 456,
      settings: {
        ...baseSettings,
        draftSettings: {
          keeperCount: 5,
          keeperCountFuture: 5,
          keeperOrderType: 'TRADITIONAL',
          // ESPN reports an explicit null (not an absent key) when no
          // keeper deadline is set — verified live (research brief §7.1,
          // ffl 63634618). Same for tradeSettings.deadlineDate below.
          keeperDeadlineDate: null,
          type: 'SNAKE',
          auctionBudget: 200,
          isTradingEnabled: false,
        },
        tradeSettings: {
          deadlineDate: null,
          revisionHours: 24,
          vetoVotesRequired: 0,
        },
      },
      teams: baseTeams,
    };

    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const result = await handlers.get_league_info({} as never, makeParams(sport), 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as LeagueInfoData;

    expect(data.isKeeperLeague).toBe(true);
    expect(data.keeperSettings?.keeperDeadlineDate).toBeNull();
    expect(data.draftSettings?.type).toBe('SNAKE');
    expect(data.tradeSettings?.deadlineDate).toBeNull();
  });

  it.each(scenarios)('$label — non-keeper league (keeperCount 0) reports isKeeperLeague:false with keeperSettings still present', async ({ sport, handlers }) => {
    const mockResponse = {
      id: 789,
      settings: {
        ...baseSettings,
        draftSettings: {
          keeperCount: 0,
          keeperCountFuture: 0,
          type: 'SNAKE',
          isTradingEnabled: false,
        },
      },
      teams: baseTeams,
    };

    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const result = await handlers.get_league_info({} as never, makeParams(sport), 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as LeagueInfoData;

    // Implementation note: keeperSettings is present (not omitted) whenever
    // ESPN sends a numeric keeperCount, including exactly 0 — only a fully
    // absent draftSettings/keeperCount omits the key (see next test).
    expect(data.isKeeperLeague).toBe(false);
    expect(data.keeperSettings).toBeDefined();
    expect(data.keeperSettings?.keeperCount).toBe(0);
  });

  it.each(scenarios)('$label — payload without draftSettings omits all keeper keys and does not crash', async ({ sport, handlers }) => {
    const mockResponse = {
      id: 999,
      settings: { ...baseSettings },
      teams: baseTeams,
    };

    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const result = await handlers.get_league_info({} as never, makeParams(sport), 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as LeagueInfoData;

    expect(data.keeperSettings).toBeUndefined();
    expect(data.isKeeperLeague).toBeUndefined();
    expect(data.teams[0].keeperPlayerIds).toBeUndefined();
    expect(data.teams[0].futureKeeperPlayerIds).toBeUndefined();
    expect('keeperPlayerIds' in data.teams[0]).toBe(false);
    expect('futureKeeperPlayerIds' in data.teams[0]).toBe(false);

    // draftSettings/tradeSettings are always-present objects (like the
    // existing scoringSettings/roster/schedule blocks), just with
    // undefined sub-fields when ESPN sent nothing. deadlineDate is
    // undefined here too (not null) when the whole tradeSettings block is
    // absent — null is reserved for ESPN explicitly reporting "no deadline
    // set" on a tradeSettings block that IS present (FLA-284 audit: a
    // fully-absent block must not look different from its undefined
    // siblings just because deadlineDate happens to go through a date
    // conversion).
    expect(data.draftSettings).toEqual({
      type: undefined,
      auctionBudget: undefined,
      pickTradingEnabled: undefined,
    });
    expect(data.tradeSettings).toEqual({
      deadlineDate: undefined,
      revisionHours: undefined,
      vetoVotesRequired: undefined,
      allowOutOfUniverse: undefined,
      max: undefined,
    });
  });

  it.each(scenarios)('$label — garbage keeperDeadlineDate/deadlineDate values normalize to null instead of throwing', async ({ sport, handlers }) => {
    const mockResponse = {
      id: 111,
      settings: {
        ...baseSettings,
        draftSettings: {
          keeperCount: 5,
          keeperDeadlineDate: 'not-a-date',
          type: 'SNAKE',
          isTradingEnabled: false,
        },
        tradeSettings: {
          // NaN/Infinity can't survive JSON serialization (they become
          // `null`), so this integration-level test exercises the
          // realistic "garbage string" case; NaN/Infinity/object garbage
          // are covered directly against epochMsToIso in dates.test.ts.
          deadlineDate: {},
        },
      },
      teams: baseTeams,
    };

    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(mockResponse), { status: 200 })
    );

    const result = await handlers.get_league_info({} as never, makeParams(sport), 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as LeagueInfoData;

    expect(data.keeperSettings?.keeperDeadlineDate).toBeNull();
    expect(data.tradeSettings?.deadlineDate).toBeNull();
  });
});
