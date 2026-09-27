import { describe, expect, it } from 'vitest';
import { buildSleeperFreeAgents, buildSleeperPlayerSearch } from '../sleeper-free-agents';
import type { SleeperPlayerRecord } from '../sleeper-players-cache';

describe('sleeper-free-agents', () => {
  it('excludes rostered players and applies position filter', () => {
    const players = new Map<string, SleeperPlayerRecord>([
      ['p1', { player_id: 'p1', full_name: 'A QB', position: 'QB', team: 'BUF', active: true }],
      ['p2', { player_id: 'p2', full_name: 'B RB', position: 'RB', team: 'KC', active: true }],
      ['p3', { player_id: 'p3', full_name: 'C QB', position: 'QB', team: 'PHI', active: true }],
    ]);
    const rostered = new Set(['p1']);

    const result = buildSleeperFreeAgents(players, rostered, 'QB', 25);

    expect(result).toEqual([
      { id: 'p3', name: 'C QB', position: 'QB', team: 'PHI' },
    ]);
  });

  it('falls back to name then id when no trending or search_rank data distinguishes players', () => {
    const players = new Map<string, SleeperPlayerRecord>([
      ['z2', { player_id: 'z2', full_name: 'Zeta', active: true, team: 'BUF' }],
      ['a2', { player_id: 'a2', full_name: 'Alpha', active: true, team: 'KC' }],
      ['a1', { player_id: 'a1', full_name: 'Alpha', active: true, team: 'PHI' }],
    ]);

    const result = buildSleeperFreeAgents(players, new Set(), undefined, 25);

    expect(result.map((player) => player.id)).toEqual(['a1', 'a2', 'z2']);
  });

  it('excludes inactive players', () => {
    const players = new Map<string, SleeperPlayerRecord>([
      ['p1', { player_id: 'p1', full_name: 'Active Guy', active: true, team: 'BUF' }],
      ['p2', { player_id: 'p2', full_name: 'Inactive Guy', active: false, team: 'KC' }],
    ]);

    const result = buildSleeperFreeAgents(players, new Set(), undefined, 25);

    expect(result.map((player) => player.id)).toEqual(['p1']);
  });

  it('excludes players with no team', () => {
    const players = new Map<string, SleeperPlayerRecord>([
      ['p1', { player_id: 'p1', full_name: 'Has Team', active: true, team: 'BUF' }],
      ['p2', { player_id: 'p2', full_name: 'No Team A', active: true, team: '' }],
      ['p3', { player_id: 'p3', full_name: 'No Team B', active: true }],
    ]);

    const result = buildSleeperFreeAgents(players, new Set(), undefined, 25);

    expect(result.map((player) => player.id)).toEqual(['p1']);
  });

  it('ranks trending adds first, higher count winning, ahead of search_rank', () => {
    const players = new Map<string, SleeperPlayerRecord>([
      ['low-rank', { player_id: 'low-rank', full_name: 'Best Search Rank', active: true, team: 'BUF', search_rank: 1 }],
      ['trend-low', { player_id: 'trend-low', full_name: 'Trending Low', active: true, team: 'KC', search_rank: 9999 }],
      ['trend-high', { player_id: 'trend-high', full_name: 'Trending High', active: true, team: 'PHI', search_rank: 9999 }],
    ]);
    const trendingAdds = new Map([
      ['trend-low', 10],
      ['trend-high', 50],
    ]);

    const result = buildSleeperFreeAgents(players, new Set(), undefined, 25, trendingAdds);

    // Both trending players outrank the non-trending player with the better
    // search_rank; between the two trending players, higher count wins.
    expect(result.map((player) => player.id)).toEqual(['trend-high', 'trend-low', 'low-rank']);
  });

  it('orders by search_rank ascending among non-trending players, with missing/null last', () => {
    const players = new Map<string, SleeperPlayerRecord>([
      ['no-rank', { player_id: 'no-rank', full_name: 'No Rank', active: true, team: 'BUF' }],
      ['rank-5', { player_id: 'rank-5', full_name: 'Rank Five', active: true, team: 'KC', search_rank: 5 }],
      ['rank-1', { player_id: 'rank-1', full_name: 'Rank One', active: true, team: 'PHI', search_rank: 1 }],
    ]);

    const result = buildSleeperFreeAgents(players, new Set(), undefined, 25);

    expect(result.map((player) => player.id)).toEqual(['rank-1', 'rank-5', 'no-rank']);
  });

  it('ignores trending entries for players already filtered out (rostered, inactive, wrong position, no team)', () => {
    const players = new Map<string, SleeperPlayerRecord>([
      ['rostered', { player_id: 'rostered', full_name: 'Rostered Trending', active: true, team: 'BUF', position: 'RB' }],
      ['inactive', { player_id: 'inactive', full_name: 'Inactive Trending', active: false, team: 'KC', position: 'RB' }],
      ['wrong-pos', { player_id: 'wrong-pos', full_name: 'Wrong Position Trending', active: true, team: 'PHI', position: 'QB' }],
      ['no-team', { player_id: 'no-team', full_name: 'No Team Trending', active: true, position: 'RB' }],
      ['eligible', { player_id: 'eligible', full_name: 'Eligible', active: true, team: 'NYJ', position: 'RB' }],
    ]);
    const trendingAdds = new Map([
      ['rostered', 100],
      ['inactive', 100],
      ['wrong-pos', 100],
      ['no-team', 100],
    ]);

    const result = buildSleeperFreeAgents(players, new Set(['rostered']), 'RB', 25, trendingAdds);

    expect(result.map((player) => player.id)).toEqual(['eligible']);
  });

  it('clamps count to the 1..100 range', () => {
    const players = new Map<string, SleeperPlayerRecord>();
    for (let i = 0; i < 150; i += 1) {
      const id = `p${String(i).padStart(3, '0')}`;
      players.set(id, { player_id: id, full_name: `Player ${i}`, active: true, team: 'BUF' });
    }

    const maxResult = buildSleeperFreeAgents(players, new Set(), undefined, 200);
    expect(maxResult).toHaveLength(100);

    const minResult = buildSleeperFreeAgents(players, new Set(), undefined, 0);
    expect(minResult).toHaveLength(1);
  });
});

