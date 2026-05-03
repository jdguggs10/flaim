import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { baseballHandlers } from '../handlers';
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

const HISTORICAL_YEAR = 2022;
const CURRENT_SEASON_YEAR = getCurrentSeasonYear('baseball');

function makeParams(season_year: number): RoutedToolParams {
  return withSeasonContext({ sport: 'baseball', league_id: '789', season_year });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('baseball get_standings handler — outcome fields', () => {
  const getCredentialsMock = getCredentials as MockedFunction<typeof getCredentials>;
  const espnFetchMock = espnFetch as MockedFunction<typeof espnFetch>;

  beforeEach(() => {
    vi.resetAllMocks();
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
  });

  it('returns explicit completed-season outcomes for champion, runner-up, eliminated, and missed-playoffs teams', async () => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      scoringPeriodId: 22,
      settings: { regularSeasonMatchupPeriods: 18 },
      teams: [
        {
          id: 1,
          location: 'Alpha', nickname: 'Aces',
          rankFinal: 1,
          playoffSeed: 1,
          record: { overall: { wins: 14, losses: 4, ties: 0, pointsFor: 1200, pointsAgainst: 980 } },
        },
        {
          id: 2,
          location: 'Beta', nickname: 'Bats',
          rankFinal: 2,
          playoffSeed: 2,
          record: { overall: { wins: 13, losses: 5, ties: 0, pointsFor: 1175, pointsAgainst: 1000 } },
        },
        {
          id: 3,
          location: 'Gamma', nickname: 'Gloves',
          rankFinal: 4,
          playoffSeed: 4,
          record: { overall: { wins: 11, losses: 7, ties: 0, pointsFor: 1110, pointsAgainst: 1040 } },
        },
        {
          id: 4,
          location: 'Delta', nickname: 'Dugout',
          rankFinal: 7,
          record: { overall: { wins: 7, losses: 11, ties: 0, pointsFor: 980, pointsAgainst: 1130 } },
        },
      ],
    }));

    const result = await baseballHandlers.get_standings({} as never, makeParams(HISTORICAL_YEAR), 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.seasonPhase).toBe('season_complete');
    expect(data.seasonComplete).toBe(true);
    expect(data.seasonYear).toBe(HISTORICAL_YEAR);

    const standings = data.standings as Array<Record<string, unknown>>;

    const champion = standings.find((team) => team.teamId === 1);
    expect(champion?.finalRank).toBe(1);
    expect(champion?.championshipWon).toBe(true);
    expect(champion?.playoffOutcome).toBe('champion');
    expect(champion?.outcomeConfidence).toBe('explicit');
    expect(champion?.madePlayoffs).toBe(true);

    const runnerUp = standings.find((team) => team.teamId === 2);
    expect(runnerUp?.finalRank).toBe(2);
    expect(runnerUp?.championshipWon).toBe(false);
    expect(runnerUp?.playoffOutcome).toBe('runner_up');
    expect(runnerUp?.outcomeConfidence).toBe('explicit');
    expect(runnerUp?.madePlayoffs).toBe(true);

    const eliminated = standings.find((team) => team.teamId === 3);
    expect(eliminated?.finalRank).toBe(4);
    expect(eliminated?.championshipWon).toBe(false);
    expect(eliminated?.playoffOutcome).toBe('eliminated');
    expect(eliminated?.outcomeConfidence).toBe('explicit');
    expect(eliminated?.madePlayoffs).toBe(true);

    const nonPlayoff = standings.find((team) => team.teamId === 4);
    expect(nonPlayoff?.finalRank).toBe(7);
    expect(nonPlayoff?.championshipWon).toBe(false);
    expect(nonPlayoff?.playoffOutcome).toBe('missed_playoffs');
    expect(nonPlayoff?.outcomeConfidence).toBe('explicit');
    expect(nonPlayoff?.madePlayoffs).toBe(false);
  });

  it('returns season_complete but null outcome fields when a historical season has no explicit final rank', async () => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      scoringPeriodId: 22,
      settings: { regularSeasonMatchupPeriods: 18 },
      teams: [
        {
          id: 1,
          location: 'Alpha', nickname: 'Aces',
          record: { overall: { wins: 14, losses: 4, ties: 0, pointsFor: 1200, pointsAgainst: 980 } },
        },
      ],
    }));

    const result = await baseballHandlers.get_standings({} as never, makeParams(HISTORICAL_YEAR), 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.seasonPhase).toBe('season_complete');
    expect(data.seasonComplete).toBe(true);

    const standings = data.standings as Array<Record<string, unknown>>;
    expect(standings[0].finalRank).toBeNull();
    expect(standings[0].championshipWon).toBeNull();
    expect(standings[0].playoffOutcome).toBeNull();
    expect(standings[0].outcomeConfidence).toBeNull();
    expect(standings[0].madePlayoffs).toBeNull();
  });

  it('returns playoffs_in_progress with null outcome fields for the current season after regular-season periods', async () => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      scoringPeriodId: 20,
      settings: { regularSeasonMatchupPeriods: 18 },
      teams: [
        {
          id: 1,
          location: 'Alpha', nickname: 'Aces',
          record: { overall: { wins: 14, losses: 4, ties: 0, pointsFor: 1200, pointsAgainst: 980 } },
        },
      ],
    }));

    const result = await baseballHandlers.get_standings({} as never, makeParams(CURRENT_SEASON_YEAR), 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.seasonPhase).toBe('playoffs_in_progress');
    expect(data.seasonComplete).toBe(false);

    const standings = data.standings as Array<Record<string, unknown>>;
    expect(standings[0].finalRank).toBeNull();
    expect(standings[0].championshipWon).toBeNull();
    expect(standings[0].playoffOutcome).toBeNull();
    expect(standings[0].outcomeConfidence).toBeNull();
    expect(standings[0].madePlayoffs).toBeNull();
  });

  it('returns regular_season with null outcome fields during current regular season', async () => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      scoringPeriodId: 10,
      currentMatchupPeriod: 10,
      settings: { regularSeasonMatchupPeriods: 18 },
      teams: [
        {
          id: 1,
          location: 'Alpha', nickname: 'Aces',
          record: { overall: { wins: 8, losses: 2, ties: 0, pointsFor: 780, pointsAgainst: 640 } },
        },
      ],
    }));

    const result = await baseballHandlers.get_standings({} as never, makeParams(CURRENT_SEASON_YEAR), 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.seasonPhase).toBe('regular_season');
    expect(data.seasonComplete).toBe(false);

    const standings = data.standings as Array<Record<string, unknown>>;
    expect(standings[0].rank).toBe(1);
    expect(standings[0].finalRank).toBeNull();
    expect(standings[0].championshipWon).toBeNull();
    expect(standings[0].playoffOutcome).toBeNull();
    expect(standings[0].outcomeConfidence).toBeNull();
    expect(standings[0].madePlayoffs).toBeNull();
  });

  it('uses currentMatchupPeriod instead of daily scoringPeriodId for active baseball standings', async () => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      scoringPeriodId: 130,
      status: { currentMatchupPeriod: 10 },
      settings: { regularSeasonMatchupPeriods: 18 },
      teams: [
        {
          id: 1,
          location: 'Alpha', nickname: 'Aces',
          rankCalculatedFinal: 1,
          record: { overall: { wins: 8, losses: 2, ties: 0, pointsFor: 780, pointsAgainst: 640 } },
        },
      ],
    }));

    const result = await baseballHandlers.get_standings({} as never, makeParams(CURRENT_SEASON_YEAR), 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.seasonPhase).toBe('regular_season');
    expect(data.seasonComplete).toBe(false);

    const standings = data.standings as Array<Record<string, unknown>>;
    expect(standings[0].finalRank).toBeNull();
    expect(standings[0].championshipWon).toBeNull();
    expect(standings[0].playoffOutcome).toBeNull();
    expect(standings[0].outcomeConfidence).toBeNull();
    expect(standings[0].madePlayoffs).toBeNull();
  });

  it('uses rankCalculatedFinal when rankFinal is absent', async () => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      scoringPeriodId: 22,
      settings: { regularSeasonMatchupPeriods: 18 },
      teams: [
        {
          id: 1,
          location: 'Alpha', nickname: 'Aces',
          rankCalculatedFinal: 1,
          record: { overall: { wins: 14, losses: 4, ties: 0, pointsFor: 1200, pointsAgainst: 980 } },
        },
      ],
    }));

    const result = await baseballHandlers.get_standings({} as never, makeParams(HISTORICAL_YEAR), 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    const standings = data.standings as Array<Record<string, unknown>>;
    expect(standings[0].finalRank).toBe(1);
    expect(standings[0].championshipWon).toBe(true);
    expect(standings[0].playoffOutcome).toBe('champion');
    expect(standings[0].outcomeConfidence).toBe('explicit');
  });
});
