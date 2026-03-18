import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { footballHandlers } from '../handlers';
import type { ToolParams } from '../../../types';
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

describe('football get_matchups handler', () => {
  const getCredentialsMock = getCredentials as MockedFunction<typeof getCredentials>;
  const espnFetchMock = espnFetch as MockedFunction<typeof espnFetch>;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns all matchups when scoringPeriodId is missing and no week specified', async () => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        // scoringPeriodId intentionally omitted
        schedule: [
          {
            matchupPeriodId: 1,
            home: { teamId: 1, totalPoints: 100 },
            away: { teamId: 2, totalPoints: 90 },
            winner: 'HOME',
          },
          {
            matchupPeriodId: 2,
            home: { teamId: 3, totalPoints: 80 },
            away: { teamId: 4, totalPoints: 70 },
            winner: 'HOME',
          },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const params: ToolParams = { sport: 'football', league_id: '123', season_year: 2025 };
    const result = await footballHandlers.get_matchups({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as { matchups: unknown[]; matchupPeriod: number | null };
    // Should return all matchups instead of filtering to empty
    expect(data.matchups).toHaveLength(2);
    expect(data.matchupPeriod).toBeNull();
  });

  it('filters to specified week when provided', async () => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        scoringPeriodId: 5,
        schedule: [
          { matchupPeriodId: 3, home: { teamId: 1, totalPoints: 100 }, away: { teamId: 2, totalPoints: 90 }, winner: 'HOME' },
          { matchupPeriodId: 4, home: { teamId: 3, totalPoints: 80 }, away: { teamId: 4, totalPoints: 70 }, winner: 'HOME' },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const params: ToolParams = { sport: 'football', league_id: '123', season_year: 2025, week: 3 };
    const result = await footballHandlers.get_matchups({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as { matchups: unknown[]; matchupPeriod: number };
    expect(data.matchups).toHaveLength(1);
    expect(data.matchupPeriod).toBe(3);
  });
});
