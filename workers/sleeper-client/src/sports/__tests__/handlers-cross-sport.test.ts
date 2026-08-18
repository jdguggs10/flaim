import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { footballHandlers } from '../football/handlers';
import { basketballHandlers } from '../basketball/handlers';
import type { Env, ToolParams } from '../../types';
import { clearSleeperPlayersInMemoryCacheForTesting } from '../../shared/sleeper-players-cache';
import { SLEEPER_PLAYER_ENRICHMENT_WARNING } from '../../shared/sleeper-enrichment';
import { TRADED_PICKS_UNAVAILABLE_WARNING, tradedPicksPartialWarning } from '../../shared/handlers/get-league-info';

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

// A 200 whose body is not valid JSON — .json() rejects, exercising the
// get_league_info traded_picks parse-failure path.
function invalidJsonResponse(): Response {
  return new Response('not valid json{{{', {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Queues the three fetches get_league_info always needs (league, rosters,
// users) so traded_picks-focused tests only need to queue their own 4th
// response. league_id '12345', two rosters (u1=Alice, u2=Bob).
function mockBaseLeagueFetches() {
  mockFetch
    .mockResolvedValueOnce(jsonResponse({
      league_id: '12345',
      name: 'Test League',
      sport: 'nfl',
      season: '2025',
      status: 'in_season',
      total_rosters: 2,
      roster_positions: ['QB', 'RB'],
      scoring_settings: { pass_yd: 0.04 },
      previous_league_id: null,
      draft_id: 'draft_1',
    }))
    .mockResolvedValueOnce(jsonResponse([
      { roster_id: 1, owner_id: 'u1', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0 } },
      { roster_id: 2, owner_id: 'u2', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0 } },
    ]))
    .mockResolvedValueOnce(jsonResponse([
      { user_id: 'u1', display_name: 'Alice', avatar: null },
      { user_id: 'u2', display_name: 'Bob', avatar: null },
    ]));
}

interface TestPlayer {
  player_id: string;
  full_name: string;
  position?: string;
  team?: string;
}

// Working KV-backed player index — avoids an extra network fetch and keeps
// each test's roster/matchup enrichment deterministic and self-contained.
// A real (Promise-returning) KV mock also matters for call ordering: Sleeper
// roster/matchup fetches and the player-index load now run in parallel, and
// only a genuinely async KV call (never a synchronous `{} as never` property
// throw) preserves the mockFetch call order this file's tests queue against.
function playersCacheEnv(players: TestPlayer[]): Env {
  const kvGet = vi.fn().mockResolvedValue(JSON.stringify(players.map((p) => ({ ...p, active: true }))));
  const kvPut = vi.fn().mockResolvedValue(undefined);
  return { SLEEPER_PLAYERS_CACHE: { get: kvGet, put: kvPut } } as unknown as Env;
}

// Player fixture for tests that need a working, non-empty player index but
// don't care about its content (they don't assert enriched fields).
const UNUSED_PLAYER: TestPlayer[] = [{ player_id: 'unused', full_name: 'Unused Player' }];

// A real KV cache miss (get resolves null) — used by the player-index
// failure-degradation tests below, which each queue their own failure
// response for the GET /players/{sport} network call.
function cacheMissEnv(): Env {
  const kvGet = vi.fn().mockResolvedValue(null);
  const kvPut = vi.fn().mockResolvedValue(undefined);
  return { SLEEPER_PLAYERS_CACHE: { get: kvGet, put: kvPut } } as unknown as Env;
}

interface PlayersIndexFailure {
  label: string;
  queueFailure: () => void;
}

// Three realistic ways the Sleeper players-index network call can fail or
// come back unusable. get_roster/get_matchups must degrade to { id }-only
// entries plus a top-level warnings array in every case — never fail the
// whole request over enrichment.
const playersIndexFailures: PlayersIndexFailure[] = [
  {
    label: 'a 503 from the players endpoint',
    queueFailure: () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 503 }));
    },
  },
  {
    label: 'a rejected players-endpoint fetch (network error)',
    queueFailure: () => {
      mockFetch.mockRejectedValueOnce(new Error('network unreachable'));
    },
  },
  {
    label: 'a malformed 200 players-endpoint payload',
    queueFailure: () => {
      mockFetch.mockResolvedValueOnce(jsonResponse('nope'));
    },
  },
];

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
      // get_league_info now makes 4 parallel fetches: league, rosters, users, traded_picks
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
        ]))
        // Redraft leagues (and any league with nothing traded) return [] from traded_picks
        .mockResolvedValueOnce(jsonResponse([]));

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

      // An empty traded_picks array is a normal (redraft) result, not a failure —
      // and pickOwnershipNote is suppressed when there's nothing to caveat.
      expect(data.tradedPicks).toEqual([]);
      expect(data.pickOwnershipNote).toBeUndefined();
      expect(data.warnings).toBeUndefined();

      // The four upstream calls happen in league, rosters, users, traded_picks order
      expect(mockFetch).toHaveBeenNthCalledWith(1, 'https://api.sleeper.app/v1/league/12345', expect.anything());
      expect(mockFetch).toHaveBeenNthCalledWith(2, 'https://api.sleeper.app/v1/league/12345/rosters', expect.anything());
      expect(mockFetch).toHaveBeenNthCalledWith(3, 'https://api.sleeper.app/v1/league/12345/users', expect.anything());
      expect(mockFetch).toHaveBeenNthCalledWith(4, 'https://api.sleeper.app/v1/league/12345/traded_picks', expect.anything());
    });

    it.each(scenarios)('$label resolves traded picks with owner/team names, sorted by season/round/originalRosterId', async ({ sport, handlers }) => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({
          league_id: '12345',
          name: 'Dynasty League',
          sport: 'nfl',
          season: '2026',
          status: 'in_season',
          total_rosters: 3,
          roster_positions: ['QB', 'RB'],
          scoring_settings: { pass_yd: 0.04 },
          previous_league_id: null,
          draft_id: 'draft_1',
          settings: { draft_rounds: 4, type: 2 },
        }))
        .mockResolvedValueOnce(jsonResponse([
          { roster_id: 1, owner_id: 'u1', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0 } },
          { roster_id: 2, owner_id: 'u2', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0 } },
          { roster_id: 3, owner_id: 'u3', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0 } },
        ]))
        .mockResolvedValueOnce(jsonResponse([
          { user_id: 'u1', display_name: 'Alice', avatar: null, metadata: { team_name: 'Alpha Dogs' } },
          { user_id: 'u2', display_name: 'Bob', avatar: null },
          { user_id: 'u3', display_name: 'Cara', avatar: null, metadata: { team_name: 'Comet Crew' } },
        ]))
        .mockResolvedValueOnce(jsonResponse([
          // Deliberately out of order to verify the sort (season, round, originalRosterId asc)
          { season: '2027', round: 2, roster_id: 1, previous_owner_id: 1, owner_id: 3 },
          { season: '2026', round: 1, roster_id: 2, previous_owner_id: 2, owner_id: 1 },
          { season: '2027', round: 1, roster_id: 3, previous_owner_id: 3, owner_id: 2 },
        ]));

      const params: ToolParams = { sport, league_id: '12345', season_year: 2026 };
      const result = await handlers.get_league_info({} as never, params);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.draftRounds).toBe(4);
      expect(typeof data.pickOwnershipNote).toBe('string');
      expect(data.warnings).toBeUndefined();

      const tradedPicks = data.tradedPicks as Array<Record<string, unknown>>;
      expect(tradedPicks).toHaveLength(3);
      expect(tradedPicks[0]).toMatchObject({
        season: '2026',
        round: 1,
        originalRosterId: 2,
        previousRosterId: 2,
        currentRosterId: 1,
        originalOwnerName: 'Bob',
        currentOwnerName: 'Alice',
        currentTeamName: 'Alpha Dogs',
      });
      expect(tradedPicks[0].originalTeamName).toBeUndefined();
      expect(tradedPicks[1]).toMatchObject({
        season: '2027',
        round: 1,
        originalRosterId: 3,
        previousRosterId: 3,
        currentRosterId: 2,
        originalOwnerName: 'Cara',
        originalTeamName: 'Comet Crew',
        currentOwnerName: 'Bob',
      });
      expect(tradedPicks[1].currentTeamName).toBeUndefined();
      expect(tradedPicks[2]).toMatchObject({
        season: '2027',
        round: 2,
        originalRosterId: 1,
        previousRosterId: 1,
        currentRosterId: 3,
        originalOwnerName: 'Alice',
        originalTeamName: 'Alpha Dogs',
        currentOwnerName: 'Cara',
        currentTeamName: 'Comet Crew',
      });
    });

    it.each(scenarios)('$label omits tradedPicks and adds a warning when the traded_picks fetch fails, without failing the request', async ({ sport, handlers }) => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse({
          league_id: '12345',
          name: 'Test League',
          sport: 'nfl',
          season: '2025',
          status: 'in_season',
          total_rosters: 1,
          roster_positions: ['QB', 'RB'],
          scoring_settings: { pass_yd: 0.04 },
          previous_league_id: null,
          draft_id: 'draft_1',
        }))
        .mockResolvedValueOnce(jsonResponse([
          { roster_id: 1, owner_id: 'u1', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0 } },
        ]))
        .mockResolvedValueOnce(jsonResponse([
          { user_id: 'u1', display_name: 'Alice', avatar: null },
        ]))
        .mockResolvedValueOnce(jsonResponse({ error: 'server error' }, 500));

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025 };
      const result = await handlers.get_league_info({} as never, params);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      // The rest of the response still succeeds
      expect(data.leagueId).toBe('12345');
      expect(data.tradedPicks).toBeUndefined();
      expect(data.pickOwnershipNote).toBeUndefined();
      expect(data.warnings).toEqual([TRADED_PICKS_UNAVAILABLE_WARNING]);
    });

    it.each(scenarios)('$label degrades gracefully when the traded_picks fetch rejects (network error)', async ({ sport, handlers }) => {
      mockBaseLeagueFetches();
      mockFetch.mockRejectedValueOnce(new Error('network boom'));

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025 };
      const result = await handlers.get_league_info({} as never, params);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.leagueId).toBe('12345');
      expect(data.tradedPicks).toBeUndefined();
      expect(data.pickOwnershipNote).toBeUndefined();
      expect(data.warnings).toEqual([TRADED_PICKS_UNAVAILABLE_WARNING]);
    });

    it.each(scenarios)('$label degrades gracefully when the traded_picks fetch 404s', async ({ sport, handlers }) => {
      mockBaseLeagueFetches();
      mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'not found' }, 404));

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025 };
      const result = await handlers.get_league_info({} as never, params);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.leagueId).toBe('12345');
      expect(data.tradedPicks).toBeUndefined();
      expect(data.pickOwnershipNote).toBeUndefined();
      expect(data.warnings).toEqual([TRADED_PICKS_UNAVAILABLE_WARNING]);
    });

    it.each(scenarios)('$label degrades gracefully when the traded_picks response body is not valid JSON', async ({ sport, handlers }) => {
      mockBaseLeagueFetches();
      mockFetch.mockResolvedValueOnce(invalidJsonResponse());

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025 };
      const result = await handlers.get_league_info({} as never, params);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.leagueId).toBe('12345');
      expect(data.tradedPicks).toBeUndefined();
      expect(data.pickOwnershipNote).toBeUndefined();
      expect(data.warnings).toEqual([TRADED_PICKS_UNAVAILABLE_WARNING]);
    });

    it.each(scenarios)('$label degrades gracefully when the traded_picks response is not an array', async ({ sport, handlers }) => {
      mockBaseLeagueFetches();
      mockFetch.mockResolvedValueOnce(jsonResponse({ picks: 'not an array' }));

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025 };
      const result = await handlers.get_league_info({} as never, params);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.leagueId).toBe('12345');
      expect(data.tradedPicks).toBeUndefined();
      expect(data.pickOwnershipNote).toBeUndefined();
      expect(data.warnings).toEqual([TRADED_PICKS_UNAVAILABLE_WARNING]);
    });

    it.each(scenarios)('$label treats a traded_picks payload with NO valid entries as unavailable (never throws)', async ({ sport, handlers }) => {
      mockBaseLeagueFetches();
      mockFetch.mockResolvedValueOnce(jsonResponse([
        null,
        { season: 2027, round: 1, roster_id: 1, previous_owner_id: 1, owner_id: 2 }, // season is a number, not a string
      ]));

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025 };
      const result = await handlers.get_league_info({} as never, params);

      // Must not throw out of the handler and turn into success: false.
      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.leagueId).toBe('12345');
      expect(data.tradedPicks).toBeUndefined();
      expect(data.pickOwnershipNote).toBeUndefined();
      expect(data.warnings).toEqual([TRADED_PICKS_UNAVAILABLE_WARNING]);
    });

    it.each(scenarios)('$label keeps valid traded picks and drops malformed entries with a count warning', async ({ sport, handlers }) => {
      mockBaseLeagueFetches();
      mockFetch.mockResolvedValueOnce(jsonResponse([
        { season: '2027', round: 2, roster_id: 2, previous_owner_id: 2, owner_id: 1 }, // valid
        null,                                                                          // malformed
        { season: 2027, round: 1, roster_id: 1, previous_owner_id: 1, owner_id: 2 },   // malformed (numeric season)
        { season: '2026', round: 1, roster_id: 1, previous_owner_id: 1, owner_id: 2 }, // valid
      ]));

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025 };
      const result = await handlers.get_league_info({} as never, params);

      expect(result.success).toBe(true);
      const data = result.data as { tradedPicks: Array<Record<string, unknown>>; pickOwnershipNote?: string; warnings?: string[] };
      // One malformed entry must not hide legitimate trades for dynasty users.
      expect(data.tradedPicks).toHaveLength(2);
      expect(data.tradedPicks[0]).toMatchObject({ season: '2026', round: 1, originalRosterId: 1, currentRosterId: 2 });
      expect(data.tradedPicks[1]).toMatchObject({ season: '2027', round: 2, originalRosterId: 2, currentRosterId: 1 });
      expect(data.pickOwnershipNote).toBeDefined();
      expect(data.warnings).toEqual([tradedPicksPartialWarning(2)]);
    });

    it.each(scenarios)('$label resolves an orphaned traded pick (roster id absent from rosters) without names or a throw', async ({ sport, handlers }) => {
      mockBaseLeagueFetches();
      mockFetch.mockResolvedValueOnce(jsonResponse([
        // roster_id 99 does not exist in the rosters mocked by mockBaseLeagueFetches
        { season: '2027', round: 3, roster_id: 99, previous_owner_id: 99, owner_id: 1 },
      ]));

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025 };
      const result = await handlers.get_league_info({} as never, params);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.warnings).toBeUndefined();

      const tradedPicks = data.tradedPicks as Array<Record<string, unknown>>;
      expect(tradedPicks).toHaveLength(1);
      expect(tradedPicks[0]).toMatchObject({
        season: '2027',
        round: 3,
        originalRosterId: 99,
        previousRosterId: 99,
        currentRosterId: 1,
        currentOwnerName: 'Alice',
      });
      expect(tradedPicks[0].originalOwnerName).toBeUndefined();
      expect(tradedPicks[0].originalTeamName).toBeUndefined();
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

    // Player-index failure degradation (503 / network error / malformed
    // payload) is covered thoroughly by the dedicated describe blocks near
    // the end of this file, for both get_roster (current + historical) and
    // get_matchups.

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

    it.each(scenarios)('$label returns the frozen weekly roster by roster id, enriched with name/position (never team — temporal purity) and teamName', async ({ sport, handlers }) => {
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
      // membership comes from the week's matchup payload, not the current roster.
      // The player index only tracks each player's CURRENT club, so historical
      // entries never carry `team` — even though the mocked index has one for
      // p1/p2 — to avoid showing a club a player joined after this week.
      expect(data.starters).toEqual([
        { id: 'p1', name: 'Player One', position: 'QB' },
        { id: 'p2', name: 'Player Two', position: 'WR' },
      ]);
      // p3 is not in the mocked player index — still resolves to an id-only entry
      expect(data.bench).toEqual([{ id: 'p3' }]);
      expect(data.points).toBe(120.5);
      expect(data.playersPoints).toEqual({ p1: 60.5, p2: 40, p3: 20 });
      expect(data.ownerName).toBe('Alice');
      expect(data.teamName).toBe('The Waiver Wire Wizards');
      expect(data.snapshot).toEqual({ type: 'week', week: 9 });
      expect(data.limitations).toEqual({
        reserveAndTaxiClassificationAvailable: false,
        playerProTeamAvailable: false,
      });
      expect(data.warnings).toBeUndefined();
      // temporally pure: no current-state fields leak into historical responses
      expect(data).not.toHaveProperty('record');
      expect(data).not.toHaveProperty('reserve');
      expect(data).not.toHaveProperty('taxi');
    });

    it.each(scenarios)('$label resolves team_id by owner id too', async ({ sport, handlers }) => {
      mockHistoricalWeek();

      const params: ToolParams = { sport, league_id: '12345', season_year: 2025, team_id: 'u1', week: 9 };
      const result = await handlers.get_roster(playersCacheEnv(UNUSED_PLAYER), params);

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
      const result = await handlers.get_roster(playersCacheEnv(UNUSED_PLAYER), params);

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
      const result = await handlers.get_roster(playersCacheEnv(UNUSED_PLAYER), params);

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
      const result = await handlers.get_matchups(playersCacheEnv(UNUSED_PLAYER), params);

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
      // Omitted week resolves to the live week, so `team` is trustworthy and no limitation is flagged.
      expect((result.data as Record<string, unknown>).limitations).toBeUndefined();
    });

    it.each(scenarios)('$label omits starter team and flags playerProTeamAvailable when a week is passed explicitly (temporal purity)', async ({ sport, handlers }) => {
      // No state fetch when week is explicit: matchups, rosters, users.
      mockFetch.mockResolvedValueOnce(jsonResponse([
        { matchup_id: 1, roster_id: 1, points: 120.5, starters: ['p1'] },
        { matchup_id: 1, roster_id: 2, points: 105.3, starters: ['p2'] },
      ]));
      mockFetch.mockResolvedValueOnce(jsonResponse([
        { roster_id: 1, owner_id: 'u1', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0 } },
        { roster_id: 2, owner_id: 'u2', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0 } },
      ]));
      mockFetch.mockResolvedValueOnce(jsonResponse([
        { user_id: 'u1', display_name: 'Alice', avatar: null, metadata: { team_name: '  Padded Wizards  ' } },
        { user_id: 'u2', display_name: 'Bob', avatar: null },
      ]));

      const env = playersCacheEnv([
        { player_id: 'p1', full_name: 'Player One', position: 'QB', team: 'BUF' },
        { player_id: 'p2', full_name: 'Player Two', position: 'RB', team: 'MIA' },
      ]);
      const params: ToolParams = { sport, league_id: '12345', season_year: 2025, week: 2 };
      const result = await handlers.get_matchups(env, params);

      expect(result.success).toBe(true);
      expect(mockFetch.mock.calls[0][0]).toContain('/league/12345/matchups/2');
      const data = result.data as {
        week: number;
        limitations?: Record<string, unknown>;
        matchups: Array<{ home: Record<string, unknown> | null; away: Record<string, unknown> | null }>;
      };
      expect(data.week).toBe(2);
      // The player index only knows each player's CURRENT club — never attach it to an explicitly requested week.
      expect(data.matchups[0].home).toMatchObject({
        starters: [{ id: 'p1', name: 'Player One', position: 'QB' }],
        // manager-set team names are trimmed, never padded
        teamName: 'Padded Wizards',
      });
      expect((data.matchups[0].home!.starters as Array<Record<string, unknown>>)[0]).not.toHaveProperty('team');
      expect((data.matchups[0].away!.starters as Array<Record<string, unknown>>)[0]).not.toHaveProperty('team');
      expect(data.limitations).toEqual({ playerProTeamAvailable: false });
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
      const result = await handlers.get_matchups(playersCacheEnv(UNUSED_PLAYER), params);

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
      const result = await handlers.get_matchups(playersCacheEnv(UNUSED_PLAYER), params);

      expect(result.success).toBe(true);
      expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/matchups/1'))).toBe(true);
      const data = result.data as { week: number };
      expect(data.week).toBe(1);
    });
  });
});

