import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { basketballHandlers } from '../handlers';
import type { RoutedToolParams } from '../../../types';
import { getCredentials } from '../../../shared/auth';
import { espnFetch } from '../../../shared/espn-api';
import { getCurrentSeasonYear, withSeasonContext } from '../../../shared/season';

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

const CURRENT_CANONICAL_YEAR = getCurrentSeasonYear('basketball');
const HISTORICAL_CANONICAL_YEAR = 2022;
const CURRENT_ESPN_YEAR = withSeasonContext({
  sport: 'basketball',
  league_id: '123',
  season_year: CURRENT_CANONICAL_YEAR,
}).seasonContext.espnYear;
const HISTORICAL_ESPN_YEAR = withSeasonContext({
  sport: 'basketball',
  league_id: '123',
  season_year: HISTORICAL_CANONICAL_YEAR,
}).seasonContext.espnYear;

function makeParams(season_year: number): RoutedToolParams {
  return withSeasonContext({ sport: 'basketball', league_id: '123', season_year });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('basketball get_standings handler — seasonPhase and canonical year', () => {
  const getCredentialsMock = getCredentials as MockedFunction<typeof getCredentials>;
  const espnFetchMock = espnFetch as MockedFunction<typeof espnFetch>;

  beforeEach(() => {
    vi.resetAllMocks();
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
  });

  it('returns season_complete and champion outcome for historical season with rankFinal', async () => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      scoringPeriodId: 25,
      settings: { regularSeasonMatchupPeriods: 20 },
      teams: [
        {
          id: 1,
          location: 'Alpha', nickname: 'Ballers',
          rankFinal: 1,
          playoffSeed: 1,
          record: { overall: { wins: 15, losses: 5, ties: 0, pointsFor: 1800, pointsAgainst: 1500 } },
        },
        {
          id: 2,
          location: 'Beta', nickname: 'Hoopers',
          rankFinal: 2,
          playoffSeed: 2,
          record: { overall: { wins: 13, losses: 7, ties: 0, pointsFor: 1700, pointsAgainst: 1600 } },
        },
        {
          id: 3,
          location: 'Gamma', nickname: 'Dribblers',
          rankFinal: 5,
          record: { overall: { wins: 10, losses: 10, ties: 0, pointsFor: 1500, pointsAgainst: 1550 } },
        },
      ],
    }));

    const result = await basketballHandlers.get_standings({} as never, makeParams(HISTORICAL_CANONICAL_YEAR), 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    expect(espnFetchMock.mock.calls[0]?.[0]).toContain(`/seasons/${HISTORICAL_ESPN_YEAR}/segments/0/leagues/123`);
    const data = result.data as Record<string, unknown>;
    expect(data.seasonPhase).toBe('season_complete');
    expect(data.seasonComplete).toBe(true);
    // Response must echo canonical year, not ESPN year
    expect(data.seasonYear).toBe(HISTORICAL_CANONICAL_YEAR);

    const standings = data.standings as Array<Record<string, unknown>>;
    const champion = standings.find((s) => s.teamId === 1);
    expect(champion?.finalRank).toBe(1);
    expect(champion?.championshipWon).toBe(true);
    expect(champion?.playoffOutcome).toBe('champion');
    expect(champion?.madePlayoffs).toBe(true);

    const nonPlayoff = standings.find((s) => s.teamId === 3);
    expect(nonPlayoff?.finalRank).toBe(5);
    expect(nonPlayoff?.playoffOutcome).toBe('missed_playoffs');
    expect(nonPlayoff?.madePlayoffs).toBe(false);
  });

  it('returns season_complete for historical year even without rankFinal', async () => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      scoringPeriodId: 25,
      settings: { regularSeasonMatchupPeriods: 20 },
      teams: [
        {
          id: 1,
          location: 'Alpha', nickname: 'Ballers',
          record: { overall: { wins: 15, losses: 5, ties: 0, pointsFor: 1800, pointsAgainst: 1500 } },
        },
      ],
    }));

    const result = await basketballHandlers.get_standings({} as never, makeParams(HISTORICAL_CANONICAL_YEAR), 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.seasonPhase).toBe('season_complete');
    expect(data.seasonYear).toBe(HISTORICAL_CANONICAL_YEAR);
    const standings = data.standings as Array<Record<string, unknown>>;
    expect(standings[0].finalRank).toBeNull();
    expect(standings[0].championshipWon).toBeNull();
    expect(standings[0].playoffOutcome).toBeNull();
    expect(standings[0].madePlayoffs).toBeNull();
    expect(standings[0].outcomeConfidence).toBeNull();
  });

  it('returns playoffs_in_progress for current season past regular season periods', async () => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      scoringPeriodId: 22,
      settings: { regularSeasonMatchupPeriods: 20 },
      teams: [
        {
          id: 1,
          location: 'Alpha', nickname: 'Ballers',
          playoffSeed: 1,
          record: { overall: { wins: 15, losses: 5, ties: 0, pointsFor: 1800, pointsAgainst: 1500 } },
        },
      ],
    }));

    const result = await basketballHandlers.get_standings({} as never, makeParams(CURRENT_CANONICAL_YEAR), 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    expect(espnFetchMock.mock.calls[0]?.[0]).toContain(`/seasons/${CURRENT_ESPN_YEAR}/segments/0/leagues/123`);
    const data = result.data as Record<string, unknown>;
    expect(data.seasonPhase).toBe('playoffs_in_progress');
    expect(data.seasonComplete).toBe(false);
    // Response must echo canonical year, not ESPN year
    expect(data.seasonYear).toBe(CURRENT_CANONICAL_YEAR);
    const standings = data.standings as Array<Record<string, unknown>>;
    expect(standings[0].finalRank).toBeNull();
    expect(standings[0].championshipWon).toBeNull();
    expect(standings[0].playoffOutcome).toBeNull();
    expect(standings[0].madePlayoffs).toBe(true);
    expect(standings[0].outcomeConfidence).toBeNull();
  });

  it('returns regular_season for current season within regular season periods', async () => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      scoringPeriodId: 10,
      settings: { regularSeasonMatchupPeriods: 20 },
      teams: [
        {
          id: 1,
          location: 'Alpha', nickname: 'Ballers',
          record: { overall: { wins: 7, losses: 3, ties: 0, pointsFor: 900, pointsAgainst: 800 } },
        },
      ],
    }));

    const result = await basketballHandlers.get_standings({} as never, makeParams(CURRENT_CANONICAL_YEAR), 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.seasonPhase).toBe('regular_season');
    expect(data.seasonComplete).toBe(false);
    expect(data.seasonYear).toBe(CURRENT_CANONICAL_YEAR);
    const standings = data.standings as Array<Record<string, unknown>>;
    expect(standings[0].finalRank).toBeNull();
    expect(standings[0].championshipWon).toBeNull();
    expect(standings[0].playoffOutcome).toBeNull();
    expect(standings[0].madePlayoffs).toBeNull();
    expect(standings[0].outcomeConfidence).toBeNull();
  });

  it('uses rankCalculatedFinal when rankFinal is absent', async () => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      scoringPeriodId: 25,
      settings: { regularSeasonMatchupPeriods: 20 },
      teams: [
        {
          id: 1,
          location: 'Alpha', nickname: 'Ballers',
          rankCalculatedFinal: 1,
          record: { overall: { wins: 15, losses: 5, ties: 0, pointsFor: 1800, pointsAgainst: 1500 } },
        },
      ],
    }));

    const result = await basketballHandlers.get_standings({} as never, makeParams(HISTORICAL_CANONICAL_YEAR), 'Bearer x', 'cid');

    const data = result.data as Record<string, unknown>;
    const standings = data.standings as Array<Record<string, unknown>>;
    expect(standings[0].finalRank).toBe(1);
    expect(standings[0].championshipWon).toBe(true);
    expect(standings[0].outcomeConfidence).toBe('explicit');
  });
});
