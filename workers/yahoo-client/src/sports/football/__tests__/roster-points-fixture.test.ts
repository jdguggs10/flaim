import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { footballHandlers } from '../handlers';
import type { ToolParams } from '../../../types';
import { getYahooCredentials } from '../../../shared/auth';
import { yahooFetch } from '../../../shared/yahoo-api';
import {
  buildRosterPointsCurrentMixedWeeksFixture,
  buildRosterPointsFixture,
  buildRosterPointsLegacyTopLevelCoverageFixture,
  buildRosterPointsMixedWeekMatchFixture,
  buildRosterPointsNoStatsFixture,
  buildRosterPointsReversedOrderFixture,
  buildRosterPointsSeasonCoverageFixture,
  buildRosterPointsWeekMismatchFixture,
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

  it('football week 1 fetches the exact stats-augmented URL, preserves a 0 total, omits points for a no-stats player, and stays historical-pure', async () => {
    fetchMock.mockResolvedValue(jsonResponse(buildRosterPointsFixture()));

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      team_id: '449.l.123.t.1',
      week: 1,
    };
    const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledPath = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledPath).toBe('/team/449.l.123.t.1/roster;week=1/players/stats');

    if (!result.success) return;
    const data = result.data as {
      players: Array<Record<string, unknown>>;
      pointsCoverage?: { type: string; week: number };
      limitations?: Record<string, boolean>;
    };

    expect(data.players).toHaveLength(3);
    expect(data.players[0].points).toBe(12.5);
    // Bye-week RB: total '0.00' must be preserved as 0, never omitted.
    expect(data.players[1].points).toBe(0);
    // Bench WR with no stats sub-resource: no `points` key at all.
    expect(data.players[2]).not.toHaveProperty('points');

    expect(data.pointsCoverage).toEqual({ type: 'week', week: 1 });

    // FLA-278 historical rule still holds on a week snapshot.
    expect(data.players[0]).not.toHaveProperty('team');
    expect(data.players[0]).not.toHaveProperty('status');
    expect(data.limitations?.playerProTeamAvailable).toBe(false);
    expect(data.limitations?.playerPointsAvailable).toBeUndefined();
  });

  it('current football snapshot fetches the ;week=current stats-augmented URL and still surfaces points when Yahoo echoes a week', async () => {
    fetchMock.mockResolvedValue(jsonResponse(buildRosterPointsFixture()));

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      team_id: '449.l.123.t.1',
    };
    const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledPath = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledPath).toBe('/team/449.l.123.t.1/roster;week=current/players/stats');

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
    expect(data.players[0].points).toBe(12.5);
  });

  it('reversed sub-resource order (stats/points before selected_position) yields identical output', async () => {
    fetchMock.mockResolvedValue(jsonResponse(buildRosterPointsReversedOrderFixture()));

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      team_id: '449.l.123.t.1',
      week: 1,
    };
    const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as {
      players: Array<Record<string, unknown>>;
      pointsCoverage?: { type: string; week: number };
    };

    expect(data.players[0]).toMatchObject({ points: 12.5, selectedPosition: 'QB' });
    expect(data.players[1]).toMatchObject({ points: 0, selectedPosition: 'RB' });
    expect(data.players[2]).not.toHaveProperty('points');
    expect(data.players[2].selectedPosition).toBe('BN');
    expect(data.pointsCoverage).toEqual({ type: 'week', week: 1 });
  });

  it('season-coverage player_points never surfaces points or pointsCoverage, and flags playerPointsAvailable false', async () => {
    fetchMock.mockResolvedValue(jsonResponse(buildRosterPointsSeasonCoverageFixture()));

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      team_id: '449.l.123.t.1',
      week: 1,
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

  it('legacy top-level coverage_type/week (not nested under "0") is still tolerated and gates normally', async () => {
    fetchMock.mockResolvedValue(jsonResponse(buildRosterPointsLegacyTopLevelCoverageFixture()));

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      team_id: '449.l.123.t.1',
      week: 1,
    };
    const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as {
      players: Array<Record<string, unknown>>;
      pointsCoverage?: { type: string; week: number };
    };

    expect(data.players[0].points).toBe(7.4);
    expect(data.pointsCoverage).toEqual({ type: 'week', week: 1 });
  });

  it('a roster with no stats sub-resource on any player reports no points anywhere and flags playerPointsAvailable false', async () => {
    fetchMock.mockResolvedValue(jsonResponse(buildRosterPointsNoStatsFixture()));

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      team_id: '449.l.123.t.1',
      week: 1,
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

  it('a week-1 request where Yahoo echoes a different week for the only player omits points and reports playerPointsAvailable false', async () => {
    fetchMock.mockResolvedValue(jsonResponse(buildRosterPointsWeekMismatchFixture()));

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      team_id: '449.l.123.t.1',
      week: 1,
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
  });

  it('a week-1 request with one matching-week player and one mismatched-week player only surfaces points for the match', async () => {
    fetchMock.mockResolvedValue(jsonResponse(buildRosterPointsMixedWeekMatchFixture()));

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      team_id: '449.l.123.t.1',
      week: 1,
    };
    const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as {
      players: Array<Record<string, unknown>>;
      pointsCoverage?: { type: string; week: number };
      limitations?: Record<string, boolean>;
    };

    expect(data.players).toHaveLength(2);
    expect(data.players[0].points).toBe(9.8);
    expect(data.players[1]).not.toHaveProperty('points');
    expect(data.pointsCoverage).toEqual({ type: 'week', week: 1 });
    expect(data.limitations?.playerPointsAvailable).toBeUndefined();
  });

  it('a current request with players echoing different weeks only surfaces points for the first usable week', async () => {
    fetchMock.mockResolvedValue(jsonResponse(buildRosterPointsCurrentMixedWeeksFixture()));

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      team_id: '449.l.123.t.1',
    };
    const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as {
      players: Array<Record<string, unknown>>;
      pointsCoverage?: { type: string; week: number };
      limitations?: Record<string, boolean>;
    };

    expect(data.players).toHaveLength(2);
    expect(data.players[0].points).toBe(14.6);
    expect(data.players[1]).not.toHaveProperty('points');
    expect(data.pointsCoverage).toEqual({ type: 'week', week: 3 });
    expect(data.limitations?.playerPointsAvailable).toBeUndefined();
  });

  it('fallback: a non-ok stats-augmented response retries the plain legacy URL and returns the roster without points', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'bad request' }, 400))
      .mockResolvedValueOnce(jsonResponse(buildRosterPointsNoStatsFixture()));

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      team_id: '449.l.123.t.1',
      week: 1,
    };
    const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/team/449.l.123.t.1/roster;week=1/players/stats');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/team/449.l.123.t.1/roster;week=1');

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
  });

  it('fallback: both the stats-augmented and the legacy retry fail, returning the existing error response shape', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: 'bad request' }, 400))
      .mockResolvedValueOnce(jsonResponse({ error: 'not found' }, 404));

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      team_id: '449.l.123.t.1',
      week: 1,
    };
    const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe('YAHOO_NOT_FOUND');
    expect(typeof result.error).toBe('string');
  });
});
