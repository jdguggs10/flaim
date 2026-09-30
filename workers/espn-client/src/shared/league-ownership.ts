import type { Env, EspnLeagueResponse, EspnPlayerPoolResponse, EspnPlayerStat } from '../types';
import type { EspnCredentials } from '@flaim/worker-shared';
import { getCredentials } from './auth';
import { espnFetch } from './espn-api';

export interface LeagueOwnerInfo {
  teamId: number;
  teamName: string;
  ownerName: string | undefined;
  /** Stats returned by the same league mRoster response as ownership. */
  stats: EspnPlayerStat[] | undefined;
}

export interface LeaguePlayerSearchEnrichment {
  ownerMap: Map<number, LeagueOwnerInfo>;
  /**
   * Stats returned for unrostered players from ESPN's bounded availability
   * pool. A missing map entry means ESPN did not return that player in the
   * pool; it is deliberately distinct from an entry whose stats are absent.
   */
  freeAgentStats: Map<number, EspnPlayerStat[] | undefined>;
}

async function getLeagueCredentials(
  env: Env,
  authHeader?: string,
  correlationId?: string,
): Promise<EspnCredentials | null> {
  try {
    return await getCredentials(env, authHeader, correlationId);
  } catch {
    return null;
  }
}

async function fetchLeagueRosterMap(
  credentials: EspnCredentials,
  gameId: string,
  leagueId: string,
  seasonYear: number,
): Promise<Map<number, LeagueOwnerInfo> | null> {
  let data: EspnLeagueResponse;
  try {
    const path = `/seasons/${seasonYear}/segments/0/leagues/${leagueId}?view=mRoster&view=mTeam`;
    const response = await espnFetch(path, gameId, { credentials, timeout: 7000 });
    if (!response.ok) return null;
    data = await response.json() as EspnLeagueResponse;
  } catch (err) {
    console.warn('[league-ownership] Roster fetch failed, skipping enrichment:', err instanceof Error ? err.message : err);
    return null;
  }

  const ownerMap = new Map<number, LeagueOwnerInfo>();
  for (const team of data.teams ?? []) {
    const teamName = team.location && team.nickname
      ? `${team.location} ${team.nickname}`
      : team.name || `Team ${team.id}`;
    const ownerName = team.owners?.map((o) => o.displayName || o.firstName).find(Boolean) || undefined;

    for (const entry of team.roster?.entries ?? []) {
      const player = entry.playerPoolEntry?.player;
      if (player?.id) {
        ownerMap.set(player.id, { teamId: team.id, teamName, ownerName, stats: player.stats });
      }
    }
  }

  return ownerMap;
}

/**
 * Fetches all rosters for a league and builds a player ID → owner map.
 * Returns null if credentials are unavailable (graceful degradation for demo/public mode).
 * Returns an empty map if the fetch succeeds but no rosters are found.
 */
export async function fetchLeagueOwnershipMap(
  env: Env,
  gameId: string,
  leagueId: string,
  seasonYear: number,
  authHeader?: string,
  correlationId?: string,
): Promise<Map<number, LeagueOwnerInfo> | null> {
  const credentials = await getLeagueCredentials(env, authHeader, correlationId);
  if (!credentials) return null;

  return fetchLeagueRosterMap(credentials, gameId, leagueId, seasonYear);
}

/**
 * Fetches one league roster payload for ownership and rostered player stats,
 * then makes at most one bounded availability-pool request for unmatched IDs.
 * ESPN league views reject filterIds, so this intentionally never requests
 * individual league players by id.
 */
export async function fetchLeaguePlayerSearchEnrichment(
  env: Env,
  gameId: string,
  leagueId: string,
  seasonYear: number,
  playerIds: readonly number[],
  authHeader?: string,
  correlationId?: string,
): Promise<LeaguePlayerSearchEnrichment | null> {
  const credentials = await getLeagueCredentials(env, authHeader, correlationId);
  if (!credentials) return null;

  const ownerMap = await fetchLeagueRosterMap(credentials, gameId, leagueId, seasonYear);
  if (!ownerMap) return null;

  const unrosteredIds = [...new Set(playerIds)].filter((playerId) => !ownerMap.has(playerId));
  const freeAgentStats = new Map<number, EspnPlayerStat[] | undefined>();
  if (unrosteredIds.length === 0) return { ownerMap, freeAgentStats };

  try {
    const path = `/seasons/${seasonYear}/segments/0/leagues/${leagueId}?view=kona_player_info`;
    const filter = {
      players: {
        filterStatus: { value: ['FREEAGENT', 'WAIVERS'] },
        sortPercOwned: { sortPriority: 1, sortAsc: false },
        limit: 100,
      },
    };
    const response = await espnFetch(path, gameId, {
      credentials,
      timeout: 7000,
      headers: { 'X-Fantasy-Filter': JSON.stringify(filter) },
    });
    if (!response.ok) return { ownerMap, freeAgentStats };

    const pool = await response.json() as EspnPlayerPoolResponse;
    const unrosteredSet = new Set(unrosteredIds);
    for (const entry of pool.players ?? []) {
      const player = entry.player;
      if (player?.id && unrosteredSet.has(player.id)) {
        freeAgentStats.set(player.id, player.stats);
      }
    }
  } catch (err) {
    console.warn('[league-ownership] Free-agent pool fetch failed, leaving player scoring unavailable:', err instanceof Error ? err.message : err);
  }

  return { ownerMap, freeAgentStats };
}

/**
 * Enriches a player search result with league ownership fields.
 * Three clear states:
 * - ownerMap is null → credentials unavailable, all league fields null
 * - player not in ownerMap → free agent in this league
 * - player in ownerMap → rostered, includes team name + owner name
 */
export function enrichPlayerWithOwnership(
  playerId: number,
  ownerMap: Map<number, LeagueOwnerInfo> | null,
): {
  league_status: 'ROSTERED' | 'FREE_AGENT' | null;
  league_team_name: string | null;
  league_owner_name: string | null;
} {
  if (!ownerMap) {
    return { league_status: null, league_team_name: null, league_owner_name: null };
  }

  const owner = ownerMap.get(playerId);
  if (!owner) {
    return { league_status: 'FREE_AGENT', league_team_name: null, league_owner_name: null };
  }

  return {
    league_status: 'ROSTERED',
    league_team_name: owner.teamName,
    league_owner_name: owner.ownerName ?? null,
  };
}
