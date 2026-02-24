import { describe, expect, it } from 'vitest';
import { buildSleeperFreeAgents } from '../sleeper-free-agents';
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
