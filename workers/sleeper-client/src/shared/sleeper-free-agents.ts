import type { SleeperPlayerRecord } from './sleeper-players-cache';

export interface SleeperFreeAgent {
  id: string;
  name: string;
  position?: string;
  team?: string;
}

export interface SleeperPlayerSearchResult {
  id: string;
  name: string;
  position?: string;
  team?: string;
  market_percent_owned: null;
  ownership_scope: 'unavailable';
}

function clampCount(count: number): number {
  return Math.max(1, Math.min(100, Math.trunc(count)));
}

export function buildSleeperPlayerSearch(
  players: Map<string, SleeperPlayerRecord>,
  query: string,
  position?: string,
  count = 10,
): SleeperPlayerSearchResult[] {
  const normalizedQuery = query.toLowerCase();
  const normalizedPosition = position?.trim().toUpperCase();
  const maxCount = Math.max(1, Math.min(25, Math.trunc(count)));

  return Array.from(players.values())
    .filter((player) => player.full_name.toLowerCase().includes(normalizedQuery))
    .filter((player) => !normalizedPosition || player.position?.toUpperCase() === normalizedPosition)
    .slice(0, maxCount)
    .map((player) => ({
      id: player.player_id,
      name: player.full_name,
      position: player.position,
      team: player.team,
      market_percent_owned: null,
      ownership_scope: 'unavailable',
    }));
}

export function buildSleeperFreeAgents(
  players: Map<string, SleeperPlayerRecord>,
  rosteredPlayerIds: Set<string>,
  position?: string,
  count = 25,
): SleeperFreeAgent[] {
  const normalizedPosition = position?.trim().toUpperCase();
  const maxCount = clampCount(count);

  const freeAgents = Array.from(players.values())
    .filter((player) => player.active)
    .filter((player) => !rosteredPlayerIds.has(player.player_id))
    .filter((player) => !normalizedPosition || player.position?.toUpperCase() === normalizedPosition)
    .sort((a, b) => {
      const nameCmp = a.full_name.localeCompare(b.full_name);
      if (nameCmp !== 0) return nameCmp;
      return a.player_id.localeCompare(b.player_id);
    })
    .slice(0, maxCount);

  return freeAgents.map((player) => ({
    id: player.player_id,
    name: player.full_name,
    position: player.position,
    team: player.team,
  }));
}
