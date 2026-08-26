import { describe, expect, it, vi } from 'vitest';

import {
  buildEspnLeaguePath,
  fetchEspnLeagueSeason,
  unwrapEspnLeaguePayload,
} from '../espn-league';

describe('ESPN league-season compatibility', () => {
  it('builds modern and history paths with the same query', () => {
    const request = {
      espnSeasonYear: 2017,
      leagueId: '12/34',
      query: '?view=mStandings&view=mTeam',
    };

    expect(buildEspnLeaguePath(request, 'modern')).toBe(
      '/seasons/2017/segments/0/leagues/12%2F34?view=mStandings&view=mTeam',
    );
    expect(buildEspnLeaguePath(request, 'history')).toBe(
      '/leagueHistory/12%2F34?seasonId=2017&view=mStandings&view=mTeam',
    );
  });

  it('uses leagueHistory directly before 2018', async () => {
    const fetchPath = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));

    await fetchEspnLeagueSeason({
      espnSeasonYear: 2017,
      leagueId: '123',
      query: 'view=mSettings',
      historical: true,
    }, fetchPath);

    expect(fetchPath).toHaveBeenCalledOnce();
    expect(fetchPath).toHaveBeenCalledWith(
      '/leagueHistory/123?seasonId=2017&view=mSettings',
    );
  });

  it('keeps a successful modern historical response', async () => {
    const response = new Response('{}', { status: 200 });
    const fetchPath = vi.fn().mockResolvedValue(response);

    const result = await fetchEspnLeagueSeason({
      espnSeasonYear: 2024,
      leagueId: '123',
      query: 'view=mSettings',
      historical: true,
    }, fetchPath);

    expect(result).toBe(response);
    expect(fetchPath).toHaveBeenCalledOnce();
    expect(fetchPath).toHaveBeenCalledWith(
      '/seasons/2024/segments/0/leagues/123?view=mSettings',
    );
  });

  it('keeps ESPN-native season 2018 on the modern route boundary', async () => {
    const fetchPath = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));

    await fetchEspnLeagueSeason({
      espnSeasonYear: 2018,
      leagueId: '123',
      historical: true,
    }, fetchPath);

    expect(fetchPath).toHaveBeenCalledOnce();
    expect(fetchPath).toHaveBeenCalledWith(
      '/seasons/2018/segments/0/leagues/123',
    );
  });

  it('retries a modern historical 401 through leagueHistory', async () => {
    const historyResponse = new Response('[{"id":123}]', { status: 200 });
    const fetchPath = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(historyResponse);

    const result = await fetchEspnLeagueSeason({
      espnSeasonYear: 2023,
      leagueId: '123',
      query: 'view=mSettings&view=mTeam',
      historical: true,
    }, fetchPath);

    expect(result).toBe(historyResponse);
    expect(fetchPath.mock.calls).toEqual([
      ['/seasons/2023/segments/0/leagues/123?view=mSettings&view=mTeam'],
      ['/leagueHistory/123?seasonId=2023&view=mSettings&view=mTeam'],
    ]);
  });

  it('does not retry a current-season 401', async () => {
    const response = new Response(null, { status: 401 });
    const fetchPath = vi.fn().mockResolvedValue(response);

    const result = await fetchEspnLeagueSeason({
      espnSeasonYear: 2026,
      leagueId: '123',
      historical: false,
    }, fetchPath);

    expect(result).toBe(response);
    expect(fetchPath).toHaveBeenCalledOnce();
  });

  it('returns the final failure when both historical routes fail', async () => {
    const historyFailure = new Response(null, { status: 403 });
    const fetchPath = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(historyFailure);

    const result = await fetchEspnLeagueSeason({
      espnSeasonYear: 2023,
      leagueId: '123',
      historical: true,
    }, fetchPath);

    expect(result).toBe(historyFailure);
    expect(fetchPath).toHaveBeenCalledTimes(2);
  });

  it('unwraps the history array without changing modern payloads', () => {
    const league = { id: 123 };

    expect(unwrapEspnLeaguePayload([league])).toBe(league);
    expect(unwrapEspnLeaguePayload([])).toBeNull();
    expect(unwrapEspnLeaguePayload(league)).toBe(league);
  });
});
