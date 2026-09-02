import type { SleeperLeagueUser, SleeperRoster } from '../types';
import { buildUserDirectory } from './sleeper-enrichment';

export interface SleeperLeagueOwnerInfo {
  rosterId: string;
  teamName: string | null;
  ownerName: string | null;
}

export interface SleeperPlayerAvailability {
  status: 'ROSTERED' | 'AVAILABLE';
  rosterId: string | null;
  teamName: string | null;
  ownerName: string | null;
}

/**
 * Build an exact player-id ownership map from one league's current Sleeper
 * rosters. The map is request-local by design: league identity never enters a
 * shared cache, so ownership from one league cannot leak into another.
 */
export function buildSleeperLeagueOwnershipMap(
  rosters: SleeperRoster[],
  users: SleeperLeagueUser[],
): Map<string, SleeperLeagueOwnerInfo> {
  const userDirectory = buildUserDirectory(users);
  const ownership = new Map<string, SleeperLeagueOwnerInfo>();

  for (const roster of rosters) {
    const owner = userDirectory.get(roster.owner_id);
    for (const playerId of roster.players ?? []) {
      const normalizedPlayerId = String(playerId);
      // A duplicate player across rosters would be malformed upstream data.
      // Preserve the first current-roster match instead of silently changing
      // owners based on response order later in the array.
      if (ownership.has(normalizedPlayerId)) continue;
      ownership.set(normalizedPlayerId, {
        rosterId: String(roster.roster_id),
        teamName: owner?.teamName ?? null,
        ownerName: owner?.displayName ?? null,
      });
    }
  }

  return ownership;
}

/**
 * Authoritative league availability for one Sleeper player id. A miss is
 * AVAILABLE only after the complete current roster list was fetched and
 * converted into the request-local map above.
 */
export function resolveSleeperPlayerAvailability(
  playerId: string,
  ownership: Map<string, SleeperLeagueOwnerInfo>,
): SleeperPlayerAvailability {
  const owner = ownership.get(playerId);
  if (!owner) {
    return {
      status: 'AVAILABLE',
      rosterId: null,
      teamName: null,
      ownerName: null,
    };
  }

  return {
    status: 'ROSTERED',
    rosterId: owner.rosterId,
    teamName: owner.teamName,
    ownerName: owner.ownerName,
  };
}

export function toSleeperLeagueAvailabilityFields(availability: SleeperPlayerAvailability): {
  availability_status: 'ROSTERED' | 'AVAILABLE';
  league_status: 'ROSTERED' | 'FREE_AGENT';
  league_team_id: string | null;
  league_team_name: string | null;
  league_owner_name: string | null;
} {
  return {
    availability_status: availability.status,
    // Preserve the existing cross-provider league_status vocabulary while
    // exposing the clearer Sleeper-specific AVAILABLE status additively.
    league_status: availability.status === 'ROSTERED' ? 'ROSTERED' : 'FREE_AGENT',
    league_team_id: availability.rosterId,
    league_team_name: availability.teamName,
    league_owner_name: availability.ownerName,
  };
}
