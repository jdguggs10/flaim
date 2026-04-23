import { afterEach, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

import { getLeagueInfo } from '../v3/get-league-info';

const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch;

describe('getLeagueInfo', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the sport default season translated to ESPN-native year when no season is provided', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T12:00:00Z'));

    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: '123',
          name: 'Dynasty League',
          seasonId: 2027,
          scoringPeriodId: 1,
          firstScoringPeriod: 1,
          finalScoringPeriod: 22,
          status: {
            currentMatchupPeriod: 1,
            isActive: true,
            previousSeasons: [2026],
            statusType: { type: 'ACTIVE' },
          },
          settings: {
            name: 'Dynasty League',
            size: 12,
          },
          gameId: 2,
          gameName: 'Fantasy Basketball',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    await getLeagueInfo('{swid}', 's2token', '123', undefined, 'fba');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/2027/segments/0/leagues/123?view=mSettings',
      expect.objectContaining({
        method: 'GET',
      })
    );
  });

  it('normalizes ESPN-native season fields to canonical years for cross-calendar sports', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: '123',
          name: 'Dynasty League',
          seasonId: 2027,
          scoringPeriodId: 3,
          firstScoringPeriod: 1,
          finalScoringPeriod: 22,
          status: {
            currentMatchupPeriod: 7,
            isActive: true,
            previousSeasons: [2026, 2025],
            statusType: { type: 'ACTIVE' },
          },
          settings: {
            name: 'Dynasty League',
            size: 12,
          },
          gameId: 2,
          gameName: 'Fantasy Basketball',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const leagueInfo = await getLeagueInfo('{swid}', 's2token', '123', 2027, 'fba');

    expect(leagueInfo.seasonYear).toBe(2026);
    expect(leagueInfo.settings?.season).toBe(2026);
    expect(leagueInfo.status?.previousSeasons).toEqual([2025, 2024]);
  });
});
