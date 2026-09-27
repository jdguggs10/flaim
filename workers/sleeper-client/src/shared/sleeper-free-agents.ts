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
    .sort((a, b) => {
      // Deterministic ordering so an exact-name match always survives the
      // count cap instead of depending on Map iteration order: exact match
      // first, then alphabetical, then player_id as a final tiebreak.
      const aExact = a.full_name.toLowerCase() === normalizedQuery ? 0 : 1;
      const bExact = b.full_name.toLowerCase() === normalizedQuery ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      const nameCmp = a.full_name.localeCompare(b.full_name);
      if (nameCmp !== 0) return nameCmp;
      return a.player_id.localeCompare(b.player_id);
    })
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

/** Missing search_rank sinks to the bottom rather than winning ties. */
function searchRankOf(player: SleeperPlayerRecord): number {
  return player.search_rank ?? Number.POSITIVE_INFINITY;
}

export function buildSleeperFreeAgents(
  players: Map<string, SleeperPlayerRecord>,
  rosteredPlayerIds: Set<string>,
  position?: string,
  count = 25,
  // FLA-422: 24h trending-add counts, passed in so this builder stays pure.
  trendingAdds: Map<string, number> = new Map(),
): SleeperFreeAgent[] {
  const normalizedPosition = position?.trim().toUpperCase();
  const maxCount = clampCount(count);

  const freeAgents = Array.from(players.values())
    .filter((player) => player.active)
    .filter((player) => !rosteredPlayerIds.has(player.player_id))
    .filter((player) => !!player.team)
    .filter((player) => !normalizedPosition || player.position?.toUpperCase() === normalizedPosition)
    .sort((a, b) => {
      // 1) Sleeper trending adds (last 24h), higher count first; players
      //    absent from the trending list rank behind every trending player.
      const aTrend = trendingAdds.get(a.player_id) ?? -1;
      const bTrend = trendingAdds.get(b.player_id) ?? -1;
      if (aTrend !== bTrend) return bTrend - aTrend;
      // 2) Sleeper's own search_rank, ascending (lower = better); missing
      //    values sink to the bottom rather than winning on a null/0 sort.
      // Compared with === first because Infinity - Infinity is NaN, which
      // Array#sort treats as "equal" but is not a safe general comparator
      // result.
      const aRank = searchRankOf(a);
      const bRank = searchRankOf(b);
      if (aRank !== bRank) return aRank - bRank;
      // 3) Name, then id, as a final deterministic tiebreak.
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
