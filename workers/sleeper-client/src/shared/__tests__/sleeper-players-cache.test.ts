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
    expect(index.has('12')).toBe(true);
    expect(kvPut).toHaveBeenCalledTimes(1);
    const [key, value, options] = kvPut.mock.calls[0] as [string, string, { expirationTtl: number }];
    expect(key).toBe(cacheKeyForSport('football'));
    expect(options).toEqual({ expirationTtl: 86400 });
    expect(JSON.parse(value)).toEqual([
      { player_id: '11', full_name: 'Alpha A', position: 'RB', team: 'NYJ', active: true },
      { player_id: '12', full_name: 'Inactive B', position: 'WR', team: 'SF', active: false },
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

  it('retains all players regardless of active flag from cached array payloads', async () => {
    kvGet.mockResolvedValueOnce(JSON.stringify([
      { player_id: '31', full_name: 'Active D', active: true },
      { player_id: '32', full_name: 'Inactive E', active: false },
      { player_id: '33', full_name: 'Missing Active Flag' },
    ]));

    const index = await getSleeperPlayersIndex(env, 'football');

    expect(index.has('31')).toBe(true);
    expect(index.has('32')).toBe(true);
    expect(index.has('33')).toBe(true);
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

  it('memoizes the parsed index and returns the same Map instance on repeat calls', async () => {
    kvGet.mockResolvedValueOnce(JSON.stringify([
      { player_id: '51', full_name: 'Memoized Player', active: true },
    ]));

    const first = await getSleeperPlayersIndex(env, 'football');
    const second = await getSleeperPlayersIndex(env, 'football');

    // Same Map instance, not just equal content — repeat calls should skip
    // re-running JSON.parse/normalizePlayers/toPlayerIndex entirely.
    expect(first).toBe(second);
    expect(kvGet).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent calls for the same sport into a single load', async () => {
    kvGet.mockResolvedValueOnce(JSON.stringify([
      { player_id: '61', full_name: 'Concurrent Player', active: true },
    ]));

    const [a, b, c] = await Promise.all([
      getSleeperPlayersIndex(env, 'football'),
      getSleeperPlayersIndex(env, 'football'),
      getSleeperPlayersIndex(env, 'football'),
    ]);

    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(kvGet).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws instead of caching an empty player index from a 200 payload', async () => {
    kvGet.mockResolvedValueOnce(null); // cache miss
    mockFetch.mockResolvedValueOnce(jsonResponse([])); // valid 200, but zero usable players

    await expect(getSleeperPlayersIndex(env, 'football')).rejects.toThrow(
      'SLEEPER_INVALID_PLAYER_INDEX'
    );
    expect(kvPut).not.toHaveBeenCalled();
  });

  it('does not trust a cached empty index — refetches instead', async () => {
    kvGet.mockResolvedValueOnce(JSON.stringify([])); // e.g. a previously-poisoned cache entry
    mockFetch.mockResolvedValueOnce(jsonResponse([
      { player_id: '71', full_name: 'Fresh Player', active: true },
    ]));

    const index = await getSleeperPlayersIndex(env, 'football');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(index.get('71')?.full_name).toBe('Fresh Player');
    expect(kvPut).toHaveBeenCalledTimes(1);
  });

  it('throws instead of caching a mostly-malformed player index from a 200 payload', async () => {
    kvGet.mockResolvedValueOnce(null); // cache miss
    // 1 valid entry, 4 malformed (no player_id, so parsePlayerRecord returns
    // null for each) — skipped (4) > records (1), a majority-unusable payload.
    mockFetch.mockResolvedValueOnce(jsonResponse([
      { player_id: '81', full_name: 'Only Valid Player', active: true },
      { full_name: 'No id A' },
      { full_name: 'No id B' },
      { full_name: 'No id C' },
      { full_name: 'No id D' },
    ]));

    await expect(getSleeperPlayersIndex(env, 'football')).rejects.toThrow(
      'SLEEPER_INVALID_PLAYER_INDEX'
    );
    expect(kvPut).not.toHaveBeenCalled();
  });

  it('does not trust a cached mostly-malformed index — refetches instead', async () => {
    kvGet.mockResolvedValueOnce(JSON.stringify([
      { player_id: '82', full_name: 'Only Valid Cached Player', active: true },
      { full_name: 'No id A' },
      { full_name: 'No id B' },
      { full_name: 'No id C' },
    ]));
    mockFetch.mockResolvedValueOnce(jsonResponse([
      { player_id: '91', full_name: 'Fresh Player', active: true },
    ]));

    const index = await getSleeperPlayersIndex(env, 'football');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(index.get('91')?.full_name).toBe('Fresh Player');
  });

  it('succeeds when only a minority of entries are malformed', async () => {
    kvGet.mockResolvedValueOnce(null); // cache miss
    // 5 valid entries, 1 malformed — skipped (1) is not > records (5), so
    // this is NOT structurally invalid and the 5 valid players are kept.
    mockFetch.mockResolvedValueOnce(jsonResponse([
      { player_id: '101', full_name: 'Player A', active: true },
      { player_id: '102', full_name: 'Player B', active: true },
      { player_id: '103', full_name: 'Player C', active: true },
      { player_id: '104', full_name: 'Player D', active: true },
      { player_id: '105', full_name: 'Player E', active: true },
      { full_name: 'No id — dropped, not fatal' },
    ]));

    const index = await getSleeperPlayersIndex(env, 'football');

    expect(index.size).toBe(5);
    expect(index.get('101')?.full_name).toBe('Player A');
    expect(kvPut).toHaveBeenCalledTimes(1);
  });

  it('clears the in-flight load on rejection so concurrent callers all reject and the next call retries', async () => {
    kvGet.mockResolvedValue(null); // cache miss on every call in this test
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 503 })); // first attempt fails

    const results = await Promise.allSettled([
      getSleeperPlayersIndex(env, 'football'),
      getSleeperPlayersIndex(env, 'football'),
    ]);

    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('rejected');
    // Both callers shared the single in-flight load (one KV read, one fetch).
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // inFlightLoads must have cleared on rejection — the next call is a
    // fresh attempt, not stuck reusing the rejected promise.
    mockFetch.mockResolvedValueOnce(jsonResponse([
      { player_id: '111', full_name: 'Retry Player', active: true },
    ]));
    const index = await getSleeperPlayersIndex(env, 'football');

    expect(index.get('111')?.full_name).toBe('Retry Player');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
