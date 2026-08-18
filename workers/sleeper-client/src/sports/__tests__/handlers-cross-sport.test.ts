import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { footballHandlers } from '../football/handlers';
import { basketballHandlers } from '../basketball/handlers';
import type { Env, ToolParams } from '../../types';
import { clearSleeperPlayersInMemoryCacheForTesting } from '../../shared/sleeper-players-cache';

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

interface TestPlayer {
  player_id: string;
  full_name: string;
  position?: string;
  team?: string;
}

// Working KV-backed player index — avoids an extra network fetch and keeps
// each test's roster/matchup enrichment deterministic and self-contained.
function playersCacheEnv(players: TestPlayer[]): Env {
  const kvGet = vi.fn().mockResolvedValue(JSON.stringify(players.map((p) => ({ ...p, active: true }))));
  const kvPut = vi.fn().mockResolvedValue(undefined);
  return { SLEEPER_PLAYERS_CACHE: { get: kvGet, put: kvPut } } as unknown as Env;
}

// A KV/network failure for player-index enrichment — get_roster/get_matchups
// should degrade to { id }-only entries plus a top-level warnings array
// rather than failing the whole request.
function failingPlayersCacheEnv(): Env {
  const kvGet = vi.fn().mockRejectedValue(new Error('kv unavailable'));
  const kvPut = vi.fn().mockResolvedValue(undefined);
  return { SLEEPER_PLAYERS_CACHE: { get: kvGet, put: kvPut } } as unknown as Env;
}

