// workers/espn-client/src/shared/roster-entry.ts
import type { RosterSnapshot } from '@flaim/worker-shared';

/**
 * ESPN's roster player object exposes `proTeamId`/`injuryStatus` as the
 * player's CURRENT club and CURRENT injury state — the `mRoster` payload
 * carries no historical pro-team or injury data for a past snapshot. On a
 * historical roster (`snapshot.type !== 'current'`), including these fields
 * would silently relabel present-day state as if it were true as of that
 * past week/date (e.g. a player traded since would show their new club on
 * an old roster). Historical entries must omit `proTeam`/`injuryStatus`
 * entirely rather than emit a misleading value (FLA-278: temporal purity),
 * mirroring how Sleeper's `resolveSleeperPlayerEntries` conditionally omits
 * `team` for historical entries.
 *
 * Current-snapshot output is unaffected: both fields are included exactly
 * as before, with `injuryStatus` omitted only when ESPN reports none.
 */
export function currentClubAndInjuryFields(
  snapshot: RosterSnapshot,
  proTeamAbbrev: string,
  injuryStatus: string | undefined
): { proTeam: string; injuryStatus?: string } | Record<string, never> {
  if (snapshot.type !== 'current') {
    return {};
  }
  return {
    proTeam: proTeamAbbrev,
    ...(injuryStatus ? { injuryStatus } : {}),
  };
}

/**
 * Builds the `limitations` object for a `get_roster` response, extending
 * the existing `acquisitionMetadataAvailable` flag with
 * `playerProTeamAvailable: false` on every historical snapshot (the pro
 * team/injury omission above applies unconditionally to historical rosters,
 * not just when acquisition metadata happens to be missing). Returns
 * `undefined` for a current snapshot so callers can spread it away with
 * `...(limitations ? { limitations } : {})`.
 */
export function buildRosterLimitations(
  snapshot: RosterSnapshot,
  acquisitionMetadataMissing: boolean
): { acquisitionMetadataAvailable?: false; playerProTeamAvailable: false } | undefined {
  if (snapshot.type === 'current') {
    return undefined;
  }
  return {
    ...(acquisitionMetadataMissing ? { acquisitionMetadataAvailable: false as const } : {}),
    playerProTeamAvailable: false,
  };
}
