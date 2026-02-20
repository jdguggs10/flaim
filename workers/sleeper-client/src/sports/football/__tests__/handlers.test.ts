import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { footballHandlers } from '../handlers';
import type { ToolParams } from '../../../types';

const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch;

interface StandingRow {
  rank: number;
  rosterId: number;
  ownerName: string;
  wins: number;
  losses: number;
  ties: number;
  winPercentage: number;
  pointsFor: number;
  pointsAgainst: number;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('football handlers', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('computes standings from roster settings and applies deterministic ranking', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse([
          {
            roster_id: 1,
            owner_id: 'owner_1',
            players: [],
            starters: [],
            reserve: [],
            settings: {
              wins: 8,
              losses: 2,
              ties: 0,
              fpts: 1234,
              fpts_decimal: 50,
              fpts_against: 1100,
              fpts_against_decimal: 10,
            },
          },
          {
            roster_id: 2,
            owner_id: 'owner_2',
            players: [],
            starters: [],
            reserve: [],
            settings: {
              wins: 8,
              losses: 2,
              ties: 0,
              fpts: 1225,
              fpts_decimal: 99,
              fpts_against: 1120,
              fpts_against_decimal: 5,
            },
          },
          {
            roster_id: 3,
            owner_id: 'owner_3',
            players: [],
            starters: [],
            reserve: [],
            settings: {
              wins: 5,
              losses: 5,
              ties: 0,
              fpts: 1150,
              fpts_decimal: 0,
              fpts_against: 1130,
              fpts_against_decimal: 0,
            },
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          { user_id: 'owner_1', display_name: 'Alpha', avatar: null },
          { user_id: 'owner_2', display_name: 'Bravo', avatar: null },
          { user_id: 'owner_3', display_name: 'Charlie', avatar: null },
        ]),
      );

    const params: ToolParams = {
      sport: 'football',
      league_id: 'league_1',
      season_year: 2025,
    };
    const result = await footballHandlers.get_standings({} as never, params);

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error('Expected standings request to succeed');
    }

    const standings = (result.data as { standings: StandingRow[] }).standings;

    expect(standings).toHaveLength(3);
    expect(standings.map((entry) => ({ rank: entry.rank, rosterId: entry.rosterId }))).toEqual([
      { rank: 1, rosterId: 1 },
      { rank: 2, rosterId: 2 },
      { rank: 3, rosterId: 3 },
    ]);
    expect(standings[0]).toMatchObject({
      ownerName: 'Alpha',
      wins: 8,
      losses: 2,
      ties: 0,
      winPercentage: 0.8,
      pointsFor: 1234.5,
      pointsAgainst: 1100.1,
    });
  });

  it('returns extracted Sleeper error code when upstream fetch fails', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(jsonResponse([]));

    const params: ToolParams = {
      sport: 'football',
      league_id: 'league_1',
      season_year: 2025,
    };
    const result = await footballHandlers.get_standings({} as never, params);

    expect(result.success).toBe(false);
    expect(result.code).toBe('SLEEPER_RATE_LIMIT');
    expect(result.error).toContain('SLEEPER_RATE_LIMIT');
  });
});
