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

  it('sorts deterministically by active then name then id', () => {
    const players = new Map<string, SleeperPlayerRecord>([
      ['z2', { player_id: 'z2', full_name: 'Zeta', active: true }],
      ['a2', { player_id: 'a2', full_name: 'Alpha', active: true }],
      ['a1', { player_id: 'a1', full_name: 'Alpha', active: true }],
    ]);

    const result = buildSleeperFreeAgents(players, new Set(), undefined, 25);

    expect(result.map((player) => player.id)).toEqual(['a1', 'a2', 'z2']);
  });

  it('clamps count to the 1..100 range', () => {
    const players = new Map<string, SleeperPlayerRecord>();
    for (let i = 0; i < 150; i += 1) {
      const id = `p${String(i).padStart(3, '0')}`;
      players.set(id, { player_id: id, full_name: `Player ${i}`, active: true });
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
  });

  it('includes inactive players', () => {
    const result = buildSleeperPlayerSearch(players, 'patrick');
    expect(result.map((p) => p.id)).toContain('4');
  });

  it('is case-insensitive', () => {
    const result = buildSleeperPlayerSearch(players, 'MAHOMES');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
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
});
