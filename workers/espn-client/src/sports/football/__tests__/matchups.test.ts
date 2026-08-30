import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { footballHandlers } from '../handlers';
import { withSeasonContext } from '../../../shared/season';
import { getCredentials } from '../../../shared/auth';
import { espnFetch } from '../../../shared/espn-api';
import { normalizeEspnFootballMatchupPlayerDetail } from '../matchup-player-detail';
import { buildFootballMatchupPlayerDetailFixture } from '../test-fixtures/matchup-player-detail-fixture';

vi.mock('../../../shared/auth', () => ({
  getCredentials: vi.fn(),
}));

vi.mock('../../../shared/espn-api', async () => {
  const actual = await vi.importActual('../../../shared/espn-api') as Record<string, unknown>;
  return {
    ...actual,
    espnFetch: vi.fn(),
  };
});

describe('football get_matchups handler', () => {
  const getCredentialsMock = getCredentials as MockedFunction<typeof getCredentials>;
  const espnFetchMock = espnFetch as MockedFunction<typeof espnFetch>;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns all matchups when scoringPeriodId is missing and no week specified', async () => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        // scoringPeriodId intentionally omitted
        schedule: [
          {
            matchupPeriodId: 1,
            home: { teamId: 1, totalPoints: 100 },
            away: { teamId: 2, totalPoints: 90 },
            winner: 'HOME',
          },
          {
            matchupPeriodId: 2,
            home: { teamId: 3, totalPoints: 80 },
            away: { teamId: 4, totalPoints: 70 },
            winner: 'HOME',
          },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const params = withSeasonContext({ sport: 'football', league_id: '123', season_year: 2025 });
    const result = await footballHandlers.get_matchups({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as { matchups: unknown[]; matchupPeriod: number | null };
    // Should return all matchups instead of filtering to empty
    expect(data.matchups).toHaveLength(2);
    expect(data.matchupPeriod).toBeNull();
  });

  it('filters to specified week when provided', async () => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        scoringPeriodId: 5,
        schedule: [
          { matchupPeriodId: 3, home: { teamId: 1, totalPoints: 100 }, away: { teamId: 2, totalPoints: 90 }, winner: 'HOME' },
          { matchupPeriodId: 4, home: { teamId: 3, totalPoints: 80 }, away: { teamId: 4, totalPoints: 70 }, winner: 'HOME' },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const params = withSeasonContext({ sport: 'football', league_id: '123', season_year: 2025, week: 3 });
    const result = await footballHandlers.get_matchups({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as { matchups: unknown[]; matchupPeriod: number };
    expect(data.matchups).toHaveLength(1);
    expect(data.matchupPeriod).toBe(3);
  });

  it('includes human-readable team names in matchup sides', async () => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify({
        scoringPeriodId: 1,
        teams: [
          { id: 1, location: 'The', nickname: 'Champs' },
          { id: 2, name: 'Commissioner Squad' },
        ],
        schedule: [
          {
            matchupPeriodId: 1,
            home: { teamId: 1, totalPoints: 100 },
            away: { teamId: 2, totalPoints: 90 },
            winner: 'HOME',
          },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const params = withSeasonContext({ sport: 'football', league_id: '123', season_year: 2025 });
    const result = await footballHandlers.get_matchups({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as {
      matchups: Array<{
        home: { teamId?: number; teamName?: string } | null;
        away: { teamId?: number; teamName?: string } | null;
      }>;
    };
    expect(data.matchups[0]?.home).toEqual(expect.objectContaining({
      teamId: 1,
      teamName: 'The Champs',
    }));
    expect(data.matchups[0]?.away).toEqual(expect.objectContaining({
      teamId: 2,
      teamName: 'Commissioner Squad',
    }));
  });

  it('uses the exact bounded mBoxscore detail request with historical league options and normalizes both sides', async () => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify([buildFootballMatchupPlayerDetailFixture()]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const params = withSeasonContext({
      sport: 'football',
      league_id: '123',
      season_year: 2023,
      week: 7,
      team_id: '11',
      detail: 'players',
    });
    const result = await footballHandlers.get_matchups({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    expect(espnFetchMock).toHaveBeenCalledWith(
      '/seasons/2023/segments/0/leagues/123?view=mBoxscore&scoringPeriodId=7',
      'ffl',
      expect.objectContaining({
        headers: {
          'X-Fantasy-Filter': JSON.stringify({
            schedule: { filterMatchupPeriodIds: { value: [7] } },
          }),
        },
        league: {
          leagueId: '123',
          espnSeasonYear: 2023,
          historical: true,
        },
      }),
    );
    if (!result.success) return;
    const data = result.data as {
      matchupPeriod: number;
      matchups: Array<{
        home: { totalPoints: number; totalProjectedPoints?: number; players: Array<Record<string, unknown>> } | null;
        away: { players: Array<Record<string, unknown>> } | null;
      }>;
    };
    expect(data.matchupPeriod).toBe(7);
    expect(data.matchups).toHaveLength(1);
    expect(data.matchups[0]?.home).toMatchObject({
      totalPoints: 0,
      totalProjectedPoints: 0,
      players: [
        { playerId: '101', name: 'Sample Starter', lineupSlot: 'QB', started: true, points: 0 },
        { playerId: '102', lineupSlot: 'Bench', started: false, points: -1.5 },
        { playerId: '103', name: null, lineupSlot: 'SLOT_7', started: null, points: null },
      ],
    });
    expect(data.matchups[0]?.away?.players).toEqual([
      { playerId: '201', name: 'Sample IR', lineupSlot: 'IR', started: false, points: 3 },
    ]);
  });

  it('selects the matchup when the requested team is away and still returns both sides', async () => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(buildFootballMatchupPlayerDetailFixture()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const params = withSeasonContext({
      sport: 'football', league_id: '123', season_year: 2023, week: 7, team_id: '22', detail: 'players',
    });
    const result = await footballHandlers.get_matchups({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as {
      matchups: Array<{ home: { teamId: number } | null; away: { teamId: number } | null }>;
    };
    expect(data.matchups).toEqual([
      expect.objectContaining({
        home: expect.objectContaining({ teamId: 11 }),
        away: expect.objectContaining({ teamId: 22 }),
      }),
    ]);
  });

  it('keeps a null-away bye in the selected player-detail matchup', async () => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    const fixture = JSON.parse(JSON.stringify(buildFootballMatchupPlayerDetailFixture())) as {
      schedule: Array<{ away: unknown }>;
    };
    fixture.schedule[0]!.away = null;
    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(fixture), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const params = withSeasonContext({
      sport: 'football', league_id: '123', season_year: 2023, week: 7, team_id: '11', detail: 'players',
    });
    const result = await footballHandlers.get_matchups({} as never, params, 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as { matchups: Array<{ away: unknown }> };
    expect(data.matchups[0]?.away).toBeNull();
  });

  it('preserves non-OK ESPN provider errors on the detail path', async () => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    espnFetchMock.mockResolvedValue(new Response(null, { status: 403 }));

    const params = withSeasonContext({
      sport: 'football', league_id: '123', season_year: 2023, week: 7, team_id: '11', detail: 'players',
    });
    const result = await footballHandlers.get_matchups({} as never, params, 'Bearer x', 'cid');

    expect(result).toMatchObject({ success: false, code: 'ESPN_ACCESS_DENIED' });
  });

  it('returns a corrective unavailable response when mBoxscore omits current-scoring-period roster rows', async () => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    const fixture = buildFootballMatchupPlayerDetailFixture();
    Reflect.deleteProperty(fixture.schedule[0]!.home, 'rosterForCurrentScoringPeriod');
    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(fixture), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const params = withSeasonContext({
      sport: 'football', league_id: '123', season_year: 2023, week: 7, team_id: '11', detail: 'players',
    });
    const result = await footballHandlers.get_matchups({} as never, params, 'Bearer x', 'cid');

    expect(result).toMatchObject({ success: false, code: 'MATCHUP_PLAYER_DETAIL_UNAVAILABLE' });
  });

  it('returns a corrective team-not-found response for an absent selected team', async () => {
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
    espnFetchMock.mockResolvedValue(
      new Response(JSON.stringify(buildFootballMatchupPlayerDetailFixture()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const params = withSeasonContext({
      sport: 'football', league_id: '123', season_year: 2023, week: 7, team_id: '999', detail: 'players',
    });
    const result = await footballHandlers.get_matchups({} as never, params, 'Bearer x', 'cid');

    expect(result).toMatchObject({ success: false, code: 'MATCHUP_TEAM_NOT_FOUND' });
  });

  it('fails closed on malformed player score scalars, including non-finite values', () => {
    const fixture = buildFootballMatchupPlayerDetailFixture();
    const homeEntry = fixture.schedule[0]?.home?.rosterForCurrentScoringPeriod?.entries[0];
    if (!homeEntry?.playerPoolEntry) throw new Error('fixture setup failed');
    homeEntry.playerPoolEntry.appliedStatTotal = Number.POSITIVE_INFINITY;

    expect(() => normalizeEspnFootballMatchupPlayerDetail(fixture, 7, '11')).toThrow(
      'MATCHUP_DETAIL_MALFORMED',
    );
  });

  it('rejects pre-2018 detail before requesting credentials', async () => {
    const params = withSeasonContext({
      sport: 'football', league_id: '123', season_year: 2017, week: 7, team_id: '11', detail: 'players',
    });
    const result = await footballHandlers.get_matchups({} as never, params, 'Bearer x', 'cid');

    expect(result).toMatchObject({ success: false, code: 'MATCHUP_DETAIL_UNSUPPORTED' });
    expect(getCredentialsMock).not.toHaveBeenCalled();
    expect(espnFetchMock).not.toHaveBeenCalled();
  });
});
