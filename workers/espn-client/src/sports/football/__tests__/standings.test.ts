import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { footballHandlers } from '../handlers';
import type { ToolParams } from '../../../types';
import { getCredentials } from '../../../shared/auth';
import { espnFetch } from '../../../shared/espn-api';

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
const CURRENT_YEAR = new Date().getFullYear();

function makeParams(season_year: number): ToolParams {
  return { sport: 'football', league_id: '123', season_year };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('football get_standings handler — outcome fields', () => {
  const getCredentialsMock = getCredentials as MockedFunction<typeof getCredentials>;
  const espnFetchMock = espnFetch as MockedFunction<typeof espnFetch>;

  beforeEach(() => {
    vi.resetAllMocks();
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
  });

  it('returns season_complete and champion outcome for historical season with rankFinal', async () => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      scoringPeriodId: 18,
      settings: { regularSeasonMatchupPeriods: 14 },
      teams: [
        {
          id: 1,
          location: 'Alpha', nickname: 'Team',
          rankFinal: 1,
          playoffSeed: 1,
          record: { overall: { wins: 10, losses: 3, ties: 0, pointsFor: 1500, pointsAgainst: 1200 } },
        },
        {
          id: 2,
          location: 'Beta', nickname: 'Team',
          rankFinal: 2,
          playoffSeed: 2,
          record: { overall: { wins: 9, losses: 4, ties: 0, pointsFor: 1400, pointsAgainst: 1300 } },
        },
        {
          id: 3,
          location: 'Gamma', nickname: 'Team',
          rankFinal: 5,
          record: { overall: { wins: 6, losses: 7, ties: 0, pointsFor: 1200, pointsAgainst: 1350 } },
        },
      ],
    }));

    const result = await footballHandlers.get_standings({} as never, makeParams(HISTORICAL_YEAR), 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.seasonPhase).toBe('season_complete');
    expect(data.seasonComplete).toBe(true);

    const standings = data.standings as Array<Record<string, unknown>>;
    const champion = standings.find((s) => s.teamId === 1);
    expect(champion?.finalRank).toBe(1);
    expect(champion?.championshipWon).toBe(true);
    expect(champion?.playoffOutcome).toBe('champion');
    expect(champion?.outcomeConfidence).toBe('explicit');
    expect(champion?.madePlayoffs).toBe(true);

    const runnerUp = standings.find((s) => s.teamId === 2);
    expect(runnerUp?.finalRank).toBe(2);
    expect(runnerUp?.championshipWon).toBe(false);
    expect(runnerUp?.playoffOutcome).toBe('runner_up');
    expect(runnerUp?.outcomeConfidence).toBe('explicit');

    // Team 3 has rankFinal=5 but no playoffSeed — they missed playoffs
    const nonPlayoff = standings.find((s) => s.teamId === 3);
    expect(nonPlayoff?.finalRank).toBe(5);
    expect(nonPlayoff?.championshipWon).toBe(false);
    expect(nonPlayoff?.playoffOutcome).toBe('missed_playoffs');
    expect(nonPlayoff?.madePlayoffs).toBe(false); // season complete + explicit rank + no playoffSeed
  });

  it('returns season_complete but all outcome fields null when no rankFinal present', async () => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      scoringPeriodId: 18,
      settings: { regularSeasonMatchupPeriods: 14 },
      teams: [
        {
          id: 1,
          location: 'Alpha', nickname: 'Team',
          // no rankFinal or rankCalculatedFinal
          record: { overall: { wins: 10, losses: 3, ties: 0, pointsFor: 1500, pointsAgainst: 1200 } },
        },
      ],
    }));

    const result = await footballHandlers.get_standings({} as never, makeParams(HISTORICAL_YEAR), 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.seasonPhase).toBe('season_complete');

    const standings = data.standings as Array<Record<string, unknown>>;
    expect(standings[0].finalRank).toBeNull();
    expect(standings[0].championshipWon).toBeNull();
    expect(standings[0].playoffOutcome).toBeNull();
    expect(standings[0].outcomeConfidence).toBeNull();
  });

  it('returns playoffs_in_progress for current season past regular season periods', async () => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      scoringPeriodId: 16,
      settings: { regularSeasonMatchupPeriods: 14 },
      teams: [
        {
          id: 1,
          location: 'Alpha', nickname: 'Team',
          playoffSeed: 1,
          record: { overall: { wins: 10, losses: 4, ties: 0, pointsFor: 1400, pointsAgainst: 1200 } },
        },
      ],
    }));

    const result = await footballHandlers.get_standings({} as never, makeParams(CURRENT_YEAR), 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.seasonPhase).toBe('playoffs_in_progress');
    expect(data.seasonComplete).toBe(false);

    const standings = data.standings as Array<Record<string, unknown>>;
    expect(standings[0].finalRank).toBeNull();
    expect(standings[0].championshipWon).toBeNull();
    expect(standings[0].playoffOutcome).toBeNull();
    expect(standings[0].rank).toBe(1);
  });

  it('returns regular_season for current season within regular season periods', async () => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      scoringPeriodId: 10,
      settings: { regularSeasonMatchupPeriods: 14 },
      teams: [
        {
          id: 1,
          location: 'Alpha', nickname: 'Team',
          record: { overall: { wins: 7, losses: 3, ties: 0, pointsFor: 1000, pointsAgainst: 900 } },
        },
      ],
    }));

    const result = await footballHandlers.get_standings({} as never, makeParams(CURRENT_YEAR), 'Bearer x', 'cid');

    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.seasonPhase).toBe('regular_season');
    expect(data.seasonComplete).toBe(false);

    const standings = data.standings as Array<Record<string, unknown>>;
    // existing rank field unaffected
    expect(standings[0].rank).toBe(1);
    expect(standings[0].finalRank).toBeNull();
  });

  it('uses rankCalculatedFinal when rankFinal is absent', async () => {
    espnFetchMock.mockResolvedValue(jsonResponse({
      scoringPeriodId: 18,
      settings: { regularSeasonMatchupPeriods: 14 },
      teams: [
        {
          id: 1,
          location: 'Alpha', nickname: 'Team',
          rankCalculatedFinal: 1,
          record: { overall: { wins: 10, losses: 3, ties: 0, pointsFor: 1500, pointsAgainst: 1200 } },
        },
      ],
    }));

    const result = await footballHandlers.get_standings({} as never, makeParams(HISTORICAL_YEAR), 'Bearer x', 'cid');

    const data = result.data as Record<string, unknown>;
    const standings = data.standings as Array<Record<string, unknown>>;
    expect(standings[0].finalRank).toBe(1);
    expect(standings[0].championshipWon).toBe(true);
    expect(standings[0].outcomeConfidence).toBe('explicit');
  });
});
