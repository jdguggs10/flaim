import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { footballHandlers } from '../handlers';
import type { ToolParams } from '../../../types';
import { getYahooCredentials } from '../../../shared/auth';
import { yahooFetch } from '../../../shared/yahoo-api';
import {
  buildRosterPointsFixture,
  buildRosterPointsNoStatsFixture,
  buildRosterPointsReversedOrderFixture,
  buildRosterPointsSeasonCoverageFixture,
} from '../test-fixtures/roster-points-fixture';

vi.mock('../../../shared/auth', () => ({
  getYahooCredentials: vi.fn(),
}));

vi.mock('../../../shared/yahoo-api', async () => {
  const actual = await vi.importActual('../../../shared/yahoo-api') as Record<string, unknown>;
  return {
    ...actual,
    yahooFetch: vi.fn(),
  };
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('yahoo football get_roster weekly player points fixture integration', () => {
  const getCredsMock = getYahooCredentials as MockedFunction<typeof getYahooCredentials>;
  const fetchMock = yahooFetch as MockedFunction<typeof yahooFetch>;

  beforeEach(() => {
    vi.clearAllMocks();
    getCredsMock.mockResolvedValue({ accessToken: 'token' });
  });

  it('football week 5 fetches the stats selector, preserves a 0 total, omits points for a no-stats player, and stays historical-pure', async () => {
    fetchMock.mockResolvedValue(jsonResponse(buildRosterPointsFixture()));

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      team_id: '449.l.123.t.1',
      week: 5,
    };
    const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const calledPath = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain('/roster;week=5/players/stats;type=week;week=5');

    if (!result.success) return;
    const data = result.data as {
      players: Array<Record<string, unknown>>;
      pointsCoverage?: { type: string; week: number };
      limitations?: Record<string, boolean>;
    };

    expect(data.players).toHaveLength(3);
    expect(data.players[0].points).toBe(22.16);
    // Bye-week RB: total '0.00' must be preserved as 0, never omitted.
    expect(data.players[1].points).toBe(0);
    // Bench WR with no stats sub-resource: no `points` key at all.
    expect(data.players[2]).not.toHaveProperty('points');

    expect(data.pointsCoverage).toEqual({ type: 'week', week: 5 });

    // FLA-278 historical rule still holds on a week snapshot.
    expect(data.players[0]).not.toHaveProperty('team');
    expect(data.players[0]).not.toHaveProperty('status');
    expect(data.limitations?.playerProTeamAvailable).toBe(false);
  });

  it('reversed sub-resource order (player_points before selected_position) yields identical output', async () => {
    fetchMock.mockResolvedValue(jsonResponse(buildRosterPointsReversedOrderFixture()));

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      team_id: '449.l.123.t.1',
      week: 5,
    };
    const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as {
      players: Array<Record<string, unknown>>;
      pointsCoverage?: { type: string; week: number };
    };

    expect(data.players[0]).toMatchObject({ points: 22.16, selectedPosition: 'QB' });
    expect(data.players[1]).toMatchObject({ points: 0, selectedPosition: 'RB' });
    expect(data.players[2]).not.toHaveProperty('points');
    expect(data.players[2].selectedPosition).toBe('BN');
    expect(data.pointsCoverage).toEqual({ type: 'week', week: 5 });
  });

  it('season-coverage player_points never surfaces points or pointsCoverage, and flags playerPointsAvailable false', async () => {
    fetchMock.mockResolvedValue(jsonResponse(buildRosterPointsSeasonCoverageFixture()));

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      team_id: '449.l.123.t.1',
      week: 5,
    };
    const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as {
      players: Array<Record<string, unknown>>;
      pointsCoverage?: unknown;
      limitations?: Record<string, boolean>;
    };

    expect(data.players).toHaveLength(1);
    expect(data.players[0]).not.toHaveProperty('points');
    expect(data.pointsCoverage).toBeUndefined();
    expect(data.limitations?.playerPointsAvailable).toBe(false);
    // Historical rule is unaffected by the points gate.
    expect(data.limitations?.playerProTeamAvailable).toBe(false);
  });

  it('current football snapshot requests the unweighted stats selector and still surfaces points when Yahoo echoes a week', async () => {
    fetchMock.mockResolvedValue(jsonResponse(buildRosterPointsFixture()));

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      team_id: '449.l.123.t.1',
    };
    const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const calledPath = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain('/players/stats;type=week');
    expect(calledPath).not.toContain(';week=');

    if (!result.success) return;
    const data = result.data as {
      players: Array<Record<string, unknown>>;
      limitations?: unknown;
    };

    // Current roster: team/status present (not historical), no
    // playerProTeamAvailable limitation.
    expect(data.players[0].team).toBe('BUF');
    expect(data.players[0].status).toBe('healthy');
    // Fixture's player_points still echoes coverage_type: 'week', so points
    // still surface on a current-roster request.
    expect(data.players[0].points).toBe(22.16);
  });

  it('a roster with no stats sub-resource on any player reports no points anywhere and flags playerPointsAvailable false', async () => {
    fetchMock.mockResolvedValue(jsonResponse(buildRosterPointsNoStatsFixture()));

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      team_id: '449.l.123.t.1',
      week: 5,
    };
    const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as {
      players: Array<Record<string, unknown>>;
      pointsCoverage?: unknown;
      limitations?: Record<string, boolean>;
    };

    expect(data.players).toHaveLength(1);
    expect(data.players[0]).not.toHaveProperty('points');
    expect(data.players[0].selectedPosition).toBe('BN');
    expect(data.pointsCoverage).toBeUndefined();
    expect(data.limitations?.playerPointsAvailable).toBe(false);
  });
});
