import type { SleeperLeague, SleeperLeagueUser, SleeperRoster } from '../types';
import { handleSleeperError, sleeperFetch } from './sleeper-api';
import { buildUserDirectory, type SleeperUserDirectoryEntry } from './sleeper-enrichment';

export interface SleeperRosterOwner {
  rosterId: number;
  ownerId: string;
}

/**
 * player_id -> owning roster, scoped to exactly one league. A value of
 * 'AMBIGUOUS' means the id was seen on more than one roster in the same
 * response (inconsistent upstream data, e.g. mid-trade) — see the
 * ambiguity note on resolveSleeperPlayerLeagueAvailability below.
 */
export type SleeperPlayerOwnershipMap = Map<string, SleeperRosterOwner | 'AMBIGUOUS'>;

export interface SleeperLeagueOwnershipContext {
  ownership: SleeperPlayerOwnershipMap;
  userDirectory: Map<string, SleeperUserDirectoryEntry>;
}

/**
 * True only for a roster entry Flaim can safely trust for ownership: an
 * object with a numeric roster_id, and a `players` field that is either
 * absent/null (a genuinely empty roster) or an array. This exists because
 * two malformed-but-200 shapes otherwise fail OPEN rather than closed:
 * `players` as a string (e.g. "4034") would iterate character-by-character
 * in a `for...of`, so the real id never enters the map; a rosters array of
 * non-roster objects (e.g. `[{}]`) would pass the outer length guard and
 * silently yield an empty map. Both would report every matched player
 * AVAILABLE. One malformed entry fails the whole call (see below) rather
 * than being skipped, because a silently skipped roster's players would
 * themselves resolve as available.
 */
function isPlausibleRosterEntry(value: unknown): value is SleeperRoster {
  if (typeof value !== 'object' || value === null) return false;
  const roster = value as Record<string, unknown>;
  if (typeof roster.roster_id !== 'number' || !Number.isFinite(roster.roster_id)) return false;
  if (roster.players !== undefined && roster.players !== null && !Array.isArray(roster.players)) return false;
  return true;
}

/**
 * Request-local only — never cached across requests or leagues, since a
 * stale/shared map here could answer one league's availability question
 * with another league's rosters. No degraded path: a failed load must
 * never let a rostered player be reported AVAILABLE.
 *
 * Also fails closed while the league's draft is actively in progress
 * (`GET /league/{id}` status `"drafting"`): during a live draft, rosters
 * exist but their `players` lists stay empty until the draft completes —
 * in-progress picks live only on `/draft/{draft_id}/picks` — so a player
 * drafted moments ago would otherwise resolve FREE_AGENT, which is exactly
 * the false-negative this feature must never produce. `pre_draft` is
 * deliberately NOT guarded the same way: a genuinely pre-draft league has
 * nobody drafted yet (aside from keepers, which already sit on rosters and
 * resolve ROSTERED correctly), so FREE_AGENT there is the correct answer,
 * not a gap. `in_season` and `complete` are likewise safe — only `drafting`
 * has this specific rosters/picks split. Merging in-progress draft picks
 * into ownership is out of scope here (tracked as FLA-385); this guard only
 * refuses to guess while that gap exists. An unrecognized future status
 * value is intentionally NOT treated as unsafe — failing the tool for a
 * status this code doesn't yet know about would be worse than the problem
 * it prevents, so only an exact "drafting" match trips the guard.
 */
export async function loadSleeperLeagueOwnership(leagueId: string): Promise<SleeperLeagueOwnershipContext> {
  const [leagueRes, rostersRes, usersRes] = await Promise.all([
    sleeperFetch(`/league/${leagueId}`),
    sleeperFetch(`/league/${leagueId}/rosters`),
    sleeperFetch(`/league/${leagueId}/users`),
  ]);

  if (!leagueRes.ok) handleSleeperError(leagueRes);
  if (!rostersRes.ok) handleSleeperError(rostersRes);
  if (!usersRes.ok) handleSleeperError(usersRes);

  const league: SleeperLeague = await leagueRes.json();
  const rosters: SleeperRoster[] = await rostersRes.json();
  const users: SleeperLeagueUser[] = await usersRes.json();

  // An unrecognized status is deliberately allowed through (see above), but an
  // unreadable league payload is not: without a status this code cannot tell a
  // live draft from a normal league, and guessing "not drafting" would reopen
  // the false-negative the check below exists to prevent.
  if (typeof league !== 'object' || league === null || typeof league.status !== 'string') {
    throw new Error('SLEEPER_API_ERROR: Sleeper league response was malformed or missing a status');
  }
  if (league.status === 'drafting') {
    throw new Error(
      'SLEEPER_DRAFT_IN_PROGRESS: This league\'s draft is in progress; player league availability cannot ' +
        'be resolved until the draft completes, because in-progress picks are not yet reflected on Sleeper ' +
        'rosters. Use get_draft to see selections made so far.',
    );
  }

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
    if (!isPlausibleRosterEntry(roster)) {
      throw new Error('SLEEPER_API_ERROR: Sleeper rosters response contained a malformed roster entry');
    }
    for (const rawPlayerId of roster.players ?? []) {
      const playerId = String(rawPlayerId).trim();
      if (!playerId) continue;
      const existing = ownership.get(playerId);
      if (existing === 'AMBIGUOUS') continue;
      // Sleeper should never list the same player_id on two different
      // rosters in one league, but malformed/mid-trade upstream data must
      // not be resolved by guessing an owner — see the ambiguity note on
      // resolveSleeperPlayerLeagueAvailability. A repeat sighting of the
      // SAME roster (e.g. a duplicate id within one roster's own list) is
      // not a conflict and is left as-is.
      if (existing && existing.rosterId !== roster.roster_id) {
        ownership.set(playerId, 'AMBIGUOUS');
        continue;
      }
      if (!existing) {
        ownership.set(playerId, { rosterId: roster.roster_id, ownerId: roster.owner_id });
      }
    }
  }

  return { ownership, userDirectory: buildUserDirectory(users) };
}

export interface SleeperPlayerLeagueAvailability {
  league_status: 'ROSTERED' | 'FREE_AGENT' | null;
  league_team_id: string | null;
  league_team_name: string | null;
  league_owner_name: string | null;
}

/**
 * Resolves one player_id's availability against a league ownership context.
 * A rostered player whose owner_id has no matching entry in userDirectory
 * still resolves as ROSTERED (a team owns the slot) — team/owner names fall
 * back to null rather than the whole player falling back to AVAILABLE.
 *
 * A player_id seen on more than one roster (inconsistent upstream data,
 * e.g. a trade mid-processing) resolves as `league_status: null` with every
 * team/owner field null, rather than guessing whichever roster was
 * encountered first — that guess wouldn't be stable across calls if
 * Sleeper's response order changed, and would report a specific owner with
 * false confidence. `null` is contract-legal here (the declared schema
 * documents `league_status` as ROSTERED, FREE_AGENT, or null when
 * unavailable) and routes the caller to `get_roster` for verification.
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
  if (owner === 'AMBIGUOUS') {
    return {
      league_status: null,
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
