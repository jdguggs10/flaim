import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { basketballHandlers } from '../handlers';
import type { Env, ToolParams } from '../../../types';
import { clearSleeperPlayersInMemoryCacheForTesting } from '../../../shared/sleeper-players-cache';

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
        // /league/{id} meta
        jsonResponse({ league_id: 'league_nba_1', name: 'NBA Test', sport: 'nba', season: '2025', status: 'in_season', total_rosters: 3, roster_positions: [], scoring_settings: {}, settings: {}, previous_league_id: null, draft_id: 'd1', avatar: null }),
      )
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
      )
      .mockResolvedValueOnce(
        // winners_bracket — empty = regular season
        jsonResponse([]),
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

describe('basketball get_players handler', () => {
  const kvGet = vi.fn();
  const env = { SLEEPER_PLAYERS_CACHE: { get: kvGet, put: vi.fn() } } as unknown as Env;

  beforeEach(() => {
    mockFetch.mockReset();
    kvGet.mockReset();
    kvGet.mockResolvedValue(null); // always a cache miss, forcing a /players/nba fetch
    clearSleeperPlayersInMemoryCacheForTesting();
  });

  function routeByUrl(handlers: Record<string, (input: RequestInfo | URL) => Promise<Response> | Response>) {
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      for (const [suffix, handler] of Object.entries(handlers)) {
        if (url.includes(suffix)) return handler(input);
      }
      throw new Error(`Unexpected fetch in test: ${url}`);
    });
  }

  it('resolves availability for a rostered player and a free agent in the same league', async () => {
    routeByUrl({
      '/players/nba': () =>
        jsonResponse({
          '301': { player_id: '301', full_name: 'Test Rostered Hooper', position: 'PG', team: 'BOS', active: true },
          '402': { player_id: '402', full_name: 'Test Free Hooper', position: 'SG', team: 'LAL', active: true },
        }),
      '/rosters': () =>
        jsonResponse([
          { roster_id: 9, owner_id: 'owner_9', players: ['301'], starters: [], reserve: null, taxi: null, settings: {} },
        ]),
      '/users': () =>
        jsonResponse([
          { user_id: 'owner_9', display_name: 'Gerry', avatar: null, metadata: { team_name: 'The Flaimers' } },
        ]),
      '/league/league_nba_1': () => jsonResponse({ status: 'in_season' }),
    });

    const params: ToolParams = { sport: 'basketball', league_id: 'league_nba_1', season_year: 2025, query: 'test' };
    const result = await basketballHandlers.get_players(env, params);

    expect(result.success).toBe(true);
    if (!result.success) return;
    const players = (result.data as { players: Array<Record<string, unknown>> }).players;

    const rostered = players.find((p) => p.id === '301');
    expect(rostered).toMatchObject({
      league_status: 'ROSTERED',
      league_team_id: '9',
      league_team_name: 'The Flaimers',
      league_owner_name: 'Gerry',
      market_percent_owned: null,
      ownership_scope: 'unavailable',
    });

    const free = players.find((p) => p.id === '402');
    expect(free).toMatchObject({
      league_status: 'FREE_AGENT',
      league_team_id: null,
      league_team_name: null,
      league_owner_name: null,
      market_percent_owned: null,
      ownership_scope: 'unavailable',
    });
  });

  it('combines a position filter with league availability resolution', async () => {
    routeByUrl({
      '/players/nba': () =>
        jsonResponse({
          '301': { player_id: '301', full_name: 'Test Rostered Guard', position: 'PG', team: 'BOS', active: true },
          '402': { player_id: '402', full_name: 'Test Rostered Center', position: 'C', team: 'LAL', active: true },
          '503': { player_id: '503', full_name: 'Test Free Guard', position: 'PG', team: 'MIA', active: true },
        }),
      '/rosters': () =>
        jsonResponse([
          { roster_id: 9, owner_id: 'owner_9', players: ['301', '402'], starters: [], reserve: null, taxi: null, settings: {} },
        ]),
      '/users': () =>
        jsonResponse([
          { user_id: 'owner_9', display_name: 'Gerry', avatar: null, metadata: { team_name: 'The Flaimers' } },
        ]),
      '/league/league_nba_1': () => jsonResponse({ status: 'in_season' }),
    });

    const params: ToolParams = {
      sport: 'basketball',
      league_id: 'league_nba_1',
      season_year: 2025,
      query: 'test',
      position: 'PG',
    };
    const result = await basketballHandlers.get_players(env, params);

    expect(result.success).toBe(true);
    if (!result.success) return;
    const players = (result.data as { players: Array<Record<string, unknown>> }).players;

    // Position filter excludes the Center even though it's rostered in this league.
    expect(players.find((p) => p.id === '402')).toBeUndefined();

    const rosteredGuard = players.find((p) => p.id === '301');
    expect(rosteredGuard).toMatchObject({ league_status: 'ROSTERED', league_team_id: '9' });

    const freeGuard = players.find((p) => p.id === '503');
    expect(freeGuard).toMatchObject({ league_status: 'FREE_AGENT', league_team_id: null });
  });

  it('degrades to unresolved ownership (still returns identity results) when the rosters fetch errors', async () => {
    routeByUrl({
      '/players/nba': () =>
        jsonResponse({
          '301': { player_id: '301', full_name: 'Test Rostered Hooper', position: 'PG', team: 'BOS', active: true },
        }),
      '/rosters': () => new Response(null, { status: 503 }),
      '/users': () => jsonResponse([]),
      '/league/league_nba_1': () => jsonResponse({ status: 'in_season' }),
    });

    const params: ToolParams = { sport: 'basketball', league_id: 'league_nba_1', season_year: 2025, query: 'test' };
    const result = await basketballHandlers.get_players(env, params);

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as Record<string, unknown>;
    expect(data.warnings).toEqual(['SLEEPER_OWNERSHIP_UNAVAILABLE: League ownership could not be resolved for this search; league_status is unavailable for these results.']);
    const players = data.players as Array<Record<string, unknown>>;
    const rostered = players.find((p) => p.id === '301');
    expect(rostered).toMatchObject({
      id: '301',
      name: 'Test Rostered Hooper',
      position: 'PG',
      team: 'BOS',
      league_status: null,
      league_team_id: null,
      league_team_name: null,
      league_owner_name: null,
    });
  });

  it('degrades to unresolved ownership (still returns identity results) when the users fetch errors', async () => {
    routeByUrl({
      '/players/nba': () =>
        jsonResponse({
          '301': { player_id: '301', full_name: 'Test Rostered Hooper', position: 'PG', team: 'BOS', active: true },
        }),
      '/rosters': () =>
        jsonResponse([
          { roster_id: 9, owner_id: 'owner_9', players: ['301'], starters: [], reserve: null, taxi: null, settings: {} },
        ]),
      '/users': () => new Response(null, { status: 503 }),
      '/league/league_nba_1': () => jsonResponse({ status: 'in_season' }),
    });

    const params: ToolParams = { sport: 'basketball', league_id: 'league_nba_1', season_year: 2025, query: 'test' };
    const result = await basketballHandlers.get_players(env, params);

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as Record<string, unknown>;
    expect(data.warnings).toEqual(['SLEEPER_OWNERSHIP_UNAVAILABLE: League ownership could not be resolved for this search; league_status is unavailable for these results.']);
    const players = data.players as Array<Record<string, unknown>>;
    const rostered = players.find((p) => p.id === '301');
    expect(rostered).toMatchObject({
      id: '301',
      name: 'Test Rostered Hooper',
      position: 'PG',
      team: 'BOS',
      league_status: null,
      league_team_id: null,
      league_team_name: null,
      league_owner_name: null,
    });
  });

  it('fails closed (no players payload leaked) when the league is actively drafting, since in-progress picks are not yet reflected on rosters', async () => {
    routeByUrl({
      '/players/nba': () =>
        jsonResponse({
          '301': { player_id: '301', full_name: 'Test Rostered Hooper', position: 'PG', team: 'BOS', active: true },
        }),
      '/rosters': () =>
        jsonResponse([
          { roster_id: 9, owner_id: 'owner_9', players: [], starters: [], reserve: null, taxi: null, settings: {} },
        ]),
      '/users': () =>
        jsonResponse([
          { user_id: 'owner_9', display_name: 'Gerry', avatar: null },
        ]),
      '/league/league_nba_1': () => jsonResponse({ status: 'drafting' }),
    });

    const params: ToolParams = { sport: 'basketball', league_id: 'league_nba_1', season_year: 2025, query: 'test' };
    const result = await basketballHandlers.get_players(env, params);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe('SLEEPER_DRAFT_IN_PROGRESS');
    expect('players' in ((result.data as Record<string, unknown>) ?? {})).toBe(false);
  });

  it('returns MISSING_PARAM when league_id is omitted', async () => {
    const params = { sport: 'basketball', season_year: 2025, query: 'test' } as unknown as ToolParams;
    const result = await basketballHandlers.get_players(env, params);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe('MISSING_PARAM');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