describe('sleeper cross-sport handler characterization tests', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    clearSleeperPlayersInMemoryCacheForTesting();
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

    for (const scenario of scenarios) {
      it.each([
        ['zero', 0],
        ['negative', -1],
        ['fractional', 1.5],
        ['null', null],
        ['NaN', Number.NaN],
        ['infinite', Number.POSITIVE_INFINITY],
      ])(`${scenario.label} get_transactions rejects %s week before upstream fetches`, async (_label, week) => {
        const params = {
          sport: scenario.sport,
          league_id: '12345',
          season_year: 2025,
          week,
        } as unknown as ToolParams;

        const result = await scenario.handlers.get_transactions({} as never, params);

        expect(result.success).toBe(false);
        expect(result.code).toBe('INVALID_TRANSACTION_WINDOW');
        expect(result.status).toBe(400);
        expect(result.retryable).toBe(false);
        expect(result.error).toContain('omit week');
        expect(mockFetch).not.toHaveBeenCalled();
      });
    }
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
          { user_id: 'u1', display_name: 'Alice', avatar: null, metadata: { team_name: 'The Waiver Wire Wizards' } },
          { user_id: 'u2', display_name: 'Bob', avatar: null },
        ]));

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025 };
      const result = await handlers.get_league_info({} as never, params);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.leagueId).toBe('12345');
      expect(data.name).toBe('Test League');
      expect(data.totalRosters).toBe(10);

      const teams = data.teams as Array<{ rosterId: number; ownerName?: string; teamName?: string }>;
      expect(teams).toHaveLength(2);
      // teamName is present only when the manager set users[].metadata.team_name
      expect(teams[0]).toMatchObject({ rosterId: 1, ownerName: 'Alice', teamName: 'The Waiver Wire Wizards' });
      expect(teams[1]).toMatchObject({ rosterId: 2, ownerName: 'Bob' });
      expect(teams[1].teamName).toBeUndefined();
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
          { user_id: 'u1', display_name: 'Alice', avatar: null, metadata: { team_name: 'The Waiver Wire Wizards' } },
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
      // teamName is present only when the manager set users[].metadata.team_name
      expect(data.standings[0]).toMatchObject({ rank: 1, ownerName: 'Alice', teamName: 'The Waiver Wire Wizards', wins: 8 });
      expect(data.standings[1]).toMatchObject({ rank: 2, ownerName: 'Bob', wins: 5 });
      expect(data.standings[1].teamName).toBeUndefined();
    });
  });

  describe('get_roster', () => {
    it.each(scenarios)('$label enriches starters/bench/reserve/taxi with name/position/team and adds teamName', async ({ sport, handlers }) => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse([
          {
            roster_id: 1, owner_id: 'u1',
            players: ['p1', 'p2', 'p3', 'p4'], starters: ['p1'], reserve: ['p3'], taxi: ['p4'],
            settings: { wins: 5, losses: 3, ties: 0, fpts: 800, fpts_decimal: 0, fpts_against: 750, fpts_against_decimal: 0 },
          },
        ]))
        .mockResolvedValueOnce(jsonResponse([
          { user_id: 'u1', display_name: 'Alice', avatar: null, metadata: { team_name: 'The Waiver Wire Wizards' } },
        ]));

      const env = playersCacheEnv([
        { player_id: 'p1', full_name: 'Player One', position: 'QB', team: 'BUF' },
        { player_id: 'p2', full_name: 'Player Two', position: 'WR', team: 'MIA' },
        { player_id: 'p3', full_name: 'Player Three', position: 'TE', team: 'KC' },
        { player_id: 'p4', full_name: 'Player Four', position: 'RB', team: 'DAL' },
      ]);
      const params: ToolParams = { sport, league_id: '12345', season_year: 2025, team_id: '1' };
      const result = await handlers.get_roster(env, params);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.starters).toEqual([{ id: 'p1', name: 'Player One', position: 'QB', team: 'BUF' }]);
      expect(data.bench).toEqual([{ id: 'p2', name: 'Player Two', position: 'WR', team: 'MIA' }]);
      expect(data.reserve).toEqual([{ id: 'p3', name: 'Player Three', position: 'TE', team: 'KC' }]);
      expect(data.taxi).toEqual([{ id: 'p4', name: 'Player Four', position: 'RB', team: 'DAL' }]);
      expect(data.ownerName).toBe('Alice');
      expect(data.teamName).toBe('The Waiver Wire Wizards');
      expect(data.warnings).toBeUndefined();
    });

    it.each(scenarios)('$label enriches a "0" empty slot, a DEF abbreviation id, and an unknown id; omits teamName when unset', async ({ sport, handlers }) => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse([
          {
            roster_id: 2, owner_id: 'u2',
            players: ['SF', 'ghost999'], starters: ['SF', '0', 'ghost999'], reserve: [], taxi: [],
            settings: { wins: 2, losses: 6, ties: 0, fpts: 500, fpts_decimal: 0, fpts_against: 700, fpts_against_decimal: 0 },
          },
        ]))
        .mockResolvedValueOnce(jsonResponse([
          { user_id: 'u2', display_name: 'Bob', avatar: null },
        ]));

      const env = playersCacheEnv([
        { player_id: 'SF', full_name: 'San Francisco 49ers', position: 'DEF', team: 'SF' },
      ]);
      const params: ToolParams = { sport, league_id: '12345', season_year: 2025, team_id: '2' };
      const result = await handlers.get_roster(env, params);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.starters).toEqual([
        { id: 'SF', name: 'San Francisco 49ers', position: 'DEF', team: 'SF' },
        { id: '0', empty: true },
        { id: 'ghost999' },
      ]);
      expect(data.ownerName).toBe('Bob');
      expect(data.teamName).toBeUndefined();
    });

    it.each(scenarios)('$label degrades to id-only entries plus a warning when the player index is unavailable', async ({ sport, handlers }) => {
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
      // No mock queued for the players-index network fallback — it 404s via
      // the exhausted mockFetch queue, exercising the same degradation path
      // as get_transactions/get_free_agents.

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025, team_id: '1' };
      const result = await handlers.get_roster(failingPlayersCacheEnv(), params);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.starters).toEqual([{ id: 'p1' }]);
      expect(data.bench).toEqual([{ id: 'p2' }]);
      expect(data.warnings).toEqual([
        'PLAYER_ENRICHMENT_UNAVAILABLE: Sleeper player index unavailable; roster/matchup player entries include id only.',
      ]);
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
      const result = await handlers.get_roster(playersCacheEnv([]), params);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      // p2 unknown to the (empty) index — still resolves to an id-only entry, never throws
      expect(data.bench).toEqual([{ id: 'p2' }]);
      expect(data.taxi).toEqual([]);
    });

    it.each(scenarios)('$label returns all rosters summary when no team_id', async ({ sport, handlers }) => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse([
          { roster_id: 1, owner_id: 'u1', players: ['p1', 'p2'], starters: ['p1'], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0 } },
        ]))
        .mockResolvedValueOnce(jsonResponse([
          { user_id: 'u1', display_name: 'Alice', avatar: null, metadata: { team_name: 'The Waiver Wire Wizards' } },
        ]));

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025 };
      const result = await handlers.get_roster({} as never, params);

      expect(result.success).toBe(true);
      const data = result.data as { rosters: Array<Record<string, unknown>> };
      expect(data.rosters).toHaveLength(1);
      expect(data.rosters[0]).toMatchObject({ rosterId: 1, playerCount: 2, starterCount: 1, teamName: 'The Waiver Wire Wizards' });
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
          { user_id: 'u1', display_name: 'Alice', avatar: null, metadata: { team_name: 'The Waiver Wire Wizards' } },
        ]));
    }

    it.each(scenarios)('$label returns the frozen weekly roster by roster id, enriched with name/position/team and teamName', async ({ sport, handlers }) => {
      mockHistoricalWeek();

      const env = playersCacheEnv([
        { player_id: 'p1', full_name: 'Player One', position: 'QB', team: 'BUF' },
        { player_id: 'p2', full_name: 'Player Two', position: 'WR', team: 'MIA' },
      ]);
      const params: ToolParams = { sport, league_id: '12345', season_year: 2025, team_id: '1', week: 9 };
      const result = await handlers.get_roster(env, params);

      expect(result.success).toBe(true);
      expect(mockFetch.mock.calls[0][0]).toContain('/league/12345/matchups/9');
      const data = result.data as Record<string, unknown>;
      // membership comes from the week's matchup payload, not the current roster
      expect(data.starters).toEqual([
        { id: 'p1', name: 'Player One', position: 'QB', team: 'BUF' },
        { id: 'p2', name: 'Player Two', position: 'WR', team: 'MIA' },
      ]);
      // p3 is not in the mocked player index — still resolves to an id-only entry
      expect(data.bench).toEqual([{ id: 'p3' }]);
      expect(data.points).toBe(120.5);
      expect(data.playersPoints).toEqual({ p1: 60.5, p2: 40, p3: 20 });
      expect(data.ownerName).toBe('Alice');
      expect(data.teamName).toBe('The Waiver Wire Wizards');
      expect(data.snapshot).toEqual({ type: 'week', week: 9 });
      expect(data.limitations).toEqual({ reserveAndTaxiClassificationAvailable: false });
      expect(data.warnings).toBeUndefined();
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

    it.each(scenarios)('$label rejects a malformed injected snapshot without degrading to current', async ({ sport, handlers }) => {
      const params: ToolParams = {
        sport, league_id: '12345', season_year: 2025, team_id: '1',
        snapshot: { type: 'week', week: 0 } as never,
      };
      const result = await handlers.get_roster({} as never, params);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_ROSTER_SNAPSHOT_SELECTOR');
      expect(result.status).toBe(400);
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

    it.each(scenarios)('$label enriches starters with name/position/team and adds teamName per side', async ({ sport, handlers }) => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ week: 3 }));
      mockFetch.mockResolvedValueOnce(jsonResponse([
        { matchup_id: 1, roster_id: 1, points: 120.5, starters: ['p1'] },
        { matchup_id: 1, roster_id: 2, points: 105.3, starters: ['p2'] },
      ]));
      mockFetch.mockResolvedValueOnce(jsonResponse([
        { roster_id: 1, owner_id: 'u1', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0 } },
        { roster_id: 2, owner_id: 'u2', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0 } },
      ]));
      mockFetch.mockResolvedValueOnce(jsonResponse([
        { user_id: 'u1', display_name: 'Alice', avatar: null, metadata: { team_name: 'The Waiver Wire Wizards' } },
        { user_id: 'u2', display_name: 'Bob', avatar: null },
      ]));

      const env = playersCacheEnv([
        { player_id: 'p1', full_name: 'Player One', position: 'QB', team: 'BUF' },
        { player_id: 'p2', full_name: 'Player Two', position: 'RB', team: 'MIA' },
      ]);
      const params: ToolParams = { sport, league_id: '12345', season_year: 2025 };
      const result = await handlers.get_matchups(env, params);

      expect(result.success).toBe(true);
      const data = result.data as { matchups: Array<{ home: Record<string, unknown> | null; away: Record<string, unknown> | null }> };
      expect(data.matchups[0].home).toMatchObject({
        ownerName: 'Alice',
        teamName: 'The Waiver Wire Wizards',
        starters: [{ id: 'p1', name: 'Player One', position: 'QB', team: 'BUF' }],
      });
      expect(data.matchups[0].away).toMatchObject({
        ownerName: 'Bob',
        starters: [{ id: 'p2', name: 'Player Two', position: 'RB', team: 'MIA' }],
      });
      expect(data.matchups[0].away?.teamName).toBeUndefined();
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
