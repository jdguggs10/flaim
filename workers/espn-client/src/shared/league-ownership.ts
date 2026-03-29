import type { Env, EspnLeagueResponse } from '../types';
import type { EspnCredentials } from '@flaim/worker-shared';
import { getCredentials } from './auth';
import { espnFetch } from './espn-api';

export interface LeagueOwnerInfo {
  teamId: number;
  teamName: string;
  ownerName: string | undefined;
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
  let credentials: EspnCredentials | null;
  try {
    credentials = await getCredentials(env, authHeader, correlationId);
  } catch {
    return null;
  }
  if (!credentials) return null;

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
      const playerId = entry.playerPoolEntry?.player?.id;
      if (playerId) {
        ownerMap.set(playerId, { teamId: team.id, teamName, ownerName });
      }
    }
  }

  return ownerMap;
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
