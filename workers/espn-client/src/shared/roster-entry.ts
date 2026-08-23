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
 * not just when acquisition metadata happens to be missing), and likewise
 * `keeperValueFutureAvailable: false` (FLA-284): `keeperValueFuture` is next
 * season's keeper cost, which isn't fixed as of a past week/date, so it is
 * withheld on every historical snapshot regardless of whether ESPN happened
 * to report a value. Returns `undefined` for a current snapshot so callers
 * can spread it away with `...(limitations ? { limitations } : {})`.
 */
export function buildRosterLimitations(
  snapshot: RosterSnapshot,
  acquisitionMetadataMissing: boolean
): { acquisitionMetadataAvailable?: false; playerProTeamAvailable: false; keeperValueFutureAvailable: false } | undefined {
  if (snapshot.type === 'current') {
    return undefined;
  }
  return {
    ...(acquisitionMetadataMissing ? { acquisitionMetadataAvailable: false as const } : {}),
    playerProTeamAvailable: false,
    keeperValueFutureAvailable: false,
  };
}

/**
 * Maps ESPN's `draftSettings.type` to the unit that `keeperValue`/
 * `keeperValueFuture` are denominated in for `get_roster` (FLA-284 audit).
 *
 * - `AUCTION` -> `'auction_dollars'`.
 * - `SNAKE` and `AUTOPICK` -> `'draft_round'` (both are ordinal-pick draft
 *   formats; keeper cost is a round number either way).
 * - Any other/unknown type (e.g. `OFFLINE`, or the type field being absent)
 *   -> `undefined`, so the caller omits `keeperValueUnit` rather than
 *   guessing at a unit ESPN hasn't told us.
 */
export function resolveKeeperValueUnit(draftType: string | undefined): 'auction_dollars' | 'draft_round' | undefined {
  switch (draftType) {
    case 'AUCTION':
      return 'auction_dollars';
    case 'SNAKE':
    case 'AUTOPICK':
      return 'draft_round';
    default:
      return undefined;
  }
}
