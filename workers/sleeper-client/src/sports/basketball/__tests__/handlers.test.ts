import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { basketballHandlers } from '../handlers';
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

describe('basketball handlers', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('computes standings from roster settings and ranks by wins then points', async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse([
          {
            roster_id: 11,
            owner_id: 'owner_a',
            players: [],
            starters: [],
            reserve: [],
            settings: {
              wins: 10,
              losses: 2,
              ties: 0,
              fpts: 1400,
              fpts_decimal: 25,
              fpts_against: 1300,
              fpts_against_decimal: 99,
            },
          },
          {
            roster_id: 22,
            owner_id: 'owner_b',
            players: [],
            starters: [],
            reserve: [],
            settings: {
              wins: 10,
              losses: 2,
              ties: 0,
              fpts: 1399,
              fpts_decimal: 70,
              fpts_against: 1310,
              fpts_against_decimal: 12,
            },
          },
          {
            roster_id: 33,
            owner_id: 'owner_c',
            players: [],
            starters: [],
            reserve: [],
            settings: {
              wins: 8,
              losses: 4,
              ties: 0,
              fpts: 1350,
              fpts_decimal: 0,
              fpts_against: 1330,
              fpts_against_decimal: 0,
            },
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          { user_id: 'owner_a', display_name: 'Alpha Hoops', avatar: null },
          { user_id: 'owner_b', display_name: 'Bravo Hoops', avatar: null },
          { user_id: 'owner_c', display_name: 'Charlie Hoops', avatar: null },
        ]),
      );

    const params: ToolParams = {
      sport: 'basketball',
      league_id: 'league_nba_1',
      season_year: 2025,
    };
    const result = await basketballHandlers.get_standings({} as never, params);

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error('Expected standings request to succeed');
    }

    const standings = (result.data as { standings: StandingRow[] }).standings;
    expect(standings).toHaveLength(3);
    expect(standings.map((entry) => ({ rank: entry.rank, rosterId: entry.rosterId }))).toEqual([
      { rank: 1, rosterId: 11 },
      { rank: 2, rosterId: 22 },
      { rank: 3, rosterId: 33 },
    ]);
    expect(standings[0]).toMatchObject({
      ownerName: 'Alpha Hoops',
      wins: 10,
      losses: 2,
      ties: 0,
      winPercentage: 0.833,
      pointsFor: 1400.25,
      pointsAgainst: 1300.99,
    });
  });

  it('uses /state/nba when week is omitted and pairs matchup opponents', async () => {
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/state/nba')) {
        return jsonResponse({ week: 7 });
      }
      if (url.includes('/league/league_nba_2/matchups/7')) {
        return jsonResponse([
          { roster_id: 1, matchup_id: 90, points: 120.4, starters: ['p1'] },
          { roster_id: 2, matchup_id: 90, points: 118.2, starters: ['p2'] },
        ]);
      }
      if (url.includes('/league/league_nba_2/rosters')) {
        return jsonResponse([
          { roster_id: 1, owner_id: 'owner_1', settings: { wins: 1, losses: 1, ties: 0, fpts: 200 } },
          { roster_id: 2, owner_id: 'owner_2', settings: { wins: 1, losses: 1, ties: 0, fpts: 195 } },
        ]);
      }
      if (url.includes('/league/league_nba_2/users')) {
        return jsonResponse([
          { user_id: 'owner_1', display_name: 'Team One', avatar: null },
          { user_id: 'owner_2', display_name: 'Team Two', avatar: null },
        ]);
      }
      return new Response(null, { status: 404 });
    });

    const params: ToolParams = {
      sport: 'basketball',
      league_id: 'league_nba_2',
      season_year: 2025,
    };
    const result = await basketballHandlers.get_matchups({} as never, params);

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error('Expected matchup request to succeed');
    }

    const data = result.data as {
      week: number;
      matchups: Array<{
        matchupId: number;
        winner?: string;
        home: { ownerName: string; points: number } | null;
        away: { ownerName: string; points: number } | null;
      }>;
    };
    expect(data.week).toBe(7);
    expect(data.matchups).toHaveLength(1);
    expect(data.matchups[0]).toMatchObject({
      matchupId: 90,
      winner: 'home',
      home: { ownerName: 'Team One', points: 120.4 },
      away: { ownerName: 'Team Two', points: 118.2 },
    });
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/state/nba'))).toBe(true);
  });

  it('returns extracted Sleeper error code when standings upstream fails', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(jsonResponse([]));

    const params: ToolParams = {
      sport: 'basketball',
      league_id: 'league_nba_3',
      season_year: 2025,
    };
    const result = await basketballHandlers.get_standings({} as never, params);

    expect(result.success).toBe(false);
    expect(result.code).toBe('SLEEPER_RATE_LIMIT');
    expect(result.error).toContain('SLEEPER_RATE_LIMIT');
  });
});
