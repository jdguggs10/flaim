import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import {
  cacheKeyForSport,
  clearSleeperPlayersInMemoryCacheForTesting,
  getSleeperPlayersIndex,
} from '../sleeper-players-cache';
import type { Env } from '../../types';

const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('sleeper-players-cache', () => {
  const kvGet = vi.fn();
  const kvPut = vi.fn();
  const env = {
    SLEEPER_PLAYERS_CACHE: {
      get: kvGet,
      put: kvPut,
    },
  } as unknown as Env;

  beforeEach(() => {
    mockFetch.mockReset();
    kvGet.mockReset();
    kvPut.mockReset();
    clearSleeperPlayersInMemoryCacheForTesting();
  });

  it('returns cache hit without upstream fetch', async () => {
    kvGet.mockResolvedValueOnce(JSON.stringify([
      { player_id: '1', full_name: 'Cached Player', position: 'QB', team: 'BUF', active: true },
    ]));

    const index = await getSleeperPlayersIndex(env, 'football');

    expect(index.get('1')?.full_name).toBe('Cached Player');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(kvPut).not.toHaveBeenCalled();
  });

  it('fetches and caches nfl players on cache miss', async () => {
    kvGet.mockResolvedValueOnce(null);
    mockFetch.mockResolvedValueOnce(jsonResponse({
      '11': { player_id: '11', full_name: 'Alpha A', position: 'RB', team: 'NYJ', active: true },
      '12': { player_id: '12', full_name: 'Inactive B', position: 'WR', team: 'SF', active: false },
    }));

    const index = await getSleeperPlayersIndex(env, 'football');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[0]).toBe('https://api.sleeper.app/v1/players/nfl');
    expect(index.has('11')).toBe(true);
    expect(index.has('12')).toBe(false);
    expect(kvPut).toHaveBeenCalledTimes(1);
    const [key, value, options] = kvPut.mock.calls[0] as [string, string, { expirationTtl: number }];
    expect(key).toBe(cacheKeyForSport('football'));
    expect(options).toEqual({ expirationTtl: 86400 });
    expect(JSON.parse(value)).toEqual([
      { player_id: '11', full_name: 'Alpha A', position: 'RB', team: 'NYJ', active: true },
    ]);
  });

  it('falls back to refetch when cache JSON is invalid', async () => {
    kvGet.mockResolvedValueOnce('{bad-json');
    mockFetch.mockResolvedValueOnce(jsonResponse({
      '21': { player_id: '21', full_name: 'Refetch C', position: 'PG', team: 'BOS', active: true },
    }));

    const index = await getSleeperPlayersIndex(env, 'basketball');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[0]).toBe('https://api.sleeper.app/v1/players/nba');
    expect(index.get('21')?.full_name).toBe('Refetch C');
    expect(kvPut).toHaveBeenCalledTimes(1);
  });

  it('retains only active players from cached array payloads', async () => {
    kvGet.mockResolvedValueOnce(JSON.stringify([
      { player_id: '31', full_name: 'Active D', active: true },
      { player_id: '32', full_name: 'Inactive E', active: false },
      { player_id: '33', full_name: 'Missing Active Flag' },
    ]));

    const index = await getSleeperPlayersIndex(env, 'football');

    expect(index.has('31')).toBe(true);
    expect(index.has('32')).toBe(false);
    expect(index.has('33')).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('warms in-memory cache from KV hit to avoid repeat KV reads', async () => {
    kvGet.mockResolvedValueOnce(JSON.stringify([
      { player_id: '41', full_name: 'KV Warmed Player', position: 'TE', team: 'DET', active: true },
    ]));

    const first = await getSleeperPlayersIndex(env, 'football');
    const second = await getSleeperPlayersIndex(env, 'football');

    expect(first.get('41')?.full_name).toBe('KV Warmed Player');
    expect(second.get('41')?.full_name).toBe('KV Warmed Player');
    expect(kvGet).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
