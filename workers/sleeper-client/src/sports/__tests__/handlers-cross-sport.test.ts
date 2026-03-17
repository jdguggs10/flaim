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

  describe('get_league_info', () => {
    it.each(scenarios)('$label returns consistent league metadata shape', async ({ sport, handlers }) => {
      mockFetch.mockResolvedValueOnce(jsonResponse({
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
      }));

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025 };
      const result = await handlers.get_league_info({} as never, params);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.leagueId).toBe('12345');
      expect(data.name).toBe('Test League');
      expect(data.totalRosters).toBe(10);
    });
  });

  describe('get_standings', () => {
    it.each(scenarios)('$label computes standings with ranking', async ({ sport, handlers }) => {
      mockFetch
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
        ]));

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
    it.each(scenarios)('$label returns roster with starters/bench/reserve', async ({ sport, handlers }) => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse([
          {
            roster_id: 1, owner_id: 'u1',
            players: ['p1', 'p2', 'p3'], starters: ['p1'], reserve: ['p3'],
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
      expect(data.ownerName).toBe('Alice');
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
