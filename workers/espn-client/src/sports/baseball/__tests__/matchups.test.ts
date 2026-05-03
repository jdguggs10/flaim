import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { baseballHandlers } from '../handlers';
import { getCredentials } from '../../../shared/auth';
import { espnFetch } from '../../../shared/espn-api';
import { withSeasonContext } from '../../../shared/season';

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
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
  });

  it('defaults to currentMatchupPeriod instead of daily scoringPeriodId', async () => {
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
});
