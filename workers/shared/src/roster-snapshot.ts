import type { SeasonSport } from './season.js';
import { ErrorCode } from './errors.js';

/**
 * Normalized roster snapshot request. The MCP gateway validates the public
 * `week` / `as_of_date` inputs against the capability map below and injects
 * this discriminated value into routed params; platform workers re-derive it
 * defensively at their /execute boundary (get_roster only) so handlers never
 * consume a raw `week` again.
 *
 * `requestedWeek` on the 'current' variant is the published-client
 * compatibility marker (FLA-209): clients pinned to an older tool schema
 * (where `week` was valid for every sport) still send `week` for daily
 * sports and cannot send `as_of_date`. Such requests normalize to the
 * current roster, and the ignored selector is preserved here so response
 * metadata can state explicitly what happened.
 */
export type RosterSnapshot =
  | { type: 'current'; requestedWeek?: number }
  | { type: 'week'; week: number }
  | { type: 'date'; date: string };

/**
 * Which historical selector a platform+sport supports for get_roster.
 * 'week'  — weekly snapshots (football everywhere; Sleeper basketball legs)
 * 'date'  — calendar-day snapshots (ESPN/Yahoo daily sports)
 * null    — supported sport but current roster only (future providers)
 */
export type RosterSelectorCapability = 'week' | 'date' | null;

const ROSTER_SELECTOR_CAPABILITIES: Record<
  string,
  Partial<Record<SeasonSport, RosterSelectorCapability>>
> = {
  espn: { football: 'week', baseball: 'date', basketball: 'date', hockey: 'date' },
  yahoo: { football: 'week', baseball: 'date', basketball: 'date', hockey: 'date' },
  // Sleeper baseball/hockey are absent: the sport itself is unsupported there
  // (the platform worker rejects with SPORT_NOT_SUPPORTED before roster logic).
  sleeper: { football: 'week', basketball: 'week' },
};

export function getRosterSelectorCapability(
  platform: string,
  sport: SeasonSport
): RosterSelectorCapability | undefined {
  return ROSTER_SELECTOR_CAPABILITIES[platform]?.[sport];
}

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for a calendar-valid YYYY-MM-DD ('2026-02-30' fails). */
export function isCalendarValidDate(value: string): boolean {
  if (!DATE_SHAPE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year &&
    utc.getUTCMonth() === month - 1 &&
    utc.getUTCDate() === day
  );
}

function describeValidSelector(
  platform: string,
  sport: SeasonSport,
  capability: RosterSelectorCapability | undefined
): string {
  switch (capability) {
    case 'week':
      return `${platform} ${sport} tracks roster history by week. Pass week (a positive integer), or omit both selectors for the current roster.`;
    case 'date':
      return `${platform} ${sport} rosters are daily. Pass as_of_date in YYYY-MM-DD format for a historical roster, or omit both selectors for the current roster.`;
    case null:
      return `${platform} ${sport} does not support historical rosters. Omit week and as_of_date for the current roster.`;
    default:
      return `${platform} does not support ${sport} fantasy leagues.`;
  }
}

export type RosterSnapshotValidation =
  | { ok: true; snapshot: RosterSnapshot }
  | {
      ok: false;
      error: string;
      code:
        | typeof ErrorCode.INVALID_ROSTER_SNAPSHOT_SELECTOR
        | typeof ErrorCode.SPORT_NOT_SUPPORTED;
    };

/**
 * Validate public get_roster selector inputs for a platform+sport and
 * normalize them to a RosterSnapshot. At most one selector; wrong-selector,
 * malformed, and calendar-invalid inputs return a corrective error. A
 * selector on a platform that doesn't offer the sport at all returns
 * SPORT_NOT_SUPPORTED rather than implying a selector-free retry would work.
 */
export function validateRosterSnapshotInput(
  platform: string,
  sport: SeasonSport,
  week: number | undefined,
  asOfDate: string | undefined
): RosterSnapshotValidation {
  const capability = getRosterSelectorCapability(platform, sport);
  const reject = (detail: string): RosterSnapshotValidation => ({
    ok: false,
    error: `${detail} ${describeValidSelector(platform, sport, capability)}`.trim(),
    code: capability === undefined
      ? ErrorCode.SPORT_NOT_SUPPORTED
      : ErrorCode.INVALID_ROSTER_SNAPSHOT_SELECTOR,
  });

  if (week !== undefined && asOfDate !== undefined) {
    return reject('Pass at most one of week or as_of_date.');
  }

  if (week !== undefined) {
    if (capability === undefined) {
      return reject('');
    }
    if (!Number.isInteger(week) || week < 1) {
      return reject(`week must be a positive integer (received ${week}).`);
    }
    if (capability === 'date') {
      // Published-client compatibility (FLA-209): clients pinned to an older
      // tool schema still send `week` for daily sports and cannot send
      // `as_of_date`. Serve the current roster instead of erroring, carrying
      // the ignored selector so response metadata surfaces what happened.
      return { ok: true, snapshot: { type: 'current', requestedWeek: week } };
    }
    if (capability !== 'week') {
      return reject('week is not a valid selector here.');
    }
    return { ok: true, snapshot: { type: 'week', week } };
  }

  if (asOfDate !== undefined) {
    if (capability === undefined) {
      return reject('');
    }
    if (!isCalendarValidDate(asOfDate)) {
      return reject(`as_of_date must be a calendar-valid YYYY-MM-DD date (received "${asOfDate}").`);
    }
    if (capability !== 'date') {
      return reject('as_of_date is not a valid selector here.');
    }
    return { ok: true, snapshot: { type: 'date', date: asOfDate } };
  }

  return { ok: true, snapshot: { type: 'current' } };
}

