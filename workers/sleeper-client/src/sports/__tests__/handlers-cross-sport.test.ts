import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { footballHandlers } from '../football/handlers';
import { basketballHandlers } from '../basketball/handlers';
import type { ToolParams } from '../../types';

const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch;

const scenarios = [
  { label: 'football', sport: 'football', handlers: footballHandlers, statePath: '/state/nfl' },
  { label: 'basketball', sport: 'basketball', handlers: basketballHandlers, statePath: '/state/nba' },
] as const;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('sleeper cross-sport handler characterization tests', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('parameter validation', () => {
    it.each(scenarios)('$label get_league_info rejects missing league_id', async ({ sport, handlers }) => {
      const params = { sport, season_year: 2025 } as unknown as ToolParams;
      const result = await handlers.get_league_info({} as never, params);
      expect(result.success).toBe(false);
      expect(result.code).toBe('MISSING_PARAM');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it.each(scenarios)('$label get_standings rejects missing league_id', async ({ sport, handlers }) => {
      const params = { sport, season_year: 2025 } as unknown as ToolParams;
      const result = await handlers.get_standings({} as never, params);
      expect(result.success).toBe(false);
      expect(result.code).toBe('MISSING_PARAM');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it.each(scenarios)('$label get_roster rejects missing league_id', async ({ sport, handlers }) => {
      const params = { sport, season_year: 2025, team_id: '1' } as unknown as ToolParams;
      const result = await handlers.get_roster({} as never, params);
      expect(result.success).toBe(false);
      expect(result.code).toBe('MISSING_PARAM');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it.each(scenarios)('$label get_matchups rejects missing league_id', async ({ sport, handlers }) => {
      const params = { sport, season_year: 2025 } as unknown as ToolParams;
      const result = await handlers.get_matchups({} as never, params);
      expect(result.success).toBe(false);
      expect(result.code).toBe('MISSING_PARAM');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('get_league_info', () => {
    it.each(scenarios)('$label returns consistent league metadata shape', async ({ sport, handlers }) => {
      // get_league_info now makes 3 parallel fetches: league, rosters, users
      mockFetch
        .mockResolvedValueOnce(jsonResponse({
          league_id: '12345',
          name: 'Test League',
          sport: 'nfl',
          season: '2025',
          status: 'in_season',
          total_rosters: 10,
          roster_positions: ['QB', 'RB'],
          scoring_settings: { pass_yd: 0.04 },
          previous_league_id: null,
          draft_id: 'draft_1',
        }))
        .mockResolvedValueOnce(jsonResponse([
          { roster_id: 1, owner_id: 'u1', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0 } },
          { roster_id: 2, owner_id: 'u2', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0 } },
        ]))
        .mockResolvedValueOnce(jsonResponse([
          { user_id: 'u1', display_name: 'Alice', avatar: null },
          { user_id: 'u2', display_name: 'Bob', avatar: null },
        ]));

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025 };
      const result = await handlers.get_league_info({} as never, params);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.leagueId).toBe('12345');
      expect(data.name).toBe('Test League');
      expect(data.totalRosters).toBe(10);

      const teams = data.teams as Array<{ rosterId: number; ownerName?: string }>;
      expect(teams).toHaveLength(2);
      expect(teams[0]).toMatchObject({ rosterId: 1, ownerName: 'Alice' });
      expect(teams[1]).toMatchObject({ rosterId: 2, ownerName: 'Bob' });
    });
  });

  describe('get_standings', () => {
    it.each(scenarios)('$label computes standings with ranking', async ({ sport, handlers }) => {
      mockFetch
        .mockResolvedValueOnce(
          // /league/{id} meta — status must come first
          jsonResponse({ league_id: '12345', name: 'Test League', sport: 'nfl', season: '2025', status: 'in_season', total_rosters: 2, roster_positions: [], scoring_settings: {}, settings: {}, previous_league_id: null, draft_id: 'd1', avatar: null }),
        )
        .mockResolvedValueOnce(jsonResponse([
          {
            roster_id: 1, owner_id: 'u1', players: [], starters: [], reserve: [],
            settings: { wins: 8, losses: 2, ties: 0, fpts: 1200, fpts_decimal: 50, fpts_against: 1100, fpts_against_decimal: 0 },
          },
          {
            roster_id: 2, owner_id: 'u2', players: [], starters: [], reserve: [],
            settings: { wins: 5, losses: 5, ties: 0, fpts: 1000, fpts_decimal: 0, fpts_against: 1050, fpts_against_decimal: 0 },
          },
        ]))
        .mockResolvedValueOnce(jsonResponse([
          { user_id: 'u1', display_name: 'Alice', avatar: null },
          { user_id: 'u2', display_name: 'Bob', avatar: null },
        ]))
        .mockResolvedValueOnce(
          // winners_bracket — empty = regular season
          jsonResponse([]),
        );

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025 };
      const result = await handlers.get_standings({} as never, params);

      expect(result.success).toBe(true);
      const data = result.data as { standings: Array<Record<string, unknown>> };
      expect(data.standings).toHaveLength(2);
      expect(data.standings[0]).toMatchObject({ rank: 1, ownerName: 'Alice', wins: 8 });
      expect(data.standings[1]).toMatchObject({ rank: 2, ownerName: 'Bob', wins: 5 });
    });
  });

  describe('get_roster', () => {
    it.each(scenarios)('$label returns roster with starters/bench/reserve/taxi', async ({ sport, handlers }) => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse([
          {
            roster_id: 1, owner_id: 'u1',
            players: ['p1', 'p2', 'p3', 'p4'], starters: ['p1'], reserve: ['p3'], taxi: ['p4'],
            settings: { wins: 5, losses: 3, ties: 0, fpts: 800, fpts_decimal: 0, fpts_against: 750, fpts_against_decimal: 0 },
          },
        ]))
        .mockResolvedValueOnce(jsonResponse([
          { user_id: 'u1', display_name: 'Alice', avatar: null },
        ]));

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025, team_id: '1' };
      const result = await handlers.get_roster({} as never, params);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.starters).toEqual(['p1']);
      expect(data.bench).toEqual(['p2']);
      expect(data.reserve).toEqual(['p3']);
      expect(data.taxi).toEqual(['p4']);
      expect(data.ownerName).toBe('Alice');
    });

    it.each(scenarios)('$label treats missing taxi as empty and keeps bench derivation', async ({ sport, handlers }) => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse([
          {
            roster_id: 1, owner_id: 'u1',
            players: ['p1', 'p2'], starters: ['p1'], reserve: [],
            settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0 },
          },
        ]))
        .mockResolvedValueOnce(jsonResponse([
          { user_id: 'u1', display_name: 'Alice', avatar: null },
        ]));

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025, team_id: '1' };
      const result = await handlers.get_roster({} as never, params);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.bench).toEqual(['p2']);
      expect(data.taxi).toEqual([]);
    });

    it.each(scenarios)('$label returns all rosters summary when no team_id', async ({ sport, handlers }) => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse([
          { roster_id: 1, owner_id: 'u1', players: ['p1', 'p2'], starters: ['p1'], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0 } },
        ]))
        .mockResolvedValueOnce(jsonResponse([
          { user_id: 'u1', display_name: 'Alice', avatar: null },
        ]));

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025 };
      const result = await handlers.get_roster({} as never, params);

      expect(result.success).toBe(true);
      const data = result.data as { rosters: Array<Record<string, unknown>> };
      expect(data.rosters).toHaveLength(1);
      expect(data.rosters[0]).toMatchObject({ rosterId: 1, playerCount: 2, starterCount: 1 });
    });
  });

  describe('get_roster historical weeks', () => {
    function mockHistoricalWeek() {
      mockFetch
        .mockResolvedValueOnce(jsonResponse([
          {
            roster_id: 1, matchup_id: 1, points: 120.5, custom_points: null,
            players: ['p1', 'p2', 'p3'], starters: ['p1', 'p2'],
            players_points: { p1: 60.5, p2: 40, p3: 20 }, starters_points: [60.5, 40],
          },
          {
            roster_id: 2, matchup_id: 1, points: 99.1, custom_points: null,
            players: ['p9'], starters: ['p9'],
            players_points: { p9: 99.1 }, starters_points: [99.1],
          },
        ]))
        .mockResolvedValueOnce(jsonResponse([
          {
            roster_id: 1, owner_id: 'u1',
            players: ['p1', 'p4'], starters: ['p4'], reserve: [], taxi: [],
            settings: { wins: 9, losses: 5, ties: 0, fpts: 1400, fpts_decimal: 0 },
          },
        ]))
        .mockResolvedValueOnce(jsonResponse([
          { user_id: 'u1', display_name: 'Alice', avatar: null },
        ]));
    }

    it.each(scenarios)('$label returns the frozen weekly roster by roster id', async ({ sport, handlers }) => {
      mockHistoricalWeek();

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025, team_id: '1', week: 9 };
      const result = await handlers.get_roster({} as never, params);

      expect(result.success).toBe(true);
      expect(mockFetch.mock.calls[0][0]).toContain('/league/12345/matchups/9');
      const data = result.data as Record<string, unknown>;
      // membership comes from the week's matchup payload, not the current roster
      expect(data.starters).toEqual(['p1', 'p2']);
      expect(data.bench).toEqual(['p3']);
      expect(data.points).toBe(120.5);
      expect(data.playersPoints).toEqual({ p1: 60.5, p2: 40, p3: 20 });
      expect(data.ownerName).toBe('Alice');
      expect(data.snapshot).toEqual({ type: 'week', week: 9 });
      expect(data.limitations).toEqual({ reserveAndTaxiClassificationAvailable: false });
      // temporally pure: no current-state fields leak into historical responses
      expect(data).not.toHaveProperty('record');
      expect(data).not.toHaveProperty('reserve');
      expect(data).not.toHaveProperty('taxi');
    });

    it.each(scenarios)('$label resolves team_id by owner id too', async ({ sport, handlers }) => {
      mockHistoricalWeek();

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025, team_id: 'u1', week: 9 };
      const result = await handlers.get_roster({} as never, params);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.rosterId).toBe(1);
    });

    it.each(scenarios)('$label errors on a week with no matchup data', async ({ sport, handlers }) => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(jsonResponse([]))
        .mockResolvedValueOnce(jsonResponse([]));

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025, team_id: '1', week: 40 };
      const result = await handlers.get_roster({} as never, params);

      expect(result.success).toBe(false);
      expect(result.code).toBe('SLEEPER_NOT_FOUND');
      expect(result.error).toContain('week 40');
    });

    it.each(scenarios)('$label requires team_id for historical weeks', async ({ sport, handlers }) => {
      const params: ToolParams = { sport, league_id: '12345', season_year: 2025, week: 9 };
      const result = await handlers.get_roster({} as never, params);

      expect(result.success).toBe(false);
      expect(result.code).toBe('MISSING_PARAM');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it.each(scenarios)('$label rejects an injected date snapshot with a corrective error', async ({ sport, handlers }) => {
      const params: ToolParams = {
        sport, league_id: '12345', season_year: 2025, team_id: '1',
        snapshot: { type: 'date', date: '2025-11-05' },
      };
      const result = await handlers.get_roster({} as never, params);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_ROSTER_SNAPSHOT_SELECTOR');
      expect(result.error).toContain('week');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it.each(scenarios)('$label current roster carries a current snapshot block', async ({ sport, handlers }) => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse([
          {
            roster_id: 1, owner_id: 'u1',
            players: ['p1', 'p2'], starters: ['p1'], reserve: [],
            settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0 },
          },
        ]))
        .mockResolvedValueOnce(jsonResponse([
          { user_id: 'u1', display_name: 'Alice', avatar: null },
        ]));

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025, team_id: '1' };
      const result = await handlers.get_roster({} as never, params);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.snapshot).toEqual({ type: 'current' });
      expect(data).toHaveProperty('record');
    });
  });

  describe('get_matchups', () => {
    it.each(scenarios)('$label fetches sport-specific state for default week', async ({ sport, handlers, statePath }) => {
      // State fetch for current week
      mockFetch.mockResolvedValueOnce(jsonResponse({ week: 3 }));
      // Matchups
      mockFetch.mockResolvedValueOnce(jsonResponse([
        { matchup_id: 1, roster_id: 1, points: 120.5, starters: ['p1'] },
        { matchup_id: 1, roster_id: 2, points: 105.3, starters: ['p2'] },
      ]));
      // Rosters
      mockFetch.mockResolvedValueOnce(jsonResponse([
        { roster_id: 1, owner_id: 'u1', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0 } },
        { roster_id: 2, owner_id: 'u2', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0 } },
      ]));
      // Users
      mockFetch.mockResolvedValueOnce(jsonResponse([
        { user_id: 'u1', display_name: 'Alice', avatar: null },
        { user_id: 'u2', display_name: 'Bob', avatar: null },
      ]));

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025 };
      const result = await handlers.get_matchups({} as never, params);

      expect(result.success).toBe(true);

      // Verify the correct state path was called
      const stateCall = mockFetch.mock.calls[0];
      expect(stateCall[0]).toContain(statePath);

      const data = result.data as { week: number; matchups: Array<Record<string, unknown>> };
      expect(data.week).toBe(3);
      expect(data.matchups).toHaveLength(1);
      expect(data.matchups[0]).toMatchObject({
        matchupId: 1,
        winner: 'home',
      });
    });

    it.each(scenarios)('$label falls back to week 1 when state response has no week', async ({ sport, handlers }) => {
      // State fetch returns an unexpected shape.
      mockFetch.mockResolvedValueOnce(jsonResponse({}));
      // Matchups
      mockFetch.mockResolvedValueOnce(jsonResponse([
        { matchup_id: 1, roster_id: 1, points: 0, starters: [] },
        { matchup_id: 1, roster_id: 2, points: 0, starters: [] },
      ]));
      // Rosters
      mockFetch.mockResolvedValueOnce(jsonResponse([
        { roster_id: 1, owner_id: 'u1', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0 } },
        { roster_id: 2, owner_id: 'u2', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0 } },
      ]));
      // Users
      mockFetch.mockResolvedValueOnce(jsonResponse([
        { user_id: 'u1', display_name: 'Alice', avatar: null },
        { user_id: 'u2', display_name: 'Bob', avatar: null },
      ]));

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025 };
      const result = await handlers.get_matchups({} as never, params);

      expect(result.success).toBe(true);
      expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/matchups/1'))).toBe(true);
      const data = result.data as { week: number };
      expect(data.week).toBe(1);
    });

    it.each(scenarios)('$label falls back to week 1 when state response returns week 0', async ({ sport, handlers }) => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ week: 0 }));
      // Matchups
      mockFetch.mockResolvedValueOnce(jsonResponse([
        { matchup_id: 1, roster_id: 1, points: 0, starters: [] },
        { matchup_id: 1, roster_id: 2, points: 0, starters: [] },
      ]));
      // Rosters
      mockFetch.mockResolvedValueOnce(jsonResponse([
        { roster_id: 1, owner_id: 'u1', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0 } },
        { roster_id: 2, owner_id: 'u2', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0 } },
      ]));
      // Users
      mockFetch.mockResolvedValueOnce(jsonResponse([
        { user_id: 'u1', display_name: 'Alice', avatar: null },
        { user_id: 'u2', display_name: 'Bob', avatar: null },
      ]));

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025 };
      const result = await handlers.get_matchups({} as never, params);

      expect(result.success).toBe(true);
      expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/matchups/1'))).toBe(true);
      const data = result.data as { week: number };
      expect(data.week).toBe(1);
    });
  });
});
