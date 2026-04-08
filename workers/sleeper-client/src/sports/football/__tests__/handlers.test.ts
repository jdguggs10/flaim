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
        // /league/{id} meta — status triggers bracket fetch too
        jsonResponse({ league_id: 'league_1', name: 'Test', sport: 'nfl', season: '2025', status: 'in_season', total_rosters: 3, roster_positions: [], scoring_settings: {}, settings: {}, previous_league_id: null, draft_id: 'd1', avatar: null }),
      )
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
      )
      .mockResolvedValueOnce(
        // winners_bracket — empty = regular season (status was in_season)
        jsonResponse([]),
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

  it('populates outcome fields from bracket for completed season with p field', async () => {
    const league = { league_id: 'league_1', name: 'Test', sport: 'nfl', season: '2024', status: 'complete', total_rosters: 4, roster_positions: [], scoring_settings: {}, settings: {}, previous_league_id: null, draft_id: 'd1', avatar: null };
    const rosters = [
      { roster_id: 1, owner_id: 'u1', players: [], starters: [], reserve: [], settings: { wins: 10, losses: 3, ties: 0, fpts: 1500, fpts_decimal: 0, fpts_against: 1200, fpts_against_decimal: 0 } },
      { roster_id: 2, owner_id: 'u2', players: [], starters: [], reserve: [], settings: { wins: 9, losses: 4, ties: 0, fpts: 1400, fpts_decimal: 0, fpts_against: 1300, fpts_against_decimal: 0 } },
      { roster_id: 3, owner_id: 'u3', players: [], starters: [], reserve: [], settings: { wins: 6, losses: 7, ties: 0, fpts: 1200, fpts_decimal: 0, fpts_against: 1350, fpts_against_decimal: 0 } },
      { roster_id: 4, owner_id: 'u4', players: [], starters: [], reserve: [], settings: { wins: 5, losses: 8, ties: 0, fpts: 1100, fpts_decimal: 0, fpts_against: 1400, fpts_against_decimal: 0 } },
    ];
    const users = [
      { user_id: 'u1', display_name: 'Alpha', avatar: null },
      { user_id: 'u2', display_name: 'Bravo', avatar: null },
      { user_id: 'u3', display_name: 'Charlie', avatar: null },
      { user_id: 'u4', display_name: 'Delta', avatar: null },
    ];
    // winners bracket: round 1 semis, round 2 championship
    // championship match (r=2): roster 1 beats roster 2 → p=1 for winner, p=2 for loser
    const bracket = [
      { r: 1, m: 1, t1: 1, t2: 3, w: 1, l: 3 },
      { r: 1, m: 2, t1: 2, t2: 4, w: 2, l: 4 },
      { r: 2, m: 3, t1: 1, t2: 2, w: 1, l: 2, p: 1 },
    ];

    mockFetch
      .mockResolvedValueOnce(jsonResponse(league))
      .mockResolvedValueOnce(jsonResponse(rosters))
      .mockResolvedValueOnce(jsonResponse(users))
      .mockResolvedValueOnce(jsonResponse(bracket));

    const params: ToolParams = { sport: 'football', league_id: 'league_1', season_year: 2024 };
    const result = await footballHandlers.get_standings({} as never, params);

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.seasonPhase).toBe('season_complete');
    expect(data.seasonComplete).toBe(true);

    const standings = data.standings as Array<Record<string, unknown>>;
    const r1 = standings.find((s) => s.rosterId === 1);
    expect(r1?.championshipWon).toBe(true);
    expect(r1?.finalRank).toBe(1);
    expect(r1?.playoffOutcome).toBe('champion');
    expect(r1?.outcomeConfidence).toBe('explicit');
    expect(r1?.madePlayoffs).toBe(true);

    const r2 = standings.find((s) => s.rosterId === 2);
    expect(r2?.championshipWon).toBe(false);
    expect(r2?.finalRank).toBe(2);
    expect(r2?.playoffOutcome).toBe('runner_up');

    const r3 = standings.find((s) => s.rosterId === 3);
    expect(r3?.championshipWon).toBe(false);
    expect(r3?.playoffOutcome).toBe('eliminated');

    // r4 lost in round 1 — in bracket, so madePlayoffs is true
    const r4 = standings.find((s) => s.rosterId === 4);
    expect(r4?.championshipWon).toBe(false);
    expect(r4?.madePlayoffs).toBe(true); // was in round 1 bracket
  });

  it('identifies champion when bracket championship match has w but no p field', async () => {
    const league = { league_id: 'league_1', name: 'Test', sport: 'nfl', season: '2024', status: 'complete', total_rosters: 2, roster_positions: [], scoring_settings: {}, settings: {}, previous_league_id: null, draft_id: 'd1', avatar: null };
    const rosters = [
      { roster_id: 1, owner_id: 'u1', players: [], starters: [], reserve: [], settings: { wins: 8, losses: 2, ties: 0, fpts: 1200, fpts_decimal: 0, fpts_against: 1000, fpts_against_decimal: 0 } },
      { roster_id: 2, owner_id: 'u2', players: [], starters: [], reserve: [], settings: { wins: 7, losses: 3, ties: 0, fpts: 1100, fpts_decimal: 0, fpts_against: 1100, fpts_against_decimal: 0 } },
    ];
    const users = [
      { user_id: 'u1', display_name: 'Alpha', avatar: null },
      { user_id: 'u2', display_name: 'Bravo', avatar: null },
    ];
    // Championship match with no p field
    const bracket = [{ r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2 }];

    mockFetch
      .mockResolvedValueOnce(jsonResponse(league))
      .mockResolvedValueOnce(jsonResponse(rosters))
      .mockResolvedValueOnce(jsonResponse(users))
      .mockResolvedValueOnce(jsonResponse(bracket));

    const params: ToolParams = { sport: 'football', league_id: 'league_1', season_year: 2024 };
    const result = await footballHandlers.get_standings({} as never, params);

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    const standings = data.standings as Array<Record<string, unknown>>;

    const champion = standings.find((s) => s.rosterId === 1);
    expect(champion?.championshipWon).toBe(true);
    expect(champion?.finalRank).toBeNull(); // p field absent
    expect(champion?.playoffOutcome).toBe('champion'); // isChampion path
    expect(champion?.outcomeConfidence).toBe('explicit');
  });
});