/** Strict parse of an injected snapshot value: valid exact shape or null. */
function parseSnapshotShape(candidate: unknown): RosterSnapshot | null {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }
  const snap = candidate as Record<string, unknown>;
  switch (snap.type) {
    case 'current':
      // A "current" snapshot carrying selector fields signals a confused
      // producer; refuse it rather than guess which intent wins.
      if (snap.week !== undefined || snap.date !== undefined) return null;
      if (snap.requestedWeek === undefined) return { type: 'current' };
      // Published-client compatibility marker (FLA-209): preserve the
      // gateway-normalized ignored week so metadata can report it.
      return Number.isInteger(snap.requestedWeek) && (snap.requestedWeek as number) >= 1
        ? { type: 'current', requestedWeek: snap.requestedWeek as number }
        : null;
    case 'week':
      if (snap.date !== undefined || snap.requestedWeek !== undefined) return null;
      return Number.isInteger(snap.week) && (snap.week as number) >= 1
        ? { type: 'week', week: snap.week as number }
        : null;
    case 'date':
      if (snap.week !== undefined || snap.requestedWeek !== undefined) return null;
      return typeof snap.date === 'string' && isCalendarValidDate(snap.date)
        ? { type: 'date', date: snap.date }
        : null;
    default:
      return null;
  }
}

/**
 * Defensive re-derivation at a platform worker's /execute boundary
 * (get_roster only). Any present `snapshot` — including null — is parsed
 * strictly: valid exact shape or null, so malformed and internally
 * conflicting shapes are rejected with a corrective error instead of
 * silently degrading a historical request to a current-roster fetch. Legacy
 * `week` from an older gateway is consulted only when `snapshot` is entirely
 * absent, and is equally strict: a present week must be a positive integer.
 * Only total selector absence resolves to current. Valid legacy weeks map to
 * { type: 'week' } for every sport so daily-sport handlers reject them
 * rather than reproducing the week→scoringPeriodId bug.
 */
export function resolveRosterSnapshotFromParams(params: {
  snapshot?: unknown;
  week?: number | null;
}): RosterSnapshot | null {
  if (params.snapshot !== undefined) {
    return parseSnapshotShape(params.snapshot);
  }
  if (params.week !== undefined) {
    return Number.isInteger(params.week) && (params.week as number) >= 1
      ? { type: 'week', week: params.week as number }
      : null;
  }
  return { type: 'current' };
}

/** Corrective error body for a handler rejecting an unsupported snapshot type. */
export function rosterSnapshotUnsupportedError(
  platform: string,
  sport: SeasonSport
): { success: false; error: string; code: string; status: 400 } {
  const capability = getRosterSelectorCapability(platform, sport);
  return {
    success: false,
    error: describeValidSelector(platform, sport, capability),
    code: capability === undefined
      ? ErrorCode.SPORT_NOT_SUPPORTED
      : ErrorCode.INVALID_ROSTER_SNAPSHOT_SELECTOR,
    status: 400,
  };
}

/** Corrective error body for a malformed injected snapshot object. */
export function malformedRosterSnapshotError(): {
  success: false;
  error: string;
  code: string;
  status: 400;
} {
  return {
    success: false,
    error:
      'The roster snapshot request was malformed. Retry with week (a positive integer) or as_of_date (a calendar-valid YYYY-MM-DD date), or omit both selectors for the current roster.',
    code: ErrorCode.INVALID_ROSTER_SNAPSHOT_SELECTOR,
    status: 400,
  };
}

/**
 * Normalized snapshot response block shared by all roster payloads. A
 * current snapshot produced by the published-client week shim (FLA-209)
 * additionally reports `requested_week` and a human-readable `note` so the
 * model can see the selector was ignored rather than silently honored.
 */
export function toSnapshotMetadata(
  snapshot: RosterSnapshot,
  extras?: { providerScoringPeriodId?: number }
): Record<string, unknown> {
  const base: Record<string, unknown> = { type: snapshot.type };
  if (snapshot.type === 'current' && snapshot.requestedWeek !== undefined) {
    base.requested_week = snapshot.requestedWeek;
    base.note = `The requested week ${snapshot.requestedWeek} selector was ignored: this platform and sport track roster history by date, not week, so the current roster was returned. For a historical roster, pass as_of_date (YYYY-MM-DD) instead.`;
  }
  if (snapshot.type === 'week') base.week = snapshot.week;
  if (snapshot.type === 'date') base.date = snapshot.date;
  if (extras?.providerScoringPeriodId !== undefined) {
    base.providerScoringPeriodId = extras.providerScoringPeriodId;
  }
  return base;
}