describe('buildSleeperPlayerSearch', () => {
  const players = new Map<string, SleeperPlayerRecord>([
    ['1', { player_id: '1', full_name: 'Patrick Mahomes', position: 'QB', team: 'KC', active: true }],
    ['2', { player_id: '2', full_name: 'Patrick Queen', position: 'LB', team: 'PIT', active: true }],
    ['3', { player_id: '3', full_name: 'Josh Allen', position: 'QB', team: 'BUF', active: true }],
    ['4', { player_id: '4', full_name: 'Retired Patrick', position: 'WR', team: undefined, active: false }],
  ]);

  it('returns players matching query regardless of roster status', () => {
    const result = buildSleeperPlayerSearch(players, 'patrick');
    expect(result.map((p) => p.id)).toContain('1');
    expect(result.map((p) => p.id)).toContain('2');
    expect(result.every((p) => p.market_percent_owned === null)).toBe(true);
    expect(result.every((p) => p.ownership_scope === 'unavailable')).toBe(true);
  });

  it('includes inactive players', () => {
    const result = buildSleeperPlayerSearch(players, 'patrick');
    expect(result.map((p) => p.id)).toContain('4');
  });

  it('is case-insensitive', () => {
    const result = buildSleeperPlayerSearch(players, 'MAHOMES');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
    expect(result[0].market_percent_owned).toBeNull();
    expect(result[0].ownership_scope).toBe('unavailable');
  });

  it('applies position filter', () => {
    const result = buildSleeperPlayerSearch(players, 'patrick', 'LB');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('returns empty array when no matches', () => {
    const result = buildSleeperPlayerSearch(players, 'zzznomatch');
    expect(result).toHaveLength(0);
  });

  it('clamps count to 1..25', () => {
    const big = new Map<string, SleeperPlayerRecord>();
    for (let i = 0; i < 50; i += 1) {
      const id = `p${i}`;
      big.set(id, { player_id: id, full_name: `Test Player ${i}`, active: true });
    }
    const result = buildSleeperPlayerSearch(big, 'test', undefined, 100);
    expect(result).toHaveLength(25);
  });

  it('orders an exact full-name match first even when it would otherwise be cut by the count cap', () => {
    // Inserted first and alphabetically first, so without exact-match-first
    // ordering this substring match would win the count=1 cap over the
    // player who exactly matches the query.
    const players = new Map<string, SleeperPlayerRecord>([
      ['1', { player_id: '1', full_name: 'AAA Josh Allen Jr', position: 'QB', team: 'BUF', active: true }],
      ['2', { player_id: '2', full_name: 'Josh Allen', position: 'QB', team: 'BUF', active: true }],
    ]);

    const result = buildSleeperPlayerSearch(players, 'Josh Allen', undefined, 1);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('2');
  });

  it('breaks ties between identical names by player_id ascending', () => {
    const players = new Map<string, SleeperPlayerRecord>([
      ['b2', { player_id: 'b2', full_name: 'Same Name', active: true }],
      ['a1', { player_id: 'a1', full_name: 'Same Name', active: true }],
    ]);

    const result = buildSleeperPlayerSearch(players, 'same name');

    expect(result.map((p) => p.id)).toEqual(['a1', 'b2']);
  });
});
