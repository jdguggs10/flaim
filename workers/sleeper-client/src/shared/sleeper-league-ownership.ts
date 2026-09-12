import type { SleeperLeagueUser, SleeperRoster } from '../types';
import { handleSleeperError, sleeperFetch } from './sleeper-api';
import { buildUserDirectory, type SleeperUserDirectoryEntry } from './sleeper-enrichment';

export interface SleeperRosterOwner {
  rosterId: number;
  ownerId: string;
}

/** player_id -> owning roster, scoped to exactly one league. */
export type SleeperPlayerOwnershipMap = Map<string, SleeperRosterOwner>;

export interface SleeperLeagueOwnershipContext {
  ownership: SleeperPlayerOwnershipMap;
  userDirectory: Map<string, SleeperUserDirectoryEntry>;
}

/**
 * Request-local only — never cached across requests or leagues, since a
 * stale/shared map here could answer one league's availability question
 * with another league's rosters. No degraded path: a failed load must
 * never let a rostered player be reported AVAILABLE.
 */
export async function loadSleeperLeagueOwnership(leagueId: string): Promise<SleeperLeagueOwnershipContext> {
  const [rostersRes, usersRes] = await Promise.all([
    sleeperFetch(`/league/${leagueId}/rosters`),
    sleeperFetch(`/league/${leagueId}/users`),
  ]);

  if (!rostersRes.ok) handleSleeperError(rostersRes);
  if (!usersRes.ok) handleSleeperError(usersRes);

  const rosters: SleeperRoster[] = await rostersRes.json();
  const users: SleeperLeagueUser[] = await usersRes.json();

  // A 200 with a malformed or empty-array rosters body must not resolve to
  // an empty ownership map — that would report every matched player
  // AVAILABLE. A real pre-draft league still has roster entries (with empty
  // or null `players`), so this guards on `rosters.length`, never `ownership.size`.
  if (!Array.isArray(rosters) || rosters.length === 0) {
    throw new Error('SLEEPER_API_ERROR: Sleeper rosters response was empty or malformed');
  }
  if (!Array.isArray(users)) {
    throw new Error('SLEEPER_API_ERROR: Sleeper users response was malformed');
  }

  const ownership: SleeperPlayerOwnershipMap = new Map();
  for (const roster of rosters) {
    for (const rawPlayerId of roster.players ?? []) {
      const playerId = String(rawPlayerId).trim();
      if (!playerId) continue;
      // Sleeper should never list the same player_id on two rosters in one
      // league, but malformed upstream data must not produce order-dependent
      // ownership: the first roster encountered wins deterministically
      // rather than a plain Map.set letting the last roster iterated win.
      if (!ownership.has(playerId)) {
        ownership.set(playerId, { rosterId: roster.roster_id, ownerId: roster.owner_id });
      }
    }
  }

  return { ownership, userDirectory: buildUserDirectory(users) };
}

export interface SleeperPlayerLeagueAvailability {
  league_status: 'ROSTERED' | 'FREE_AGENT';
  league_team_id: string | null;
  league_team_name: string | null;
  league_owner_name: string | null;
}

/**
 * Resolves one player_id's availability against a league ownership context.
 * A rostered player whose owner_id has no matching entry in userDirectory
 * still resolves as ROSTERED (a team owns the slot) — team/owner names fall
 * back to null rather than the whole player falling back to AVAILABLE.
 */
export function resolveSleeperPlayerLeagueAvailability(
  playerId: string,
  context: SleeperLeagueOwnershipContext,
): SleeperPlayerLeagueAvailability {
  const owner = context.ownership.get(String(playerId).trim());
  if (!owner) {
    return {
      league_status: 'FREE_AGENT',
      league_team_id: null,
      league_team_name: null,
      league_owner_name: null,
    };
  }

  const userEntry = context.userDirectory.get(owner.ownerId);
  return {
    league_status: 'ROSTERED',
    league_team_id: String(owner.rosterId),
    league_team_name: userEntry?.teamName ?? null,
    league_owner_name: userEntry?.displayName ?? null,
  };
}
