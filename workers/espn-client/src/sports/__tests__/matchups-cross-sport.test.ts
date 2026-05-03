import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { getCredentials } from '../../shared/auth';
import { espnFetch } from '../../shared/espn-api';
import { withSeasonContext } from '../../shared/season';
import { footballHandlers } from '../football/handlers';
import { basketballHandlers } from '../basketball/handlers';
import { hockeyHandlers } from '../hockey/handlers';

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

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ESPN get_matchups current matchup fallback', () => {
  const getCredentialsMock = getCredentials as MockedFunction<typeof getCredentials>;
  const espnFetchMock = espnFetch as MockedFunction<typeof espnFetch>;

  beforeEach(() => {
    vi.resetAllMocks();
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
  });

  it.each([
    { sport: 'football' as const, seasonYear: 2026, leagueId: '123', handlers: footballHandlers },
    { sport: 'basketball' as const, seasonYear: 2025, leagueId: '456', handlers: basketballHandlers },
    { sport: 'hockey' as const, seasonYear: 2025, leagueId: '789', handlers: hockeyHandlers },
  ])('defaults $sport matchups to status.currentMatchupPeriod', async ({ sport, seasonYear, leagueId, handlers }) => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      scoringPeriodId: 130,
      status: { currentMatchupPeriod: 10 },
      schedule: [
        { matchupPeriodId: 10, home: { teamId: 1, totalPoints: 100 }, away: { teamId: 2, totalPoints: 90 } },
        { matchupPeriodId: 11, home: { teamId: 3, totalPoints: 80 }, away: { teamId: 4, totalPoints: 70 } },
      ],
    }));

    const params = withSeasonContext({ sport, league_id: leagueId, season_year: seasonYear });
    const result = await handlers.get_matchups({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as { matchupPeriod: number | null; matchups: unknown[] };
    expect(data.matchupPeriod).toBe(10);
    expect(data.matchups).toHaveLength(1);
  });
});
