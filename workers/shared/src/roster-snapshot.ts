import type { SeasonSport } from './season.js';
import { ErrorCode } from './errors.js';

/**
 * Normalized roster snapshot request. The MCP gateway validates the public
 * `week` / `as_of_date` inputs against the capability map below and injects
 * this discriminated value into routed params; platform workers re-derive it
 * defensively at their /execute boundary (get_roster only) so handlers never
 * consume a raw `week` again.
 */
export type RosterSnapshot =
  | { type: 'current' }
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
    default:
      return `${platform} ${sport} does not support historical rosters. Omit week and as_of_date for the current roster.`;
  }
}

export type RosterSnapshotValidation =
  | { ok: true; snapshot: RosterSnapshot }
  | { ok: false; error: string; code: typeof ErrorCode.INVALID_ROSTER_SNAPSHOT_SELECTOR };

/**
 * Validate public get_roster selector inputs for a platform+sport and
 * normalize them to a RosterSnapshot. At most one selector; wrong-selector,
 * malformed, and calendar-invalid inputs return a corrective error.
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
    error: `${detail} ${describeValidSelector(platform, sport, capability)}`,
    code: ErrorCode.INVALID_ROSTER_SNAPSHOT_SELECTOR,
  });

  if (week !== undefined && asOfDate !== undefined) {
    return reject('Pass at most one of week or as_of_date.');
  }

  if (week !== undefined) {
    if (!Number.isInteger(week) || week < 1) {
      return reject(`week must be a positive integer (received ${week}).`);
    }
    if (capability !== 'week') {
      return reject('week is not a valid selector here.');
    }
    return { ok: true, snapshot: { type: 'week', week } };
  }

  if (asOfDate !== undefined) {
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

/**
 * Defensive re-derivation at a platform worker's /execute boundary
 * (get_roster only). A well-formed injected snapshot wins; otherwise legacy
 * `week` from an older gateway maps to { type: 'week' } for every sport —
 * daily-sport handlers then reject it with the corrective error instead of
 * reproducing the week→scoringPeriodId bug.
 */
export function resolveRosterSnapshotFromParams(params: {
  snapshot?: unknown;
  week?: number;
}): RosterSnapshot {
  const candidate = params.snapshot;
  if (candidate && typeof candidate === 'object') {
    const snap = candidate as Record<string, unknown>;
    if (snap.type === 'current') return { type: 'current' };
    if (snap.type === 'week' && Number.isInteger(snap.week) && (snap.week as number) >= 1) {
      return { type: 'week', week: snap.week as number };
    }
    if (snap.type === 'date' && typeof snap.date === 'string' && isCalendarValidDate(snap.date)) {
      return { type: 'date', date: snap.date };
    }
  }
  if (params.week !== undefined && Number.isInteger(params.week) && params.week >= 1) {
    return { type: 'week', week: params.week };
  }
  return { type: 'current' };
}

/** Corrective error body for a handler rejecting an unsupported snapshot type. */
export function rosterSnapshotUnsupportedError(
  platform: string,
  sport: SeasonSport
): { success: false; error: string; code: string } {
  const capability = getRosterSelectorCapability(platform, sport);
  return {
    success: false,
    error: describeValidSelector(platform, sport, capability),
    code: ErrorCode.INVALID_ROSTER_SNAPSHOT_SELECTOR,
  };
}

/** Normalized snapshot response block shared by all roster payloads. */
export function toSnapshotMetadata(
  snapshot: RosterSnapshot,
  extras?: { providerScoringPeriodId?: number }
): Record<string, unknown> {
  const base: Record<string, unknown> = { type: snapshot.type };
  if (snapshot.type === 'week') base.week = snapshot.week;
  if (snapshot.type === 'date') base.date = snapshot.date;
  if (extras?.providerScoringPeriodId !== undefined) {
    base.providerScoringPeriodId = extras.providerScoringPeriodId;
  }
  return base;
}