// Player-index failure degradation: get_roster (current + historical) and
// get_matchups all load the shared Sleeper player index in parallel with
// their own roster/matchup/user fetches (FLA-275 follow-up). Each of these
// covers three realistic ways that load can fail or come back unusable —
// none of them should fail the request; all should degrade to { id }-only
// entries plus a top-level `warnings` array.
describe('sleeper player-index failure degradation', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    clearSleeperPlayersInMemoryCacheForTesting();
  });

  describe('get_roster (current roster, team_id provided)', () => {
    it.each(playersIndexFailures)('degrades gracefully on $label', async ({ queueFailure }) => {
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
      queueFailure(); // GET /players/{sport}

      const params: ToolParams = { sport: 'football', league_id: '12345', season_year: 2025, team_id: '1' };
      const result = await footballHandlers.get_roster(cacheMissEnv(), params);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.starters).toEqual([{ id: 'p1' }]);
      expect(data.bench).toEqual([{ id: 'p2' }]);
      expect(data.warnings).toEqual([SLEEPER_PLAYER_ENRICHMENT_WARNING]);
    });
  });

  describe('get_roster (historical week roster)', () => {
    function mockHistoricalWeek() {
      mockFetch
        .mockResolvedValueOnce(jsonResponse([
          {
            roster_id: 1, matchup_id: 1, points: 100, custom_points: null,
            players: ['p1', 'p2'], starters: ['p1'],
            players_points: { p1: 60, p2: 40 }, starters_points: [60],
          },
        ]))
        .mockResolvedValueOnce(jsonResponse([
          {
            roster_id: 1, owner_id: 'u1',
            players: ['p1', 'p2'], starters: [], reserve: [], taxi: [],
            settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0 },
          },
        ]))
        .mockResolvedValueOnce(jsonResponse([
          { user_id: 'u1', display_name: 'Alice', avatar: null },
        ]));
    }

    it.each(playersIndexFailures)('degrades gracefully on $label', async ({ queueFailure }) => {
      mockHistoricalWeek();
      queueFailure(); // GET /players/{sport}

      const params: ToolParams = { sport: 'football', league_id: '12345', season_year: 2025, team_id: '1', week: 9 };
      const result = await footballHandlers.get_roster(cacheMissEnv(), params);

      expect(result.success).toBe(true);
      const data = result.data as Record<string, unknown>;
      expect(data.starters).toEqual([{ id: 'p1' }]);
      expect(data.bench).toEqual([{ id: 'p2' }]);
      expect(data.warnings).toEqual([SLEEPER_PLAYER_ENRICHMENT_WARNING]);
    });
  });

  describe('get_matchups', () => {
    it.each(playersIndexFailures)('degrades gracefully on $label', async ({ queueFailure }) => {
      mockFetch
        .mockResolvedValueOnce(jsonResponse([
          { matchup_id: 1, roster_id: 1, points: 10, starters: ['p1'] },
          { matchup_id: 1, roster_id: 2, points: 5, starters: ['p2'] },
        ]))
        .mockResolvedValueOnce(jsonResponse([
          { roster_id: 1, owner_id: 'u1', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0 } },
          { roster_id: 2, owner_id: 'u2', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0 } },
        ]))
        .mockResolvedValueOnce(jsonResponse([
          { user_id: 'u1', display_name: 'Alice', avatar: null },
          { user_id: 'u2', display_name: 'Bob', avatar: null },
        ]));
      queueFailure(); // GET /players/{sport}

      // Explicit week skips the state-fetch call, keeping the mock queue simple.
      const params: ToolParams = { sport: 'football', league_id: '12345', season_year: 2025, week: 3 };
      const result = await footballHandlers.get_matchups(cacheMissEnv(), params);

      expect(result.success).toBe(true);
      const data = result.data as { matchups: Array<{ home: Record<string, unknown> | null }> };
      expect(data.matchups[0].home).toMatchObject({ starters: [{ id: 'p1' }] });
      expect((result.data as Record<string, unknown>).warnings).toEqual([SLEEPER_PLAYER_ENRICHMENT_WARNING]);
    });
  });
});
