import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { baseballHandlers } from '../handlers';
import { withSeasonContext } from '../../../shared/season';
import { getCredentials } from '../../../shared/auth';
import { espnFetch } from '../../../shared/espn-api';

vi.mock('../../../shared/auth', () => ({
  getCredentials: vi.fn(),
}));

vi.mock('../../../shared/espn-api', async () => {
  const actual = await vi.importActual('../../../shared/espn-api') as Record<string, unknown>;
  return {
    ...actual,
    espnFetch: vi.fn(),
  };
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('baseball get_matchups handler', () => {
  const getCredentialsMock = getCredentials as MockedFunction<typeof getCredentials>;
  const espnFetchMock = espnFetch as MockedFunction<typeof espnFetch>;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('defaults to currentMatchupPeriod instead of daily scoringPeriodId', async () => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    espnFetchMock.mockResolvedValue(jsonResponse({
      scoringPeriodId: 130,
      status: { currentMatchupPeriod: 10 },
      teams: [
        { id: 1, location: 'Alpha', nickname: 'Aces' },
        { id: 2, location: 'Beta', nickname: 'Bats' },
      ],
      schedule: [
        {
          matchupPeriodId: 10,
          home: { teamId: 1, totalPoints: 100 },
          away: { teamId: 2, totalPoints: 90 },
          winner: 'HOME',
        },
        {
          matchupPeriodId: 11,
          home: { teamId: 2, totalPoints: 80 },
          away: { teamId: 1, totalPoints: 70 },
          winner: 'HOME',
        },
      ],
    }));

    const params = withSeasonContext({ sport: 'baseball', league_id: '789', season_year: 2026 });
    const result = await baseballHandlers.get_matchups({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as { matchupPeriod: number | null; matchups: unknown[] };
    expect(data.matchupPeriod).toBe(10);
    expect(data.matchups).toHaveLength(1);
  });

  it('keeps explicit week ahead of currentMatchupPeriod', async () => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    espnFetchMock.mockResolvedValue(jsonResponse({
      scoringPeriodId: 130,
      status: { currentMatchupPeriod: 10 },
      schedule: [
        { matchupPeriodId: 9, home: { teamId: 1, totalPoints: 100 }, away: { teamId: 2, totalPoints: 90 } },
        { matchupPeriodId: 10, home: { teamId: 3, totalPoints: 80 }, away: { teamId: 4, totalPoints: 70 } },
      ],
    }));

    const params = withSeasonContext({ sport: 'baseball', league_id: '789', season_year: 2026, week: 9 });
    const result = await baseballHandlers.get_matchups({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as { matchupPeriod: number | null; matchups: unknown[] };
    expect(data.matchupPeriod).toBe(9);
    expect(data.matchups).toHaveLength(1);
  });

  it('returns H2H category scores without fake point totals', async () => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    espnFetchMock.mockResolvedValue(
      jsonResponse({
        scoringPeriodId: 63,
        currentMatchupPeriod: 9,
        settings: {
          scoringSettings: { scoringType: 'H2H_CATEGORY' },
        },
        teams: [
          { id: 1, location: 'Troll', nickname: 'Tolle' },
          { id: 7, name: 'The 1 Time Champs' },
        ],
        schedule: [
          {
            matchupPeriodId: 9,
            home: {
              teamId: 1,
              totalPoints: 0,
              cumulativeScore: {
                wins: 4,
                losses: 5,
                ties: 1,
                scoreByStat: {
                  '20': { score: 31, result: 'WIN', rank: 1, ineligible: false },
                  '47': { score: 3.42, result: 'LOSS', rank: 2, ineligible: false },
                },
              },
            },
            away: {
              teamId: 7,
              totalPoints: 0,
              cumulativeScore: {
                wins: 5,
                losses: 4,
                ties: 1,
                scoreByStat: {
                  '20': { score: 28, result: 'LOSS', rank: 2, ineligible: false },
                  '47': { score: 2.87, result: 'WIN', rank: 1, ineligible: false },
                },
              },
            },
            winner: 'AWAY',
          },
        ],
      }),
    );

    const params = withSeasonContext({ sport: 'baseball', league_id: '30201', season_year: 2026 });
    const result = await baseballHandlers.get_matchups({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as {
      scoringType?: string;
      matchups: Array<{
        home: {
          totalPoints: number | null;
          scoreAvailable: boolean;
          categoryScore: { wins: number; losses: number; ties: number } | null;
          categories?: Array<{
            statId: number;
            name: string;
            value: number | null;
            result: string | null;
            rank?: number;
            ineligible?: boolean;
          }>;
        } | null;
      }>;
    };

    expect(data.scoringType).toBe('H2H_CATEGORY');
    expect(data.matchups[0]?.home).toEqual(expect.objectContaining({
      totalPoints: null,
      scoreAvailable: true,
      categoryScore: { wins: 4, losses: 5, ties: 1 },
    }));
    expect(data.matchups[0]?.home?.categories).toEqual([
      { statId: 20, name: 'R', value: 31, result: 'WIN', rank: 1, ineligible: false },
      { statId: 47, name: 'ERA', value: 3.42, result: 'LOSS', rank: 2, ineligible: false },
    ]);
  });

  it('marks category scores unavailable instead of inventing zeroes', async () => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    espnFetchMock.mockResolvedValue(
      jsonResponse({
        scoringPeriodId: 63,
        currentMatchupPeriod: 9,
        settings: {
          scoringSettings: { scoringType: 'H2H_CATEGORY' },
        },
        schedule: [
          {
            matchupPeriodId: 9,
            home: { teamId: 1, totalPoints: 0 },
            away: { teamId: 7, totalPoints: 0 },
            winner: 'UNDECIDED',
          },
        ],
      }),
    );

    const params = withSeasonContext({ sport: 'baseball', league_id: '30201', season_year: 2026 });
    const result = await baseballHandlers.get_matchups({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as { matchups: Array<{ home: { totalPoints: number | null; scoreAvailable: boolean; categoryScore: null } | null }> };
    expect(data.matchups[0]?.home).toEqual(expect.objectContaining({
      totalPoints: null,
      scoreAvailable: false,
      categoryScore: null,
    }));
  });

  it('keeps point totals for non-category baseball leagues', async () => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    espnFetchMock.mockResolvedValue(
      jsonResponse({
        scoringPeriodId: 3,
        settings: {
          scoringSettings: { scoringType: 'H2H_POINTS' },
        },
        schedule: [
          {
            matchupPeriodId: 3,
            home: { teamId: 1, totalPoints: 112.4, totalProjectedPointsLive: 145.2 },
            away: { teamId: 2, totalPoints: 98.1, totalProjectedPoints: 130.5 },
            winner: 'HOME',
          },
        ],
      }),
    );

    const params = withSeasonContext({ sport: 'baseball', league_id: '30201', season_year: 2026 });
    const result = await baseballHandlers.get_matchups({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as { matchups: Array<{ home: { totalPoints: number | null; totalProjectedPoints: number | null; categoryScore: null } | null }> };
    expect(data.matchups[0]?.home).toEqual(expect.objectContaining({
      totalPoints: 112.4,
      totalProjectedPoints: 145.2,
      categoryScore: null,
    }));
  });
});
